/**
 * useGPUConnection.ts - React Hook for GPU Connection Management
 *
 * This hook manages the full lifecycle of connecting to a GPU-powered AI
 * inference server for the Shadow Driver game:
 *
 * 1. GPU Provisioning: Start/stop GPU instances via Vast.ai API
 * 2. Status Polling: Monitor instance status and tunnel URL availability
 * 3. WebSocket Connection: Connect to the AI inference server
 * 4. Game State Communication: Send game state, receive AI predictions
 * 5. Auto-timeout: Warn and disconnect if inactive too long
 * 6. Cleanup: Properly cleanup on unmount
 *
 * Based on the implementation in vercel-deploy/index.html and shadow_mode.py
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

/** GPU provisioning states */
export type GPUProvisioningState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** WebSocket connection states */
export type WebSocketConnectionState = 'disconnected' | 'connecting' | 'connected';

/** Instance data returned from the GPU API */
export interface GPUInstanceData {
  instance_id: string | null;
  offer_id: string | null;
  gpu_name: string | null;
  price_per_hour: number | null;
  tunnel_url: string | null;
  cost_so_far: number;
  uptime_seconds: number;
  setup_status: string | null;
  setup_message: string | null;
}

/** Game state to send to the AI server */
export interface GameStatePayload {
  position: number; // -1 (left) to 1 (right), track position
  speed: number;
  curvature: number; // upcoming track curvature
  weather?: string;
  model?: string;
}

/** AI prediction received from the server */
export interface AIPrediction {
  type: 'prediction';
  steering: number;
  confidence: number;
  model: string;
  throttle?: number;
  brake?: number;
  frame_count?: number;
  uptime?: number;
}

/** Error info structure */
export interface GPUError {
  message: string;
  code?: string;
  details?: string;
}

/** Return type for the useGPUConnection hook */
export interface UseGPUConnectionReturn {
  // States
  provisioningState: GPUProvisioningState;
  connectionState: WebSocketConnectionState;
  instanceData: GPUInstanceData;
  error: GPUError | null;
  lastPrediction: AIPrediction | null;

  // Inactivity warning state
  inactivityWarning: boolean;

  // Actions
  startGPU: () => Promise<void>;
  stopGPU: () => Promise<void>;
  sendGameState: (state: GameStatePayload) => AIPrediction | null;
  clearError: () => void;

