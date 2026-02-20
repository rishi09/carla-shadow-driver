/**
 * useWebMIDI.ts - WebMIDI DJ Mode
 *
 * Connect a MIDI controller via the Web MIDI API to DJ race conditions.
 * Maps CC (Control Change) knobs/faders to weather, camera, and audio parameters.
 *
 * CC Mappings:
 *   CC 1  (Mod Wheel)  -> Sun altitude angle (-90 to +90)
 *   CC 2               -> Cloudiness (0 to 100%)
 *   CC 3               -> Rain intensity (0 to 100%)
 *   CC 4               -> Fog density (0 to 100%)
 *   CC 7  (Volume)     -> Master volume (0 to 1)
 *   CC 10 (Pan)        -> Camera zoom offset (-0.5 to +0.5)
 *   CC 11              -> Wind intensity (0 to 100%)
 *
 * Weather updates are batched at 5Hz (every 200ms) to avoid overwhelming the server.
 * Chrome/Edge only -- feature-detected via navigator.requestMIDIAccess.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

/** Parameter names mapped from MIDI CC */
export type MIDIParamName =
  | 'sunAltitude'
  | 'cloudiness'
  | 'rain'
  | 'fog'
  | 'masterVolume'
  | 'cameraZoom'
  | 'wind';

/** Maps CC number -> parameter name + normalization range */
interface CCMapping {
  param: MIDIParamName;
  /** Min value in the output range */
  min: number;
  /** Max value in the output range */
  max: number;
  /** Color category for UI: 'weather' | 'camera' | 'audio' */
  category: 'weather' | 'camera' | 'audio';
  /** Human-readable label */
  label: string;
}

const CC_MAPPINGS: Record<number, CCMapping> = {
  1:  { param: 'sunAltitude',  min: -90, max: 90,   category: 'weather', label: 'Sun Altitude' },
  2:  { param: 'cloudiness',   min: 0,   max: 100,  category: 'weather', label: 'Cloudiness' },
  3:  { param: 'rain',         min: 0,   max: 100,  category: 'weather', label: 'Rain' },
  4:  { param: 'fog',          min: 0,   max: 100,  category: 'weather', label: 'Fog' },
  7:  { param: 'masterVolume', min: 0,   max: 1,    category: 'audio',   label: 'Volume' },
  10: { param: 'cameraZoom',   min: -0.5, max: 0.5, category: 'camera',  label: 'Camera Zoom' },
  11: { param: 'wind',         min: 0,   max: 100,  category: 'weather', label: 'Wind' },
};

/** Default values for all MIDI parameters */
const DEFAULT_VALUES: Record<MIDIParamName, number> = {
  sunAltitude: 45,
  cloudiness: 10,
  rain: 0,
  fog: 0,
  masterVolume: 0.8,
  cameraZoom: 0,
  wind: 0,
};

/** Normalize a MIDI value (0-127) to a target range [min, max] */
function normalizeMIDI(value: number, min: number, max: number): number {
  const t = value / 127;
  return min + t * (max - min);
}

/** Weather update batch interval in ms (5Hz) */
const WEATHER_BATCH_INTERVAL = 200;

export interface WebMIDIState {
  /** Whether the Web MIDI API is available in this browser */
  isSupported: boolean;
  /** Whether a MIDI device is currently connected */
  isConnected: boolean;
  /** Name of the connected MIDI device (null if none) */
  deviceName: string | null;
  /** Current normalized parameter values */
  values: Record<MIDIParamName, number>;
  /** Whether MIDI DJ mode is actively enabled by the user */
  isEnabled: boolean;
  /** Whether weather values have changed since last batch send */
  weatherDirty: boolean;
  /** Enable MIDI DJ mode (requests MIDI access) */
  enable: () => void;
  /** Disable MIDI DJ mode (disconnects listeners) */
  disable: () => void;
}

