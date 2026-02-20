/**
 * useTabRearview.ts - Second browser tab as rearview mirror
 *
 * Uses BroadcastChannel API to send frame data to a second tab
 * that displays only the rearview camera feed. The main tab sends
 * frames; the mirror tab receives and displays them.
 *
 * Wild Idea #6 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// --- Constants ---
const CHANNEL_NAME = 'shadow-driver-rearview';
const PING_INTERVAL_MS = 2000;
const DISCONNECT_TIMEOUT_MS = 5000;
const FRAME_THROTTLE_MS = 1000 / 15; // 15fps max

// --- Types ---
type RearviewMessage =
  | { type: 'frame'; data: string }
  | { type: 'telemetry'; speed: number; gear: string }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'close' };

interface UseTabRearviewOptions {
  enabled: boolean;
  role: 'sender' | 'receiver';
}

export interface UseTabRearviewReturn {
  sendFrame: (frameData: Blob | ArrayBuffer | string) => void;
  sendTelemetry: (speed: number, gear: string) => void;
  isMirrorConnected: boolean;
  openMirrorTab: () => void;
  closeMirrorTab: () => void;
  lastFrame: string | null;
  telemetry: { speed: number; gear: string } | null;
  isConnected: boolean;
}

/** Convert Blob or ArrayBuffer to base64 string */
async function toBase64(data: Blob | ArrayBuffer): Promise<string> {
  const blob = data instanceof Blob ? data : new Blob([data]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- Hook ---
export function useTabRearview(options: UseTabRearviewOptions): UseTabRearviewReturn {
  const { enabled, role } = options;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const mirrorWindowRef = useRef<Window | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameSentRef = useRef<number>(0);

  // Sender state
  const [isMirrorConnected, setIsMirrorConnected] = useState(false);
  const lastPongRef = useRef<number>(0);

  // Receiver state
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<{ speed: number; gear: string } | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const lastFrameReceivedRef = useRef<number>(0);
  const disconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Post message helper
  const postMessage = useCallback((msg: RearviewMessage) => {
    try { channelRef.current?.postMessage(msg); } catch { /* channel closed */ }
  }, []);

  // Sender: send a frame (throttled to 15fps)
  const sendFrame = useCallback(async (frameData: Blob | ArrayBuffer | string) => {
    if (!enabled || role !== 'sender') return;
    const now = performance.now();
    if (now - lastFrameSentRef.current < FRAME_THROTTLE_MS) return;
    lastFrameSentRef.current = now;

    let base64Data: string;
    if (typeof frameData === 'string') {
      base64Data = frameData;
    } else {
      try { base64Data = await toBase64(frameData); } catch { return; }
    }
    postMessage({ type: 'frame', data: base64Data });
  }, [enabled, role, postMessage]);

  // Sender: send telemetry
  const sendTelemetry = useCallback((speed: number, gear: string) => {
    if (!enabled || role !== 'sender') return;
    postMessage({ type: 'telemetry', speed, gear });
  }, [enabled, role, postMessage]);

  // Sender: open the mirror tab
  const openMirrorTab = useCallback(() => {
    if (role !== 'sender') return;
    if (mirrorWindowRef.current && !mirrorWindowRef.current.closed) {
      mirrorWindowRef.current.focus();
      return;
    }
    const url = window.location.origin + '/race?rearview=true';
    mirrorWindowRef.current = window.open(url, 'rearview', 'width=400,height=300');
  }, [role]);

  // Sender: close the mirror tab
  const closeMirrorTab = useCallback(() => {
    if (role !== 'sender') return;
    postMessage({ type: 'close' });
    if (mirrorWindowRef.current && !mirrorWindowRef.current.closed) {
      mirrorWindowRef.current.close();
    }
    mirrorWindowRef.current = null;
    setIsMirrorConnected(false);
  }, [role, postMessage]);

  // Setup BroadcastChannel and listeners
  useEffect(() => {
    if (!enabled) return;
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[rearview] BroadcastChannel not supported in this browser');
      return;
    }

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    if (role === 'sender') {
      // Listen for pong messages to detect mirror connection
      channel.onmessage = (event: MessageEvent<RearviewMessage>) => {
        if (event.data.type === 'pong') {
          lastPongRef.current = Date.now();
          setIsMirrorConnected(true);
        }
      };

      // Send pings every 2 seconds, detect mirror disconnect after 5s
      pingIntervalRef.current = setInterval(() => {
        try { channel.postMessage({ type: 'ping' } as RearviewMessage); } catch { /* ok */ }
        if (lastPongRef.current > 0 && Date.now() - lastPongRef.current > DISCONNECT_TIMEOUT_MS) {
          setIsMirrorConnected(false);
        }
      }, PING_INTERVAL_MS);

      // Send close message on window unload
      const handleUnload = () => {
        try { channel.postMessage({ type: 'close' } as RearviewMessage); } catch { /* ok */ }
      };
      window.addEventListener('beforeunload', handleUnload);

      return () => {
        window.removeEventListener('beforeunload', handleUnload);
        if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
        try { channel.close(); } catch { /* ok */ }
        channelRef.current = null;
      };
    }

    // Receiver role
    channel.onmessage = (event: MessageEvent<RearviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'frame':
          lastFrameReceivedRef.current = Date.now();
          setIsConnected(true);
          setLastFrame(msg.data);
          break;
        case 'telemetry':
          setTelemetry({ speed: msg.speed, gear: msg.gear });
          break;
        case 'ping':
          try { channel.postMessage({ type: 'pong' } as RearviewMessage); } catch { /* ok */ }
          break;
        case 'close':
          setIsConnected(false);
          setLastFrame(null);
          setTelemetry(null);
          break;
      }
    };

    // Detect disconnect: no frames for 5 seconds
    disconnectTimerRef.current = setInterval(() => {
      if (lastFrameReceivedRef.current > 0 && Date.now() - lastFrameReceivedRef.current > DISCONNECT_TIMEOUT_MS) {
        setIsConnected(false);
      }
    }, 1000);

    return () => {
      if (disconnectTimerRef.current) { clearInterval(disconnectTimerRef.current); disconnectTimerRef.current = null; }
      try { channel.close(); } catch { /* ok */ }
      channelRef.current = null;
    };
  }, [enabled, role]);

  return {
    sendFrame,
    sendTelemetry,
    isMirrorConnected: role === 'sender' ? isMirrorConnected : false,
    openMirrorTab,
    closeMirrorTab,
    lastFrame: role === 'receiver' ? lastFrame : null,
    telemetry: role === 'receiver' ? telemetry : null,
    isConnected: role === 'receiver' ? isConnected : false,
  };
}

export default useTabRearview;
