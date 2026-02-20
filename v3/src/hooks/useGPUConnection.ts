/**
 * useGPUConnection.ts - GPU connection hook adapted for v3 racing
 * Handles: GPU provisioning, WebSocket with binary JPEG frames + JSON race state
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GPUProvisioningState, WebSocketConnectionState, GPUInstanceData,
  GPUError, KeyState, GamepadControls, RaceState, RaceFinished, ServerMessage, DriftEndEvent, AIChatMessage,
  CodecConfig,
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

// --- Adaptive bitrate: network quality reporting ---
const NETWORK_QUALITY_INTERVAL = 2000; // Send quality report every 2 seconds
const EXPECTED_FRAME_INTERVAL_MS = 33.3; // 30fps target
const MAX_FRAME_INTERVALS = 60; // Rolling window for jitter calculation

// localStorage keys for persisting last successful WS URL (sub-3s cold start)
const LAST_WS_URL_KEY = 'shadow_driver_last_ws_url';
const LAST_WS_TIME_KEY = 'shadow_driver_last_ws_time';
const WS_URL_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes — tunnels expire, instances shut down

/** Read a recent WS URL from localStorage (null if expired or missing) */
export function getLastWsUrl(): string | null {
  try {
    const url = localStorage.getItem(LAST_WS_URL_KEY);
    const time = localStorage.getItem(LAST_WS_TIME_KEY);
    if (!url || !time) return null;
    if (Date.now() - parseInt(time, 10) > WS_URL_MAX_AGE_MS) {
      // Expired — clean up
      localStorage.removeItem(LAST_WS_URL_KEY);
      localStorage.removeItem(LAST_WS_TIME_KEY);
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Clear the saved WS URL (called on fatal connection errors) */
function clearLastWsUrl(): void {
  try {
    localStorage.removeItem(LAST_WS_URL_KEY);
    localStorage.removeItem(LAST_WS_TIME_KEY);
  } catch { /* ignore */ }
}

/** Save a successful WS URL + timestamp */
function saveLastWsUrl(url: string): void {
  try {
    localStorage.setItem(LAST_WS_URL_KEY, url);
    localStorage.setItem(LAST_WS_TIME_KEY, String(Date.now()));
  } catch { /* ignore — private browsing etc. */ }
}

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
  sendStartRace: (track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string, postprocess?: string) => void;
  sendSwitchModel: (model: string) => void;
  sendRespawn: () => void;
  sendRestartRace: () => void;
  sendCameraMode: (mode: string) => void;
  sendPause: () => void;
  sendResume: () => void;
  sendAmbientWeather: (sunAltitude: number, cloudiness: number, precipitation: number) => void;
  connectDirect: (wsUrl: string) => void;
  clearError: () => void;
  isConnected: boolean;
  isProvisioningActive: boolean;
  // Expose frame handler registration for VideoCanvas
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  // Expose rear-view mirror frame handler registration
  onRearFrame: (handler: ((data: Blob) => void) | null) => void;
  // H.264 frame handler registration (for WebCodecs decoding)
  onH264Frame: (handler: ((isKeyframe: boolean, data: ArrayBuffer) => void) | null) => void;
  // Codec config handler registration (for WebCodecs decoder configuration)
  onCodecConfig: (handler: ((config: CodecConfig) => void) | null) => void;
  // WebRTC remote video stream (null until track arrives)
  remoteStream: MediaStream | null;
  // Timestamp (performance.now()) of the last received binary/video frame
  lastFrameTime: number;
  // Server perf stats (quality, encode time, frame size, resolution)
  perfStats: import('../types/index.ts').PerfStats | null;
  // Count of no_change messages (delta-skipped frames)
  noChangeCount: number;
  // Total binary frames received (JPEG + H.264)
  totalFrameCount: number;
  // WebRTC data channel state for controls: 'closed' | 'connecting' | 'open' | 'failed'
  dataChannelState: string;
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
  const [perfStats, setPerfStats] = useState<import('../types/index.ts').PerfStats | null>(null);
  const noChangeCountRef = useRef(0);
  const totalFrameCountRef = useRef(0);
  const commentaryIdRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // --- WebRTC Data Channel for low-latency controls (UDP) ---
  const dcPcRef = useRef<RTCPeerConnection | null>(null);   // Peer connection for data channel
  const dcRef = useRef<RTCDataChannel | null>(null);          // The "controls" data channel
  const [dataChannelState, setDataChannelState] = useState<string>('closed');

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
  const h264FrameHandlerRef = useRef<((isKeyframe: boolean, data: ArrayBuffer) => void) | null>(null);
  const codecConfigHandlerRef = useRef<((config: CodecConfig) => void) | null>(null);

  // Refs to avoid stale closures
  const stopGPUInternalRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const startGPUInternalRef = useRef<(isRetry: boolean) => Promise<void>>(() => Promise.resolve());
  const latencyMsRef = useRef<number | null>(null);

  // --- Network quality tracking for adaptive bitrate ---
  const frameTimestampsRef = useRef<number[]>([]); // recent frame arrival timestamps (performance.now)
  const frameIntervalsRef = useRef<number[]>([]); // intervals between consecutive frames (ms)
  const networkQualityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRttRef = useRef<number>(0); // most recent RTT measurement (ms)
  const framesExpectedRef = useRef<number>(0); // frames expected since last report
  const framesReceivedRef = useRef<number>(0); // frames received since last report

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
    // Stop network quality reporting
    if (networkQualityIntervalRef.current) {
      clearInterval(networkQualityIntervalRef.current);
      networkQualityIntervalRef.current = null;
    }
    // Reset network quality tracking state
    frameTimestampsRef.current = [];
    frameIntervalsRef.current = [];
    framesExpectedRef.current = 0;
    framesReceivedRef.current = 0;
    lastRttRef.current = 0;
    // Reset debug overlay tracking
    noChangeCountRef.current = 0;
    totalFrameCountRef.current = 0;
    setPerfStats(null);
    // Close WebRTC video peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    // Close WebRTC data channel peer connection
    if (dcRef.current) {
      try { dcRef.current.close(); } catch { /* ignore */ }
      dcRef.current = null;
    }
    if (dcPcRef.current) {
      dcPcRef.current.close();
      dcPcRef.current = null;
    }
    setDataChannelState('closed');
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

  // --- WebRTC Data Channel setup for low-latency controls ---
  const setupDataChannel = useCallback((ws: WebSocket) => {
    // Don't attempt if RTCPeerConnection is not available
    if (typeof RTCPeerConnection === 'undefined') {
      console.log('[DC] RTCPeerConnection not available, skipping data channel setup');
      return;
    }

    // Close any existing data channel connection
    if (dcRef.current) {
      try { dcRef.current.close(); } catch { /* ignore */ }
      dcRef.current = null;
    }
    if (dcPcRef.current) {
      dcPcRef.current.close();
      dcPcRef.current = null;
    }

    try {
      setDataChannelState('connecting');
      console.log('[DC] Setting up WebRTC data channel for controls...');

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      dcPcRef.current = pc;

      // Create the data channel with unreliable/unordered settings (UDP-like)
      const dc = pc.createDataChannel('controls', {
        ordered: false,
        maxRetransmits: 0,
      });
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('[DC] Data channel OPEN -- using low-latency UDP path for controls');
        if (isMountedRef.current) setDataChannelState('open');
      };

      dc.onclose = () => {
        console.log('[DC] Data channel closed -- falling back to WebSocket for controls');
        if (isMountedRef.current) setDataChannelState('closed');
      };

      dc.onerror = (ev) => {
        console.warn('[DC] Data channel error:', ev);
        if (isMountedRef.current) setDataChannelState('failed');
      };

      // Send ICE candidates to server via WebSocket
      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'dc_ice_candidate',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`[DC] Peer connection state: ${state}`);
        if (state === 'failed' || state === 'closed') {
          if (isMountedRef.current) setDataChannelState('failed');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[DC] ICE connection state: ${pc.iceConnectionState}`);
      };

      // Create offer and send via WebSocket
      pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer);
      }).then(() => {
        if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
          ws.send(JSON.stringify({
            type: 'dc_offer',
            sdp: pc.localDescription.sdp,
            sdpType: pc.localDescription.type,
          }));
          console.log('[DC] Data channel offer sent via WebSocket');
        }
      }).catch((err) => {
        console.warn('[DC] Failed to create data channel offer:', err);
        if (isMountedRef.current) setDataChannelState('failed');
      });

    } catch (e) {
      console.warn('[DC] Failed to set up data channel:', e);
      if (isMountedRef.current) setDataChannelState('failed');
    }
  }, []);

  // --- Network quality tracking helpers ---
  /** Record a main-camera frame arrival for jitter/drop-rate calculation */
  const _recordFrameArrival = useCallback((now: number) => {
    framesReceivedRef.current += 1;

    const timestamps = frameTimestampsRef.current;
    if (timestamps.length > 0) {
      const interval = now - timestamps[timestamps.length - 1];
      const intervals = frameIntervalsRef.current;
      intervals.push(interval);
      // Keep rolling window
      if (intervals.length > MAX_FRAME_INTERVALS) {
        intervals.shift();
      }
    }
    timestamps.push(now);
    // Keep only recent timestamps (same window size)
    if (timestamps.length > MAX_FRAME_INTERVALS + 1) {
      timestamps.shift();
    }
  }, []);

  /** Compute and send network quality metrics to server */
  const _sendNetworkQualityReport = useCallback((ws: WebSocket) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const intervals = frameIntervalsRef.current;
    if (intervals.length < 5) return; // Need enough samples

    // Average frame interval
    const sum = intervals.reduce((a, b) => a + b, 0);
    const avgInterval = sum / intervals.length;

    // Jitter (standard deviation of intervals)
    const sqDiffs = intervals.map(v => (v - avgInterval) ** 2);
    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length;
    const jitter = Math.sqrt(avgSqDiff);

    // Frame drop rate: estimate based on elapsed time vs frames received
    // Over the reporting period, how many frames were expected vs received
    const expectedFrames = (NETWORK_QUALITY_INTERVAL / EXPECTED_FRAME_INTERVAL_MS);
    const received = framesReceivedRef.current;
    const dropRate = received >= expectedFrames ? 0 : Math.max(0, 1 - (received / expectedFrames));

    // Reset counters for next reporting period
    framesReceivedRef.current = 0;

    // RTT from the most recent ping/pong
    const rtt = lastRttRef.current;

    try {
      ws.send(JSON.stringify({
        type: 'network_quality',
        avg_frame_interval_ms: Math.round(avgInterval * 10) / 10,
        jitter_ms: Math.round(jitter * 10) / 10,
        frame_drop_rate: Math.round(dropRate * 1000) / 1000,
        rtt_ms: Math.round(rtt),
      }));
    } catch {
      // WebSocket may have closed between check and send
    }
  }, []);

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
        // Persist successful WS URL for sub-3s cold start on return visits
        if (tunnelUrlRef.current) saveLastWsUrl(tunnelUrlRef.current);
        ws.send(JSON.stringify({ type: 'handshake', client: 'shadow-driver-v3' }));
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, PING_INTERVAL);

        // Start network quality reporting for adaptive bitrate
        // Reset counters before starting the interval
        frameTimestampsRef.current = [];
        frameIntervalsRef.current = [];
        framesReceivedRef.current = 0;
        networkQualityIntervalRef.current = setInterval(() => {
          _sendNetworkQualityReport(ws);
        }, NETWORK_QUALITY_INTERVAL);
      };

      ws.onmessage = async (event) => {
        if (!isMountedRef.current) return;

        // Binary = typed camera frame (1-byte prefix + data)
        // 0x00 = main camera JPEG, 0x01 = rear-view mirror JPEG
        // 0x10 = H.264 keyframe, 0x11 = H.264 delta, 0x12 = codec config JSON
        if (event.data instanceof Blob) {
          const blob = event.data as Blob;
          // Convert entire blob to ArrayBuffer to reliably extract type byte
          // and slice data (Safari's Blob.slice can be unreliable)
          const buffer = await blob.arrayBuffer();
          const frameType = new Uint8Array(buffer)[0];

          if (frameType === 0x10 || frameType === 0x11) {
            // H.264 frame (keyframe or delta)
            setLastFrameTime(performance.now());
            totalFrameCountRef.current += 1;
            if (h264FrameHandlerRef.current) {
              h264FrameHandlerRef.current(frameType === 0x10, buffer.slice(1));
            }
          } else if (frameType === 0x12) {
            // Codec config (JSON)
            const jsonStr = new TextDecoder().decode(buffer.slice(1));
            try {
              const config: CodecConfig = JSON.parse(jsonStr);
              console.log('[v3] Received codec config:', config.codec, config.width, 'x', config.height);
              if (codecConfigHandlerRef.current) {
                codecConfigHandlerRef.current(config);
              }
            } catch (e) {
              console.error('[v3] Failed to parse codec config:', e);
            }
          } else if (frameType === 0x01) {
            // Rear-view mirror JPEG frame
            const jpegBlob = new Blob([buffer.slice(1)], { type: 'image/jpeg' });
            if (rearFrameHandlerRef.current) {
              rearFrameHandlerRef.current(jpegBlob);
            }
          } else {
            // Main camera JPEG frame (0x00 or legacy untyped)
            const jpegBlob = new Blob([buffer.slice(1)], { type: 'image/jpeg' });
            const now = performance.now();
            setLastFrameTime(now);
            totalFrameCountRef.current += 1;
            _recordFrameArrival(now);
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

            // Codec negotiation: tell server we support H.264 WebCodecs decoding
            if (typeof VideoDecoder !== 'undefined') {
              try {
                ws.send(JSON.stringify({ type: 'codec_negotiate', codecs: ['h264'] }));
                console.log('[v3] Sent codec_negotiate: h264 supported (WebCodecs available)');
              } catch (e) {
                console.warn('[v3] Failed to send codec_negotiate:', e);
              }
            } else {
              console.log('[v3] WebCodecs VideoDecoder not available, using JPEG fallback');
            }

            // Set up WebRTC data channel for low-latency controls (UDP)
            // This works even through Cloudflare tunnels since STUN can find
            // a direct path via ICE candidates, bypassing the tunnel for input.
            // Falls back to WebSocket if data channel setup fails.
            setupDataChannel(ws);
          } else if (data.type === 'dc_answer') {
            // Server's SDP answer for the data channel peer connection
            const answer = data as { sdp: string; sdpType: RTCSdpType };
            try {
              if (dcPcRef.current) {
                await dcPcRef.current.setRemoteDescription(
                  new RTCSessionDescription({ sdp: answer.sdp, type: answer.sdpType })
                );
                console.log('[DC] Data channel answer applied');
              }
            } catch (err) {
              console.warn('[DC] Failed to apply data channel answer:', err);
              if (isMountedRef.current) setDataChannelState('failed');
            }
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
              lastRttRef.current = ms; // Also track for network quality reports
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
            noChangeCountRef.current += 1;
          } else if (data.type === 'perf_stats') {
            // Server performance stats for debug overlay
            const perf = data as import('../types/index.ts').PerfStats;
            setPerfStats(perf);
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
            clearLastWsUrl(); // Server is gone — don't auto-reconnect
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
          clearLastWsUrl(); // Saved URL is stale — don't auto-reconnect to a dead server
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
  }, [closeWebSocket, clearPingInterval, _sendNetworkQualityReport, setupDataChannel]);

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
    const json = JSON.stringify(msg);

    // Prefer WebRTC data channel (UDP, lower latency) if available
    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(json);
        return;
      } catch {
        // Data channel send failed, fall through to WebSocket
      }
    }

    // Fallback: send via WebSocket (TCP)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(json);
    }
  }, []);

  const sendStartRace = useCallback((track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string, postprocess?: string) => {
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
    if (postprocess) {
      msg.postprocess = postprocess;
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

  const sendAmbientWeather = useCallback((sunAltitude: number, cloudiness: number, precipitation: number) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'ambient_weather',
      sun_altitude: sunAltitude,
      cloudiness,
      precipitation,
    }));
  }, []);

  const onBinaryFrame = useCallback((handler: ((data: Blob) => void) | null) => {
    binaryFrameHandlerRef.current = handler;
  }, []);

  const onRearFrame = useCallback((handler: ((data: Blob) => void) | null) => {
    rearFrameHandlerRef.current = handler;
  }, []);

  const onH264Frame = useCallback((handler: ((isKeyframe: boolean, data: ArrayBuffer) => void) | null) => {
    h264FrameHandlerRef.current = handler;
  }, []);

  const onCodecConfig = useCallback((handler: ((config: CodecConfig) => void) | null) => {
    codecConfigHandlerRef.current = handler;
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
    perfStats,
    noChangeCount: noChangeCountRef.current,
    totalFrameCount: totalFrameCountRef.current,
    startGPU, stopGPU, sendControls, sendStartRace, sendSwitchModel, sendRespawn, sendRestartRace, sendCameraMode, sendPause, sendResume, sendAmbientWeather,
    connectDirect, clearError, onBinaryFrame, onRearFrame, onH264Frame, onCodecConfig, remoteStream,
    isConnected: connectionState === 'connected',
    isProvisioningActive: provisioningState === 'starting' || provisioningState === 'running',
    dataChannelState,
  };
}

export default useGPUConnection;
