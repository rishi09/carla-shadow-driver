/**
 * useGPUConnection.ts - GPU connection hook adapted for v3 racing
 * Handles: GPU provisioning, WebSocket with binary JPEG frames + JSON race state
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GPUProvisioningState, WebSocketConnectionState, GPUInstanceData,
  GPUError, KeyState, GamepadControls, RaceState, RaceFinished, ServerMessage, DriftEndEvent, AIChatMessage,
} from '../types/index.ts';

// Constants
const POLL_INTERVAL = 5000;
const POLL_TIMEOUT = 15 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const PING_INTERVAL = 30000;
const WS_CONNECT_DELAY = 3000;
const WS_MAX_RETRIES = 3;
const WS_RETRY_DELAY = 2000;

// API base URL - v3's own API routes for start, shared API for status/callback/stop
const API_BASE_URL = '';

export interface CommentaryMessage {
  text: string;
  category: string;
  id: number;
}

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
  commentary: CommentaryMessage[];
  latestDriftEnd: DriftEndEvent | null;
  aiChat: AIChatMessage | null;
  retryCount: number;
  maxRetries: number;
  startGPU: () => Promise<void>;
  stopGPU: () => Promise<void>;
  sendControls: (keys: KeyState, gamepad?: GamepadControls) => void;
  sendStartRace: (track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string) => void;
  sendSwitchModel: (model: string) => void;
  sendRespawn: () => void;
  sendRestartRace: () => void;
  sendCameraMode: (mode: string) => void;
  sendPause: () => void;
  sendResume: () => void;
  connectDirect: (wsUrl: string) => void;
  clearError: () => void;
  isConnected: boolean;
  isProvisioningActive: boolean;
  // Expose frame handler registration for VideoCanvas
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  // Expose rear-view mirror frame handler registration
  onRearFrame: (handler: ((data: Blob) => void) | null) => void;
  // WebRTC remote video stream (null until track arrives)
  remoteStream: MediaStream | null;
  // Timestamp (performance.now()) of the last received binary/video frame
  lastFrameTime: number;
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
  const [commentary, setCommentary] = useState<CommentaryMessage[]>([]);
  const [latestDriftEnd, setLatestDriftEnd] = useState<DriftEndEvent | null>(null);
  const [aiChat, setAiChat] = useState<AIChatMessage | null>(null);
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);
  const commentaryIdRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
  const rearFrameHandlerRef = useRef<((data: Blob) => void) | null>(null);

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
    // Close WebRTC peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
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
        // Expose for E2E testing / browser console debugging
        (window as unknown as Record<string, unknown>).__gameWs = ws;
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

      ws.onmessage = async (event) => {
        if (!isMountedRef.current) return;

        // Binary = typed camera frame (1-byte prefix + JPEG data)
        // 0x00 = main camera, 0x01 = rear-view mirror
        if (event.data instanceof Blob) {
          const blob = event.data as Blob;
          // Convert entire blob to ArrayBuffer to reliably extract type byte
          // and slice JPEG data (Safari's Blob.slice can be unreliable)
          const buffer = await blob.arrayBuffer();
          const frameType = new Uint8Array(buffer)[0];
          const jpegBlob = new Blob([buffer.slice(1)], { type: 'image/jpeg' });

          if (frameType === 0x01) {
            // Rear-view mirror frame
            if (rearFrameHandlerRef.current) {
              rearFrameHandlerRef.current(jpegBlob);
            }
          } else {
            // Main camera frame (0x00 or legacy untyped)
            setLastFrameTime(performance.now());
            if (binaryFrameHandlerRef.current) {
              binaryFrameHandlerRef.current(jpegBlob);
            }
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

            // WebRTC disabled: Cloudflare quick tunnels don't support UDP,
            // so WebRTC video can never connect through them. Use JPEG-over-WebSocket
            // which works reliably through any HTTP tunnel.
            // TODO: Re-enable WebRTC when using direct IP connections (not tunnels)
            console.log('[v3] Using JPEG-over-WebSocket for video (WebRTC disabled for tunnel compatibility)');
          } else if (data.type === 'webrtc_answer') {
            const answer = data as { sdp: string; sdpType: RTCSdpType };
            try {
              if (pcRef.current) {
                await pcRef.current.setRemoteDescription(
                  new RTCSessionDescription({ sdp: answer.sdp, type: answer.sdpType })
                );
                console.log('[v3] WebRTC answer applied');
                // Log WebRTC stats every 5s to measure encode/transport latency
                const statsInterval = setInterval(async () => {
                  if (!pcRef.current) { clearInterval(statsInterval); return; }
                  try {
                    const stats = await pcRef.current.getStats();
                    stats.forEach((report: any) => {
                      if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        console.log(`[WebRTC stats] frames=${report.framesReceived}, ` +
                          `decoded=${report.framesDecoded}, dropped=${report.framesDropped}, ` +
                          `jitter=${report.jitter?.toFixed(3)}s, ` +
                          `bytesRx=${report.bytesReceived}, ` +
                          `decodeTime=${report.totalDecodeTime?.toFixed(2)}s total`);
                      }
                    });
                  } catch { /* pc closed */ clearInterval(statsInterval); }
                }, 5000);
              }
            } catch (err) {
              console.warn('[v3] Failed to apply WebRTC answer:', err);
            }
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
          } else if (data.type === 'restart_ack') {
            // Race restarted — clear finished state so we stay in racing view
            setRaceFinished(null);
          } else if (data.type === 'no_change') {
            // Server says frame is unchanged -- keep displaying the last frame.
            // No action needed; the VideoCanvas retains the last rendered frame.
          } else if (data.type === 'perf_stats') {
            // Server performance stats for debug overlay
            const perf = data as import('../types/index.ts').PerfStats;
            console.log(`[perf_stats] encode=${perf.avg_encode_ms}ms, ` +
              `size=${perf.avg_frame_size_kb}KB, ` +
              `q=${perf.quality}, res=${perf.resolution}, ` +
              `fps=${perf.fps}`);
          } else if (data.type === 'commentary') {
            const msg = data as { text: string; category: string };
            const id = ++commentaryIdRef.current;
            setCommentary(prev => [...prev, { text: msg.text, category: msg.category, id }]);
            // Auto-remove after 4 seconds
            setTimeout(() => {
              if (isMountedRef.current) {
                setCommentary(prev => prev.filter(m => m.id !== id));
              }
            }, 4000);
          } else if (data.type === 'drift_end') {
            setLatestDriftEnd(data as DriftEndEvent);
          } else if (data.type === 'ai_chat') {
            const chatMsg = data as AIChatMessage;
            setAiChat(chatMsg);
            // Auto-clear after 4 seconds so the bubble disappears
            setTimeout(() => {
              if (isMountedRef.current) {
                setAiChat(prev => prev === chatMsg ? null : prev);
              }
            }, 4000);
          } else if (data.type === 'error') {
            setError({ message: (data as { message: string }).message, code: 'SERVER_ERROR' });
          } else if (data.type === 'server_shutdown') {
            const msg = data as { message: string };
            console.warn('[v3] Server shutting down:', msg.message);
            setError({ message: msg.message || 'Server shut down due to inactivity', code: 'SERVER_SHUTDOWN' });
            closeWebSocket();
          } else if (data.type === 'respawn_ack') {
            // Server acknowledged respawn request — no UI action needed
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
        setError({ message: 'GPU setup timed out after 15 minutes', code: 'POLL_TIMEOUT' });
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
  const sendControls = useCallback((keys: KeyState, gamepad?: GamepadControls) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'control', keys };
    if (latencyMsRef.current !== null) {
      msg.latency = latencyMsRef.current;
    }
    // Include analog gamepad controls when a gamepad is active
    if (gamepad) {
      msg.analog = {
        steer: gamepad.steer,
        throttle: gamepad.throttle,
        brake: gamepad.brake,
        handbrake: gamepad.handbrake,
      };
    }
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  const sendStartRace = useCallback((track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = { type: 'start_race', track, laps, weather };
    if (model) {
      msg.model = model;
    }
    if (playerCar) {
      msg.player_car = playerCar;
    }
    if (timeOfDay) {
      msg.time_of_day = timeOfDay;
    }
    // Include player name for social presence reporting
    try {
      const storedName = localStorage.getItem('shadow_driver_player_name');
      msg.player_name = storedName?.trim() || 'Anonymous';
    } catch {
      msg.player_name = 'Anonymous';
    }
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  const sendSwitchModel = useCallback((model: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'switch_model', model }));
  }, []);

  const sendRespawn = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'respawn' }));
  }, []);

  const sendRestartRace = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'restart_race' }));
  }, []);

  const sendCameraMode = useCallback((mode: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'camera_mode', mode }));
  }, []);

  const sendPause = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'pause' }));
  }, []);

  const sendResume = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'resume' }));
  }, []);

  const onBinaryFrame = useCallback((handler: ((data: Blob) => void) | null) => {
    binaryFrameHandlerRef.current = handler;
  }, []);

  const onRearFrame = useCallback((handler: ((data: Blob) => void) | null) => {
    rearFrameHandlerRef.current = handler;
  }, []);

  const connectDirect = useCallback((wsUrl: string) => {
    setProvisioningState('running');
    connectWebSocket(wsUrl);
  }, [connectWebSocket]);

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
    raceState, raceFinished, availableModels, activeModel, latencyMs, cameraMode, commentary, latestDriftEnd, aiChat,
    retryCount, maxRetries: MAX_RETRIES, lastFrameTime,
    startGPU, stopGPU, sendControls, sendStartRace, sendSwitchModel, sendRespawn, sendRestartRace, sendCameraMode, sendPause, sendResume,
    connectDirect, clearError, onBinaryFrame, onRearFrame, remoteStream,
    isConnected: connectionState === 'connected',
    isProvisioningActive: provisioningState === 'starting' || provisioningState === 'running',
  };
}

export default useGPUConnection;