  // Connection info
  isConnected: boolean;
  isProvisioningActive: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Polling interval for GPU status (ms) */
const POLL_INTERVAL = 5000;

/** Warning timeout for inactivity (ms) - 2 minutes */
const INACTIVITY_WARNING_TIMEOUT = 2 * 60 * 1000;

/** Auto-disconnect timeout for inactivity (ms) - 5 minutes */
const INACTIVITY_DISCONNECT_TIMEOUT = 5 * 60 * 1000;

/** Ping interval for keepalive (ms) */
const PING_INTERVAL = 30000;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useGPUConnection(): UseGPUConnectionReturn {
  // ----- States -----
  const [provisioningState, setProvisioningState] = useState<GPUProvisioningState>('idle');
  const [connectionState, setConnectionState] = useState<WebSocketConnectionState>('disconnected');
  const [instanceData, setInstanceData] = useState<GPUInstanceData>({
    instance_id: null,
    offer_id: null,
    gpu_name: null,
    price_per_hour: null,
    tunnel_url: null,
    cost_so_far: 0,
    uptime_seconds: 0,
    setup_status: null,
    setup_message: null,
  });
  const [error, setError] = useState<GPUError | null>(null);
  const [lastPrediction, setLastPrediction] = useState<AIPrediction | null>(null);
  const [inactivityWarning, setInactivityWarning] = useState(false);

  // ----- Refs -----
  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const inactivityWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPredictionResolveRef = useRef<((prediction: AIPrediction | null) => void) | null>(null);

  // Keep track of mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // ----- Cleanup Helpers -----

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const clearPingInterval = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const clearInactivityTimers = useCallback(() => {
    if (inactivityWarningTimerRef.current) {
      clearTimeout(inactivityWarningTimerRef.current);
      inactivityWarningTimerRef.current = null;
    }
    if (inactivityDisconnectTimerRef.current) {
      clearTimeout(inactivityDisconnectTimerRef.current);
      inactivityDisconnectTimerRef.current = null;
    }
    setInactivityWarning(false);
  }, []);

  // ----- Inactivity Management -----

  const resetInactivityTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    clearInactivityTimers();

    // Only set timers if connected
    if (connectionState === 'connected') {
      // Warning timer (2 minutes)
      inactivityWarningTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setInactivityWarning(true);
          console.warn('[useGPUConnection] No game state sent for 2 minutes. Will auto-disconnect in 3 more minutes.');
        }
      }, INACTIVITY_WARNING_TIMEOUT);

      // Disconnect timer (5 minutes)
      inactivityDisconnectTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          console.warn('[useGPUConnection] Auto-disconnecting due to 5 minutes of inactivity.');
          // Will call stopGPU which handles cleanup
          stopGPUInternal();
        }
      }, INACTIVITY_DISCONNECT_TIMEOUT);
    }
  }, [connectionState, clearInactivityTimers]);

  // ----- WebSocket Management -----

  const closeWebSocket = useCallback(() => {
    clearPingInterval();
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    if (isMountedRef.current) {
      setConnectionState('disconnected');
    }
  }, [clearPingInterval]);

  const connectWebSocket = useCallback((tunnelUrl: string) => {
    // Close any existing connection
    closeWebSocket();

    if (!isMountedRef.current) return;

    setConnectionState('connecting');

    // Convert HTTPS tunnel URL to WSS for WebSocket
    // e.g., https://xxx.trycloudflare.com -> wss://xxx.trycloudflare.com
    const wsUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');

    console.log(`[useGPUConnection] Connecting to WebSocket: ${wsUrl}`);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close();
          return;
        }

        console.log('[useGPUConnection] WebSocket connected');
        setConnectionState('connected');
        setError(null);

        // Send handshake
        ws.send(JSON.stringify({
          type: 'handshake',
          client: 'shadow-driver-v2',
          version: '2.0',
        }));

        // Start ping interval for keepalive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, PING_INTERVAL);

        // Start inactivity timers
        resetInactivityTimers();
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'prediction') {
            const prediction: AIPrediction = {
              type: 'prediction',
              steering: data.steering ?? 0,
              confidence: data.confidence ?? 0,
              model: data.model ?? 'unknown',
              throttle: data.throttle,
              brake: data.brake,
              frame_count: data.frame_count,
              uptime: data.uptime,
            };
            setLastPrediction(prediction);

            // Resolve pending promise if any
            if (pendingPredictionResolveRef.current) {
              pendingPredictionResolveRef.current(prediction);
              pendingPredictionResolveRef.current = null;
            }
          } else if (data.type === 'pong') {
            // Keepalive response, nothing to do
          } else if (data.type === 'status') {
            console.log('[useGPUConnection] Status from server:', data);
          } else if (data.type === 'error') {
            console.error('[useGPUConnection] Error from server:', data.message);
            setError({ message: data.message, code: 'SERVER_ERROR' });
          }
        } catch (e) {
          console.error('[useGPUConnection] Error parsing message:', e);
        }
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;

        console.log(`[useGPUConnection] WebSocket closed: ${event.code} ${event.reason}`);
        closeWebSocket();
        clearInactivityTimers();

        // If we were in 'running' state, the connection closed unexpectedly
        // Don't auto-reconnect here as the user should manually restart if needed
      };

      ws.onerror = (event) => {
        console.error('[useGPUConnection] WebSocket error:', event);
        if (isMountedRef.current) {
          setError({ message: 'WebSocket connection failed', code: 'WS_ERROR' });
          setConnectionState('disconnected');
        }
      };

    } catch (e) {
      console.error('[useGPUConnection] Failed to create WebSocket:', e);
      if (isMountedRef.current) {
        setError({ message: `Failed to connect: ${e instanceof Error ? e.message : 'Unknown error'}`, code: 'WS_CREATE_ERROR' });
        setConnectionState('disconnected');
      }
    }
  }, [closeWebSocket, clearPingInterval, clearInactivityTimers, resetInactivityTimers]);

  // ----- Status Polling -----

  const pollGPUStatus = useCallback(async () => {
    const currentInstanceId = instanceData.instance_id;
    const currentOfferId = instanceData.offer_id;

    if (!currentInstanceId) {
      clearPolling();
      return;
    }

    try {
      const params = new URLSearchParams({ instance_id: currentInstanceId });
      if (currentOfferId) {
        params.append('offer_id', currentOfferId);
      }

      const response = await fetch(`/api/gpu/status?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        console.error('[useGPUConnection] Status poll error:', data.error);
        return;
      }

      if (!isMountedRef.current) return;

      // Update instance data
      setInstanceData((prev) => ({
        ...prev,
        cost_so_far: data.cost_so_far ?? prev.cost_so_far,
        uptime_seconds: data.uptime_seconds ?? prev.uptime_seconds,
        tunnel_url: data.tunnel_url ?? prev.tunnel_url,
        setup_status: data.setup_status ?? prev.setup_status,
        setup_message: data.setup_message ?? prev.setup_message,
        gpu_name: data.gpu_name ?? prev.gpu_name,
      }));

      // Check if tunnel is ready and we should connect
      if (data.tunnel_url && data.status === 'running' && connectionState === 'disconnected') {
        console.log('[useGPUConnection] Tunnel ready, connecting...');
        clearPolling();
        setProvisioningState('running');

        // Small delay before connecting
        setTimeout(() => {
          if (isMountedRef.current) {
            connectWebSocket(data.tunnel_url);
          }
        }, 1000);
      }

    } catch (e) {
      console.error('[useGPUConnection] Error polling status:', e);
    }
  }, [instanceData.instance_id, instanceData.offer_id, connectionState, clearPolling, connectWebSocket]);

  const startPolling = useCallback(() => {
    clearPolling();
    // Poll immediately, then at interval
    pollGPUStatus();
    pollIntervalRef.current = setInterval(pollGPUStatus, POLL_INTERVAL);
  }, [clearPolling, pollGPUStatus]);

  // ----- GPU Lifecycle -----

  const startGPU = useCallback(async () => {
    if (provisioningState === 'starting' || provisioningState === 'running') {
      console.warn('[useGPUConnection] GPU already starting or running');
      return;
    }

    setProvisioningState('starting');
    setError(null);
    setInactivityWarning(false);

    try {
      const response = await fetch('/api/gpu/start', { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start GPU');
      }

      if (!isMountedRef.current) return;

      // Update instance data with initial info
      setInstanceData({
        instance_id: data.instance_id,
        offer_id: data.offer_id,
        gpu_name: data.gpu_name ?? null,
        price_per_hour: data.price_per_hour ?? null,
        tunnel_url: null,
        cost_so_far: 0,
        uptime_seconds: 0,
        setup_status: 'starting',
        setup_message: 'Instance provisioned, waiting for setup...',
      });

      console.log(`[useGPUConnection] GPU instance started: ${data.instance_id}`);

      // Start polling for status
      startPolling();

    } catch (e) {
      console.error('[useGPUConnection] Error starting GPU:', e);
      if (isMountedRef.current) {
        setProvisioningState('error');
        setError({
          message: e instanceof Error ? e.message : 'Failed to start GPU',
          code: 'START_ERROR',
        });
      }
    }
  }, [provisioningState, startPolling]);

  // Internal stop function (doesn't require confirmation)
  const stopGPUInternal = useCallback(async () => {
    const currentInstanceId = instanceData.instance_id;

    // Set stopping state
    setProvisioningState('stopping');

    // Stop polling
    clearPolling();

    // Close WebSocket
    closeWebSocket();

    // Clear inactivity timers
    clearInactivityTimers();

    if (currentInstanceId) {
      try {
        const response = await fetch('/api/gpu/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_id: currentInstanceId }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('[useGPUConnection] Failed to destroy instance:', data.error);
          // Don't throw - we still want to reset state
        } else {
          console.log(`[useGPUConnection] GPU instance destroyed: ${currentInstanceId}`);
        }
      } catch (e) {
        console.error('[useGPUConnection] Error stopping GPU:', e);
      }
    }

    if (isMountedRef.current) {
      // Reset all state
      setProvisioningState('idle');
      setConnectionState('disconnected');
      setInstanceData({
        instance_id: null,
        offer_id: null,
        gpu_name: null,
        price_per_hour: null,
        tunnel_url: null,
        cost_so_far: 0,
        uptime_seconds: 0,
        setup_status: null,
        setup_message: null,
      });
      setLastPrediction(null);
      setError(null);
      setInactivityWarning(false);
    }
  }, [instanceData.instance_id, clearPolling, closeWebSocket, clearInactivityTimers]);

  const stopGPU = useCallback(async () => {
    await stopGPUInternal();
  }, [stopGPUInternal]);

  // ----- Game State Communication -----

  const sendGameState = useCallback((state: GameStatePayload): AIPrediction | null => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return null;
    }

    // Reset inactivity timers on activity
    resetInactivityTimers();

    // Send state to server
    const message = {
      type: 'state',
      position: state.position,
      speed: state.speed,
      curvature: state.curvature,
      weather: state.weather,
      model: state.model,
    };

    try {
      wsRef.current.send(JSON.stringify(message));
    } catch (e) {
      console.error('[useGPUConnection] Error sending state:', e);
      return null;
    }

    // Return the last prediction we have (synchronous)
    // The server will send a new prediction which will update lastPrediction
    return lastPrediction;
  }, [lastPrediction, resetInactivityTimers]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ----- Cleanup on Unmount -----

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Cleanup everything
      clearPolling();
      closeWebSocket();
      clearInactivityTimers();

      // Note: We don't auto-destroy the GPU instance on unmount
      // because the user may want to continue using it if they navigate back.
      // They should explicitly call stopGPU() if they want to destroy it.
    };
  }, [clearPolling, closeWebSocket, clearInactivityTimers]);

  // ----- Update inactivity timers when connection state changes -----

  useEffect(() => {
    if (connectionState === 'connected') {
      resetInactivityTimers();
    } else {
      clearInactivityTimers();
    }
  }, [connectionState, resetInactivityTimers, clearInactivityTimers]);

  // ----- Return -----

  return {
    // States
    provisioningState,
    connectionState,
    instanceData,
    error,
    lastPrediction,
    inactivityWarning,

    // Actions
    startGPU,
    stopGPU,
    sendGameState,
    clearError,

    // Computed
    isConnected: connectionState === 'connected',
    isProvisioningActive: provisioningState === 'starting' || provisioningState === 'running',
  };
}

export default useGPUConnection;