export function useWebMIDI(): WebMIDIState {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [values, setValues] = useState<Record<MIDIParamName, number>>({ ...DEFAULT_VALUES });

  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const isMountedRef = useRef(true);
  const valuesRef = useRef<Record<MIDIParamName, number>>({ ...DEFAULT_VALUES });
  const weatherDirtyRef = useRef(false);
  const [weatherDirty, setWeatherDirty] = useState(false);
  const batchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Feature detection
  const isSupported = typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

  /** Handle incoming MIDI messages */
  const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;

    // CC messages: status byte 0xB0-0xBF (channel 1-16), CC number, value
    const status = data[0] & 0xf0;
    if (status !== 0xb0) return; // Not a Control Change message

    const ccNumber = data[1];
    const ccValue = data[2];

    const mapping = CC_MAPPINGS[ccNumber];
    if (!mapping) return;

    const normalizedValue = normalizeMIDI(ccValue, mapping.min, mapping.max);

    // Update values ref (immediate, no re-render)
    valuesRef.current = { ...valuesRef.current, [mapping.param]: normalizedValue };

    // Mark weather dirty if this is a weather param
    if (mapping.category === 'weather') {
      weatherDirtyRef.current = true;
    }

    // Update React state
    if (isMountedRef.current) {
      setValues({ ...valuesRef.current });
      if (mapping.category === 'weather') {
        setWeatherDirty(true);
      }
    }
  }, []);

  /** Scan connected MIDI inputs and attach listeners */
  const attachInputs = useCallback((midiAccess: MIDIAccess) => {
    let foundDevice: string | null = null;

    midiAccess.inputs.forEach((input) => {
      if (!foundDevice) {
        foundDevice = input.name || 'Unknown MIDI Device';
      }
      // Remove old listener (idempotent) and add new one
      input.onmidimessage = handleMIDIMessage;
    });

    if (isMountedRef.current) {
      setIsConnected(!!foundDevice);
      setDeviceName(foundDevice);
    }
  }, [handleMIDIMessage]);

  /** Handle MIDI device connection/disconnection */
  const handleStateChange = useCallback(() => {
    const midiAccess = midiAccessRef.current;
    if (!midiAccess) return;
    attachInputs(midiAccess);
  }, [attachInputs]);

  /** Enable MIDI DJ mode */
  const enable = useCallback(async () => {
    if (!isSupported) return;
    if (isEnabled) return;

    try {
      const midiAccess = await (navigator as Navigator & { requestMIDIAccess: () => Promise<MIDIAccess> }).requestMIDIAccess();
      midiAccessRef.current = midiAccess;

      // Attach to all current inputs
      attachInputs(midiAccess);

      // Listen for device connection/disconnection
      midiAccess.onstatechange = handleStateChange;

      // Start weather batch interval (5Hz)
      batchIntervalRef.current = setInterval(() => {
        if (weatherDirtyRef.current && isMountedRef.current) {
          weatherDirtyRef.current = false;
          setWeatherDirty(false);
          // The actual sending happens in Race.tsx via useEffect watching values
          // We just need to pulse the dirty flag so it knows to send
          setWeatherDirty(prev => !prev); // toggle to trigger effect
          setWeatherDirty(false);
        }
      }, WEATHER_BATCH_INTERVAL);

      if (isMountedRef.current) {
        setIsEnabled(true);
      }
    } catch (err) {
      console.warn('[WebMIDI] Failed to request MIDI access:', err);
    }
  }, [isSupported, isEnabled, attachInputs, handleStateChange]);

  /** Disable MIDI DJ mode */
  const disable = useCallback(() => {
    // Remove MIDI message listeners from all inputs
    if (midiAccessRef.current) {
      midiAccessRef.current.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      midiAccessRef.current.onstatechange = null;
      midiAccessRef.current = null;
    }

    // Stop batch interval
    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }

    // Reset state
    if (isMountedRef.current) {
      setIsEnabled(false);
      setIsConnected(false);
      setDeviceName(null);
      setValues({ ...DEFAULT_VALUES });
      setWeatherDirty(false);
    }
    valuesRef.current = { ...DEFAULT_VALUES };
    weatherDirtyRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (midiAccessRef.current) {
        midiAccessRef.current.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
        midiAccessRef.current.onstatechange = null;
        midiAccessRef.current = null;
      }
      if (batchIntervalRef.current) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isConnected,
    deviceName,
    values,
    isEnabled,
    weatherDirty,
    enable,
    disable,
  };
}

/** Export CC_MAPPINGS for use by the overlay component */
export { CC_MAPPINGS };
export type { CCMapping };
