/**
 * useHeartbeatAudio.ts - Heartbeat Audio Scaling (Wild Idea #35)
 *
 * Drives game audio intensity from heart rate data. Supports two input modes:
 *   1. Web Bluetooth HR sensor (service UUID 0x180D, characteristic 0x2A37)
 *   2. Simulated heartbeat fallback: base 70 BPM + 0.3 BPM per km/h speed + collision spikes
 *
 * Outputs heart-rate-derived multipliers for tunnel vignette, music intensity,
 * engine volume, and an overall intensity value (0-1) mapped to HR zones.
 * Also synthesises a subtle "lub-dub" heartbeat sound via Web Audio oscillators
 * that plays at the detected BPM.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Web Bluetooth type declarations (no @types/web-bluetooth in project)
// ---------------------------------------------------------------------------
declare global {
  interface BluetoothRequestDeviceFilter {
    services?: BluetoothServiceUUID[];
    name?: string;
    namePrefix?: string;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
  }

  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly value: DataView | null;
    readonly uuid: string;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    readValue(): Promise<DataView>;
    addEventListener(
      type: 'characteristicvaluechanged',
      listener: (event: Event & { target: BluetoothRemoteGATTCharacteristic }) => void,
    ): void;
    removeEventListener(
      type: 'characteristicvaluechanged',
      listener: (event: Event & { target: BluetoothRemoteGATTCharacteristic }) => void,
    ): void;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTServer {
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothDevice extends EventTarget {
    readonly gatt?: BluetoothRemoteGATTServer;
    readonly name?: string;
  }

  interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
    getAvailability(): Promise<boolean>;
  }

  interface Navigator {
    bluetooth?: Bluetooth;
  }

  type BluetoothServiceUUID = number | string;
  type BluetoothCharacteristicUUID = number | string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HR zone boundaries (BPM) */
const ZONE_RESTING_MAX = 90;
const ZONE_WARMUP_MAX = 110;
const ZONE_AEROBIC_MAX = 140;
const ZONE_THRESHOLD_MAX = 170;
// Anything above ZONE_THRESHOLD_MAX is 'max'

/** Clamp range for heart rate */
const HR_MIN = 60;
const HR_MAX = 200;

/** Simulated HR parameters */
const SIM_BASE_BPM = 70;
const SIM_SPEED_FACTOR = 0.3;        // +0.3 BPM per km/h
const SIM_COLLISION_SPIKE = 25;       // instant +25 BPM on collision
const SIM_COLLISION_DECAY = 0.92;     // per-tick decay factor for spike
const SIM_SMOOTHING = 0.05;           // exponential smoothing alpha

/** Heartbeat sound (lub-dub) */
const LUB_FREQ = 55;       // Hz - first thump
const DUB_FREQ = 45;       // Hz - second thump
const LUB_DURATION = 0.07; // seconds
const DUB_DURATION = 0.05;
const DUB_DELAY = 0.10;    // seconds after lub onset
const LUB_VOLUME = 0.25;   // subtle
const DUB_VOLUME = 0.15;
const ATTACK_MS = 0.004;
const RELEASE_MS = 0.035;

/** Bluetooth Heart Rate Service / Characteristic UUIDs */
const HR_SERVICE_UUID = 0x180d;
const HR_CHARACTERISTIC_UUID = 0x2a37;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeartRateZone = 'resting' | 'warmup' | 'aerobic' | 'threshold' | 'max';

export interface UseHeartbeatAudioOptions {
  /** Master enable switch */
  enabled: boolean;
  /** Current vehicle speed in km/h (used for simulated HR) */
  speed: number;
}

