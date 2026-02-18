/**
 * useGPUConnection.ts - GPU connection hook adapted for v3 racing
 * Handles: GPU provisioning, WebSocket with binary JPEG frames + JSON race state
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GPUProvisioningState, WebSocketConnectionState, GPUInstanceData,
  GPUError, KeyState, RaceState, RaceFinished, ServerMessage,
} from '../types/index.ts';

// Constants
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const PING_INTERVAL = 30000;
const WS_CONNECT_DELAY = 3000;
const WS_MAX_RETRIES = 3;
const WS_RETRY_DELAY = 2000;

// API base URL - v3's own API routes for start, shared API for status/callback/stop
const API_BASE_URL = '';

export interface UseGPUConnectionReturn {
  provisioningState: GPUProvisioningState;
  connectionState: WebSocketConnectionState;
  instanceData: GPUInstanceData;
  error: GPUError | null;
  raceState: RaceState | null;
  raceFinished: RaceFinished | null;
  availableModels: string[];
  activeModel: string | null;
  latencyMs: number | null;
  cameraMode: string;
  retryCount: number;
  maxRetries: number;
  startGPU: () => Promise<void>;
  stopGPU: () => Promise<void>;
  sendControls: (keys: KeyState) => void;
  sendStartRace: (track: string, laps: number, weather: string) => void;
  sendSwitchModel: (model: string) => void;
  sendRespawn: () => void;
  sendCameraMode: (mode: string) => void;
  clearError: () => void;
  isConnected: boolean;
  isProvisioningActive: boolean;
  // Expose frame handler registration for VideoCanvas
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
}

export function useGPUConnection(): UseGPUConnectionReturn {
  const [provisioningState, setProvisioningState] = useState<GPUProvisioningState>('idle');
  const [connectionState, setConnectionState] = useState<WebSocketConnectionState>('disconnected');
  const [instanceData, setInstanceData] = useState<GPUInstanceData>({
    instance_id: null, offer_id: null, gpu_name: null, price_per_hour: null,
    tunnel_url: null, cost_so_far: 0, uptime_seconds: 0,
    setup_status: null, setup_message: null,
  });
  const [error, setError] = useState<GPUError | null>(null);
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const [raceFinished, setRaceFinished] = useState<RaceFinished | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [cameraMode, setCameraMode] = useState<string>('chase');

  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartTimeRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const instanceIdRef = useRef<string | null>(null);
  const offerIdRef = useRef<string | null>(null);
  const wsRetryCountRef = useRef(0);
  const tunnelUrlRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const binaryFrameHandlerRef = useRef<((data: Blob) => void) | null>(null);

  // Refs to avoid stale closures
  const stopGPUInternalRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startGPUInternalRef = useRef<(isRetry: boolean) => Promise<void>>(() => Promise.resolve());
  const latencyMsRef = useRef<number | null>(null);

  // --- Cleanup helpers ---
  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    pollStartTimeRef.current = null;
  }, []);

  const clearPingInterval = useCallback(() => {
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
  }, []);

  // --- WebSocket ---
  const closeWebSocket = useCallback(() => {
    clearPingInterval();
    if (wsRef.current) {
      wsRef.current.onopen = null; wsRef.current.onclose = null;
      wsRef.current.onerror = null; wsRef.current.onmessage = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    if (isMountedRef.current) setConnectionState('disconnected');
  }, [clearPingInterval]);

  const connectWebSocket = useCallback((tunnelUrl: string, isRetry = false) => {
    tunnelUrlRef.current = tunnelUrl;
    if (!isRetry) wsRetryCountRef.current = 0;
    closeWebSocket();
    if (!isMountedRef.current) return;
    setConnectionState('connecting');

    const wsUrl = tunnelUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    console.log(`[v3] Connecting to ${wsUrl}${isRetry ? ` (retry ${wsRetryCountRef.current})` : ''}`);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) { ws.close(); return; }
        console.log('[v3] WebSocket connected');
        setConnectionState('connected');
        setError(null);
        wsRetryCountRef.current = 0;
        ws.send(JSON.stringify({ type: 'handshake', client: 'shadow-driver-v3' }));
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;

        // Binary = JPEG frame
        if (event.data instanceof Blob) {
          if (binaryFrameHandlerRef.current) {
            binaryFrameHandlerRef.current(event.data);
          }
          return;
        }

        // Text = JSON
        try {
          const data: ServerMessage = JSON.parse(event.data);
          if (data.type === 'race_state') {
            setRaceState(data as RaceState);
          } else if (data.type === 'race_finished') {
            setRaceFinished(data as RaceFinished);
          } else if (data.type === 'handshake_ack') {
            const ack = data as { models: string[] };
            setAvailableModels(ack.models || []);
          } else if (data.type === 'pong') {
            const pong = data as { timestamp: number };
            if (pong.timestamp) {
              const ms = Date.now() - pong.timestamp;
              latencyMsRef.current = ms;
              setLatencyMs(ms);
            }
          } else if (data.type === 'model_switched') {
            const switched = data as { model: string; success: boolean };
            if (switched.success) {
              setActiveModel(switched.model);
            }
          } else if (data.type === 'camera_mode_changed') {
            const camMsg = data as { mode: string };
            setCameraMode(camMsg.mode);
          } else if (data.type === 'error') {
            setError({ message: (data as { message: string }).message, code: 'SERVER_ERROR' });
          }
        } catch (e) {
          console.error('[v3] Error parsing message:', e);
        }
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;
        const shouldRetry = !event.wasClean && event.code === 1006 &&
          wsRetryCountRef.current < WS_MAX_RETRIES && tunnelUrlRef.current;
        if (shouldRetry) {
          wsRetryCountRef.current += 1;
          setTimeout(() => {
            if (isMountedRef.current && tunnelUrlRef.current) connectWebSocket(tunnelUrlRef.current, true);
          }, WS_RETRY_DELAY);
          return;
        }
        if (!event.wasClean) {
          setError({ message: 'Connection lost', code: `WS_CLOSE_${event.code}` });
        }
        closeWebSocket();
      };

      ws.onerror = () => {
        console.error('[v3] WebSocket error (details in onclose)');
      };
    } catch (e) {
      if (isMountedRef.current) {
        setError({ message: `Failed to connect: ${e instanceof Error ? e.message : 'Unknown'}`, code: 'WS_CREATE_ERROR' });
        setConnectionState('disconnected');
      }
    }
  }, [closeWebSocket, clearPingInterval]);

  // --- Status polling ---
  const pollGPUStatus = useCallback(async () => {
    const currentInstanceId = instanceIdRef.current;
    const currentOfferId = offerIdRef.current;
    if (!currentInstanceId) { clearPolling(); return; }

    if (pollStartTimeRef.current && Date.now() - pollStartTimeRef.current > POLL_TIMEOUT) {
      clearPolling();
      if (isMountedRef.current) {
        setProvisioningState('error');
        setError({ message: 'GPU setup timed out after 5 minutes', code: 'POLL_TIMEOUT' });
      }
      return;
    }

    try {
      const params = new URLSearchParams({ instance_id: currentInstanceId });
      if (currentOfferId) params.append('offer_id', currentOfferId);
      const response = await fetch(`${API_BASE_URL}/api/gpu/status?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !isMountedRef.current) return;

      setInstanceData(prev => ({
        ...prev,
        cost_so_far: data.cost_so_far ?? prev.cost_so_far,
        uptime_seconds: data.uptime_seconds ?? prev.uptime_seconds,
        tunnel_url: data.tunnel_url ?? prev.tunnel_url,
        setup_status: data.setup_status ?? prev.setup_status,
        setup_message: data.setup_message ?? prev.setup_message,
        gpu_name: data.gpu_name ?? prev.gpu_name,
      }));

      if (data.setup_status === 'error') {
        clearPolling();
        if (retryCountRef.current < MAX_RETRIES) {
          setTimeout(() => { if (isMountedRef.current) startGPUInternalRef.current(true); }, RETRY_DELAY);
          return;
        }
        setProvisioningState('error');
        setError({ message: data.setup_message || 'GPU setup failed', code: 'SETUP_ERROR' });
        return;
      }

      if (data.tunnel_url && data.status === 'running' && connectionState === 'disconnected') {
        clearPolling();
        setProvisioningState('running');
        setTimeout(() => { if (isMountedRef.current) connectWebSocket(data.tunnel_url); }, WS_CONNECT_DELAY);
      }
    } catch (e) {
      console.error('[v3] Poll error:', e);
    }
  }, [connectionState, clearPolling, connectWebSocket]);

  const startPolling = useCallback(() => {
    clearPolling();
    pollStartTimeRef.current = Date.now();
    pollGPUStatus();
    pollIntervalRef.current = setInterval(pollGPUStatus, POLL_INTERVAL);
  }, [clearPolling, pollGPUStatus]);

  // --- GPU lifecycle ---
  const startGPUInternal = useCallback(async (isRetry = false) => {
    if (!isRetry && (provisioningState === 'starting' || provisioningState === 'running')) return;
    if (isRetry) { retryCountRef.current += 1; setRetryCount(retryCountRef.current); }
    else { retryCountRef.current = 0; setRetryCount(0); }

    setProvisioningState('starting');
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/gpu/start`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start GPU');
      if (!isMountedRef.current) return;

      instanceIdRef.current = data.instance_id;
      offerIdRef.current = data.offer_id;
      setInstanceData({
        instance_id: data.instance_id, offer_id: data.offer_id,
        gpu_name: data.gpu_name ?? null, price_per_hour: data.price_per_hour ?? null,
        tunnel_url: null, cost_so_far: 0, uptime_seconds: 0,
        setup_status: 'provisioning', setup_message: 'Finding a GPU...',
      });
      startPolling();
    } catch (e) {
      if (retryCountRef.current < MAX_RETRIES) {
        setTimeout(() => { if (isMountedRef.current) startGPUInternal(true); }, RETRY_DELAY);
        return;
      }
      if (isMountedRef.current) {
        setProvisioningState('error');
        setError({ message: e instanceof Error ? e.message : 'Failed to start GPU', code: 'START_ERROR' });
      }
    }
  }, [provisioningState, startPolling]);

  useEffect(() => { startGPUInternalRef.current = startGPUInternal; }, [startGPUInternal]);

  const startGPU = useCallback(async () => { await startGPUInternal(false); }, [startGPUInternal]);

  const stopGPUInternal = useCallback(async () => {
    const currentInstanceId = instanceData.instance_id;
    setProvisioningState('stopping');
    clearPolling();
    closeWebSocket();
    if (currentInstanceId) {
      try {
        await fetch(`${API_BASE_URL}/api/gpu/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instance_id: currentInstanceId }),
        });
      } catch (e) { console.error('[v3] Error stopping GPU:', e); }
    }
    if (isMountedRef.current) {
      instanceIdRef.current = null; offerIdRef.current = null;
      setProvisioningState('idle');
      setConnectionState('disconnected');
      setInstanceData({
        instance_id: null, offer_id: null, gpu_name: null, price_per_hour: null,
        tunnel_url: null, cost_so_far: 0, uptime_seconds: 0,
        setup_status: null, setup_message: null,
      });
      setRaceState(null); setRaceFinished(null);
      setError(null);
    }
  }, [instanceData.instance_id, clearPolling, closeWebSocket]);

  useEffect(() => { stopGPUInternalRef.current = stopGPUInternal; }, [stopGPUInternal]);
  const stopGPU = useCallback(async () => { await stopGPUInternal(); }, [stopGPUInternal]);

  // --- Game communication ---
  const sendControls = useCallback((keys: KeyState) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'control', keys };
    if (latencyMsRef.current !== null) {
      msg.latency = latencyMsRef.current;
    }
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  const sendStartRace = useCallback((track: string, laps: number, weather: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'start_race', track, laps, weather }));
  }, []);

  const sendSwitchModel = useCallback((model: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'switch_model', model }));
  }, []);

  const sendRespawn = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'respawn' }));
  }, []);

  const sendCameraMode = useCallback((mode: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'camera_mode', mode }));
  }, []);

  const onBinaryFrame = useCallback((handler: ((data: Blob) => void) | null) => {
    binaryFrameHandlerRef.current = handler;
  }, []);

  const clearError = useCallback(() => { setError(null); }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPolling(); closeWebSocket();
    };
  }, [clearPolling, closeWebSocket]);

  return {
    provisioningState, connectionState, instanceData, error,
    raceState, raceFinished, availableModels, activeModel, latencyMs, cameraMode,
    retryCount, maxRetries: MAX_RETRIES,
    startGPU, stopGPU, sendControls, sendStartRace, sendSwitchModel, sendRespawn, sendCameraMode,
    clearError, onBinaryFrame,
    isConnected: connectionState === 'connected',
    isProvisioningActive: provisioningState === 'starting' || provisioningState === 'running',
  };
}

export default useGPUConnection;
