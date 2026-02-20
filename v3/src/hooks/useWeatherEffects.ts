/**
 * useWeatherEffects.ts - Maps weather presets and server telemetry to
 * client-side visual/audio effect parameters.
 *
 * Weather sources (priority order):
 *   1. Server `weather_mood` telemetry (precipitation, fog_density, wind_intensity, etc.)
 *   2. User-selected weather preset from RaceSetup (clear / cloudy / rain / storm / sunset / night)
 *
 * The hook outputs a normalized WeatherEffectState consumed by <WeatherEffects />.
 */

import { useMemo, useRef, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherMoodTelemetry {
  mood: 'CALM' | 'BUILDING' | 'TENSE' | 'DRAMATIC' | 'EPIC' | 'FINALE' | 'NIGHT_TENSE';
  intensity: number;
  precipitation: number;
  fog_density: number;
  wind_intensity: number;
  cloudiness: number;
  wetness?: number;
}

/** Normalized effect parameters consumed by <WeatherEffects /> */
export interface WeatherEffectState {
  /** Rain intensity 0-1 (0 = none, 1 = heavy downpour) */
  rain: number;
  /** Snow intensity 0-1 */
  snow: number;
  /** Fog density 0-1 */
  fog: number;
  /** Wind strength 0-1 (affects rain angle and snow drift) */
  wind: number;
  /** Whether thunder/lightning is active */
  thunder: boolean;
  /** Overall intensity multiplier 0-1 */
  intensity: number;
}

// ---------------------------------------------------------------------------
// Preset mappings
// ---------------------------------------------------------------------------

/** Map the user-selected weather string to baseline effect params */
function presetToEffects(preset: string): WeatherEffectState {
  switch (preset) {
    case 'rain':
      return { rain: 0.5, snow: 0, fog: 0.1, wind: 0.3, thunder: false, intensity: 0.6 };
    case 'storm':
      return { rain: 0.9, snow: 0, fog: 0.15, wind: 0.7, thunder: true, intensity: 0.9 };
    case 'cloudy':
      return { rain: 0, snow: 0, fog: 0.08, wind: 0.15, thunder: false, intensity: 0.2 };
    case 'sunset':
      return { rain: 0, snow: 0, fog: 0.05, wind: 0.05, thunder: false, intensity: 0.1 };
    case 'night':
      return { rain: 0, snow: 0, fog: 0.12, wind: 0.05, thunder: false, intensity: 0.15 };
    case 'snow':
      return { rain: 0, snow: 0.6, fog: 0.2, wind: 0.2, thunder: false, intensity: 0.5 };
    case 'clear':
    default:
      return { rain: 0, snow: 0, fog: 0, wind: 0, thunder: false, intensity: 0 };
  }
}

/** Override baseline effects with live server telemetry when available */
function applyTelemetry(
  base: WeatherEffectState,
  telemetry: WeatherMoodTelemetry,
): WeatherEffectState {
  const precipitation = telemetry.precipitation / 100; // 0-100 -> 0-1
  const fogDensity = telemetry.fog_density / 100;
  const windIntensity = telemetry.wind_intensity / 100;
  const intensity = telemetry.intensity; // already 0-1

  // Determine if this is heavy enough for thunder
  const mood = telemetry.mood;
  const hasThunder = mood === 'EPIC' || mood === 'DRAMATIC' || (precipitation > 0.6 && windIntensity > 0.4);

  return {
    rain: Math.max(base.rain, precipitation),
    snow: base.snow, // server doesn't distinguish snow; keep preset value
    fog: Math.max(base.fog, fogDensity),
    wind: Math.max(base.wind, windIntensity),
    thunder: base.thunder || hasThunder,
    intensity: Math.max(base.intensity, intensity),
  };
}

// ---------------------------------------------------------------------------
// Thunder audio
// ---------------------------------------------------------------------------

class ThunderAudio {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** Play a sub-bass rumble: 40-60 Hz sine wave, 300ms decay */
  playRumble(): void {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(40 + Math.random() * 20, ctx.currentTime);
      // Slight frequency drop for realism
      osc.frequency.linearRampToValueAtTime(30 + Math.random() * 10, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio context might be blocked by the browser
    }
  }

  destroy(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.ctx = null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWeatherEffects(
  weatherPreset: string,
  weatherMood?: WeatherMoodTelemetry | null,
) {
  const thunderAudioRef = useRef<ThunderAudio | null>(null);

  // Compute the combined effect state
  const effectState = useMemo<WeatherEffectState>(() => {
    const base = presetToEffects(weatherPreset);
    if (weatherMood) {
      return applyTelemetry(base, weatherMood);
    }
    return base;
  }, [weatherPreset, weatherMood]);

  // Lazy-init thunder audio
  const getThunderAudio = useCallback((): ThunderAudio => {
    if (!thunderAudioRef.current) {
      thunderAudioRef.current = new ThunderAudio();
    }
    return thunderAudioRef.current;
  }, []);

  /** Play a thunder rumble sound */
  const playThunder = useCallback(() => {
    getThunderAudio().playRumble();
  }, [getThunderAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      thunderAudioRef.current?.destroy();
      thunderAudioRef.current = null;
    };
  }, []);

  return {
    effectState,
    playThunder,
  };
}