export interface UseHeartbeatAudioReturn {
  /** Current heart rate in BPM (60-200) */
  heartRate: number;
  /** Normalised intensity 0-1 mapped from HR zones */
  intensity: number;
  /** Current HR zone label */
  zone: HeartRateZone;
  /** Tunnel vignette strength (0-0.5) */
  tunnelVignette: number;
  /** Multiplier for background music intensity (0.8-1.5) */
  musicIntensityMultiplier: number;
  /** Multiplier for engine volume (0.9-1.3) */
  engineVolumeMultiplier: number;
  /** Whether a Bluetooth HR sensor is connected */
  isConnected: boolean;
  /** Data source currently in use */
  source: 'bluetooth' | 'simulated';
  /** Attempt to pair a Web Bluetooth HR sensor */
  connectBluetooth: () => Promise<void>;
  /** Whether the hook is enabled */
  enabled: boolean;
  /** Toggle the hook on/off */
  setEnabled: (v: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampHR(hr: number): number {
  return Math.max(HR_MIN, Math.min(HR_MAX, hr));
}

function hrToZone(hr: number): HeartRateZone {
  if (hr <= ZONE_RESTING_MAX) return 'resting';
  if (hr <= ZONE_WARMUP_MAX) return 'warmup';
  if (hr <= ZONE_AEROBIC_MAX) return 'aerobic';
  if (hr <= ZONE_THRESHOLD_MAX) return 'threshold';
  return 'max';
}

/** Map HR (60-200) to a 0-1 intensity value */
function hrToIntensity(hr: number): number {
  return Math.max(0, Math.min(1, (hr - HR_MIN) / (HR_MAX - HR_MIN)));
}

/** Map intensity (0-1) to tunnel vignette (0-0.5) */
function intensityToVignette(intensity: number): number {
  // Only start vignette above 0.4 intensity (aerobic zone)
  if (intensity < 0.4) return 0;
  return ((intensity - 0.4) / 0.6) * 0.5;
}

/** Map intensity (0-1) to music multiplier (0.8-1.5) */
function intensityToMusicMultiplier(intensity: number): number {
  return 0.8 + intensity * 0.7;
}

/** Map intensity (0-1) to engine volume multiplier (0.9-1.3) */
function intensityToEngineMultiplier(intensity: number): number {
  return 0.9 + intensity * 0.4;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHeartbeatAudio(options: UseHeartbeatAudioOptions): UseHeartbeatAudioReturn {
  const { enabled: enabledProp, speed } = options;

  // --- State ---
  const [enabled, setEnabled] = useState(enabledProp);
  const [heartRate, setHeartRate] = useState(SIM_BASE_BPM);
  const [isConnected, setIsConnected] = useState(false);
  const [source, setSource] = useState<'bluetooth' | 'simulated'>('simulated');

  // --- Refs ---
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const beatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBeatingRef = useRef(false);

  // Simulated HR state
  const simHRRef = useRef(SIM_BASE_BPM);
  const collisionSpikeRef = useRef(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bluetooth refs
  const btDeviceRef = useRef<BluetoothDevice | null>(null);
  const btCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const btListenerRef = useRef<((e: Event & { target: BluetoothRemoteGATTCharacteristic }) => void) | null>(null);

  // Latest values for scheduling (avoids stale closures)
  const heartRateRef = useRef(SIM_BASE_BPM);
  const enabledRef = useRef(enabled);
  const speedRef = useRef(speed);

  // Keep refs in sync
  enabledRef.current = enabled;
  speedRef.current = speed;

  // Sync prop -> state
  useEffect(() => {
    setEnabled(enabledProp);
  }, [enabledProp]);

  // -----------------------------------------------------------------
  // Audio context (lazy init)
  // -----------------------------------------------------------------
  const getOrCreateCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      return ctxRef.current;
    }
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      masterGainRef.current = gain;
      return ctx;
    } catch {
      return null;
    }
  }, []);

  // -----------------------------------------------------------------
  // Play a single lub-dub heartbeat
  // -----------------------------------------------------------------
  const playLubDub = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || ctx.state !== 'running') return;

    const now = ctx.currentTime;

    // --- Lub ---
    const lubOsc = ctx.createOscillator();
    lubOsc.type = 'sine';
    lubOsc.frequency.value = LUB_FREQ;

    const lubGain = ctx.createGain();
    lubGain.gain.setValueAtTime(0, now);
    lubGain.gain.linearRampToValueAtTime(LUB_VOLUME, now + ATTACK_MS);
    lubGain.gain.setValueAtTime(LUB_VOLUME, now + LUB_DURATION - RELEASE_MS);
    lubGain.gain.exponentialRampToValueAtTime(0.001, now + LUB_DURATION);

    lubOsc.connect(lubGain);
    lubGain.connect(master);
    lubOsc.start(now);
    lubOsc.stop(now + LUB_DURATION + 0.01);

    // --- Dub ---
    const dubStart = now + DUB_DELAY;
    const dubOsc = ctx.createOscillator();
    dubOsc.type = 'sine';
    dubOsc.frequency.value = DUB_FREQ;

    const dubGain = ctx.createGain();
    dubGain.gain.setValueAtTime(0, dubStart);
    dubGain.gain.linearRampToValueAtTime(DUB_VOLUME, dubStart + ATTACK_MS);
    dubGain.gain.setValueAtTime(DUB_VOLUME, dubStart + DUB_DURATION - RELEASE_MS);
    dubGain.gain.exponentialRampToValueAtTime(0.001, dubStart + DUB_DURATION);

    dubOsc.connect(dubGain);
    dubGain.connect(master);
    dubOsc.start(dubStart);
    dubOsc.stop(dubStart + DUB_DURATION + 0.01);
  }, []);

  // -----------------------------------------------------------------
  // Beat scheduling loop
  // -----------------------------------------------------------------
  const scheduleNextBeat = useCallback(() => {
    if (!isBeatingRef.current) return;

    const bpm = heartRateRef.current;
    if (bpm <= 0) return;

    const intervalMs = (60 / bpm) * 1000;

    beatTimerRef.current = setTimeout(() => {
      if (!isBeatingRef.current || !enabledRef.current) return;
      playLubDub();
      scheduleNextBeat();
    }, intervalMs);
  }, [playLubDub]);

  const startBeating = useCallback(() => {
    if (isBeatingRef.current) return;

    const ctx = getOrCreateCtx();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    isBeatingRef.current = true;
    playLubDub();
    scheduleNextBeat();
  }, [getOrCreateCtx, playLubDub, scheduleNextBeat]);

  const stopBeating = useCallback(() => {
    isBeatingRef.current = false;
    if (beatTimerRef.current !== null) {
      clearTimeout(beatTimerRef.current);
      beatTimerRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------
  // Simulated HR tick (runs at ~10 Hz)
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled || source === 'bluetooth') {
      // Stop simulation when BT is active or hook disabled
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      return;
    }

    simIntervalRef.current = setInterval(() => {
      // Target HR = base + speed contribution + collision spike
      const target = SIM_BASE_BPM + speedRef.current * SIM_SPEED_FACTOR + collisionSpikeRef.current;

      // Exponential smoothing toward target
      simHRRef.current += (target - simHRRef.current) * SIM_SMOOTHING;
      const clamped = clampHR(simHRRef.current);

      heartRateRef.current = clamped;
      setHeartRate(Math.round(clamped));

      // Decay collision spike
      collisionSpikeRef.current *= SIM_COLLISION_DECAY;
      if (collisionSpikeRef.current < 0.5) collisionSpikeRef.current = 0;
    }, 100);

    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [enabled, source]);

  // -----------------------------------------------------------------
  // Start/stop heartbeat audio when enabled changes
  // -----------------------------------------------------------------
  useEffect(() => {
    if (enabled) {
      startBeating();
    } else {
      stopBeating();
    }
  }, [enabled, startBeating, stopBeating]);

  // -----------------------------------------------------------------
  // Bluetooth connection
  // -----------------------------------------------------------------
  const cleanupBluetooth = useCallback(() => {
    // Remove characteristic listener
    if (btCharRef.current && btListenerRef.current) {
      try {
        btCharRef.current.removeEventListener('characteristicvaluechanged', btListenerRef.current);
        void btCharRef.current.stopNotifications();
      } catch {
        // already disconnected
      }
    }
    btCharRef.current = null;
    btListenerRef.current = null;

    // Disconnect GATT server
    if (btDeviceRef.current?.gatt?.connected) {
      try {
        btDeviceRef.current.gatt.disconnect();
      } catch {
        // ok
      }
    }
    btDeviceRef.current = null;

    setIsConnected(false);
    setSource('simulated');
  }, []);

  const connectBluetooth = useCallback(async () => {
    if (!navigator.bluetooth) {
      console.warn('[HeartbeatAudio] Web Bluetooth not available in this browser');
      return;
    }

    try {
      // Clean up any previous connection
      cleanupBluetooth();

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HR_SERVICE_UUID] }],
      });

      btDeviceRef.current = device;

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(HR_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(HR_CHARACTERISTIC_UUID);
      btCharRef.current = characteristic;

      // Parse HR value from characteristic data (BLE HR Measurement spec)
      const onValue = (event: Event & { target: BluetoothRemoteGATTCharacteristic }) => {
        const value = event.target.value;
        if (!value) return;

        // Bit 0 of flags byte: 0 = uint8 HR, 1 = uint16 HR
        const flags = value.getUint8(0);
        let hr: number;
        if (flags & 0x01) {
          hr = value.getUint16(1, true);
        } else {
          hr = value.getUint8(1);
        }

        const clamped = clampHR(hr);
        heartRateRef.current = clamped;
        setHeartRate(clamped);
      };

      btListenerRef.current = onValue;
      characteristic.addEventListener('characteristicvaluechanged', onValue);
      await characteristic.startNotifications();

      setIsConnected(true);
      setSource('bluetooth');

      // Listen for disconnection
      device.addEventListener('gattserverdisconnected', () => {
        console.warn('[HeartbeatAudio] Bluetooth HR sensor disconnected');
        cleanupBluetooth();
      });
    } catch (err) {
      console.warn('[HeartbeatAudio] Bluetooth connection failed:', err);
      cleanupBluetooth();
    }
  }, [cleanupBluetooth]);

  // -----------------------------------------------------------------
  // Public method: trigger a collision spike (for simulated mode)
  // Exposed indirectly -- callers can just bump speed or we expose via ref.
  // For simplicity, we use a window event pattern.
  // -----------------------------------------------------------------
  useEffect(() => {
    const handleCollision = () => {
      if (source === 'simulated') {
        collisionSpikeRef.current = Math.min(
          collisionSpikeRef.current + SIM_COLLISION_SPIKE,
          80, // cap cumulative spike at 80 BPM above base
        );
      }
    };

    window.addEventListener('heartbeat-collision', handleCollision);
    return () => window.removeEventListener('heartbeat-collision', handleCollision);
  }, [source]);

  // -----------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------
  useEffect(() => {
    return () => {
      // Stop beat loop
      isBeatingRef.current = false;
      if (beatTimerRef.current !== null) {
        clearTimeout(beatTimerRef.current);
        beatTimerRef.current = null;
      }

      // Stop simulation
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }

      // Disconnect Bluetooth
      if (btCharRef.current && btListenerRef.current) {
        try {
          btCharRef.current.removeEventListener('characteristicvaluechanged', btListenerRef.current);
          void btCharRef.current.stopNotifications();
        } catch { /* ok */ }
      }
      if (btDeviceRef.current?.gatt?.connected) {
        try { btDeviceRef.current.gatt.disconnect(); } catch { /* ok */ }
      }

      // Close audio context
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        try { void ctxRef.current.close(); } catch { /* ok */ }
      }
      ctxRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  // -----------------------------------------------------------------
  // Derived values (memoised)
  // -----------------------------------------------------------------
  return useMemo(() => {
    const intensity = hrToIntensity(heartRate);
    const zone = hrToZone(heartRate);
    const tunnelVignette = intensityToVignette(intensity);
    const musicIntensityMultiplier = intensityToMusicMultiplier(intensity);
    const engineVolumeMultiplier = intensityToEngineMultiplier(intensity);

    return {
      heartRate,
      intensity,
      zone,
      tunnelVignette,
      musicIntensityMultiplier,
      engineVolumeMultiplier,
      isConnected,
      source,
      connectBluetooth,
      enabled,
      setEnabled,
    };
  }, [heartRate, isConnected, source, connectBluetooth, enabled]);
}

export default useHeartbeatAudio;
