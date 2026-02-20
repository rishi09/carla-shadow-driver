import { useRef, useEffect, useState, useCallback, useMemo } from 'react';

/**
 * Server-driven weather mood data (from RaceState.weather_mood).
 * Used as the primary source for effect intensities.
 */
interface WeatherMood {
  mood: 'CALM' | 'BUILDING' | 'TENSE' | 'DRAMATIC' | 'EPIC' | 'FINALE' | 'NIGHT_TENSE';
  intensity: number;
  precipitation: number;
  fog_density: number;
  wind_intensity: number;
  cloudiness: number;
  wetness?: number;
}

/**
 * Derived weather parameters used internally for rendering effects.
 * Values are normalized 0-1 unless noted.
 */
interface WeatherParams {
  /** Precipitation intensity 0-1 (0 = none, 1 = torrential) */
  precipitation: number;
  /** Fog density 0-1 */
  fogDensity: number;
  /** Wind intensity 0-1 */
  windIntensity: number;
  /** Whether to render snow instead of rain */
  isSnow: boolean;
  /** Whether thunder effects should fire */
  hasThunder: boolean;
}

interface WeatherEffectsProps {
  /** Server weather mood telemetry (primary data source) */
  weatherMood?: WeatherMood | null;
  /** Weather preset selected in RaceSetup (fallback when no server data) */
  weatherPreset?: string;
  /** Player speed for wind-angle adjustments */
  speedKmh?: number;
}

/** Map weather preset names to synthetic WeatherParams for fallback rendering */
function presetToParams(preset: string): WeatherParams {
  switch (preset) {
    case 'rain':
      return { precipitation: 0.5, fogDensity: 0.15, windIntensity: 0.3, isSnow: false, hasThunder: false };
    case 'storm':
      return { precipitation: 0.85, fogDensity: 0.25, windIntensity: 0.6, isSnow: false, hasThunder: true };
    case 'cloudy':
      return { precipitation: 0.1, fogDensity: 0.2, windIntensity: 0.15, isSnow: false, hasThunder: false };
    case 'night':
      return { precipitation: 0, fogDensity: 0.35, windIntensity: 0.05, isSnow: false, hasThunder: false };
    case 'snow':
    case 'winter':
      return { precipitation: 0.5, fogDensity: 0.3, windIntensity: 0.15, isSnow: true, hasThunder: false };
    default: // 'clear', 'sunset', etc.
      return { precipitation: 0, fogDensity: 0, windIntensity: 0, isSnow: false, hasThunder: false };
  }
}

/** Convert server weather_mood to normalized WeatherParams */
function moodToParams(mood: WeatherMood): WeatherParams {
  const precip = mood.precipitation / 100; // server sends 0-100
  const fog = mood.fog_density / 100;
  const wind = mood.wind_intensity / 100;
  const isSnow = false; // server doesn't distinguish snow -- would need preset name
  const hasThunder = precip > 0.7;
  return { precipitation: precip, fogDensity: fog, windIntensity: wind, isSnow, hasThunder };
}

// -----------------------------------------------------------------------
// Rain / Snow Particle types
// -----------------------------------------------------------------------
interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  opacity: number;
  /** Wind drift in px/frame */
  drift: number;
}

interface SnowFlake {
  x: number;
  y: number;
  speed: number;
  radius: number;
  opacity: number;
  /** Phase offset for sinusoidal horizontal drift */
  phase: number;
  /** Frequency multiplier for drift */
  freq: number;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

/**
 * Client-side weather visual effects overlay.
 *
 * Renders on a full-screen canvas + CSS layers with pointer-events: none
 * so it doesn't block controls or HUD interaction.
 *
 * Effects:
 *   Rain  -- falling angled lines (200-400 particles) when precipitation > 0.3
 *   Thunder -- screen flash + sub-bass rumble when precipitation > 0.7
 *   Fog   -- radial CSS blur + white overlay at edges when fog_density > 0.3
 *   Snow  -- gentle falling circles with sinusoidal drift + LOW GRIP warning
 */
export function WeatherEffects({ weatherMood, weatherPreset = 'clear', speedKmh = 0 }: WeatherEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const rainRef = useRef<RainDrop[]>([]);
  const snowRef = useRef<SnowFlake[]>([]);
  const paramsRef = useRef<WeatherParams>({ precipitation: 0, fogDensity: 0, windIntensity: 0, isSnow: false, hasThunder: false });
  const speedRef = useRef(speedKmh);

  // Thunder state
  const [thunderFlash, setThunderFlash] = useState(false);
  const thunderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Keep speed ref in sync without re-mounting effects
  speedRef.current = speedKmh;

  // Derive params from server mood or preset fallback
  const params = useMemo<WeatherParams>(() => {
    if (weatherMood) return moodToParams(weatherMood);
    return presetToParams(weatherPreset);
  }, [weatherMood, weatherPreset]);

  paramsRef.current = params;

  // ----- Rain particle pool -----
  const initRain = useCallback((width: number, height: number) => {
    const count = Math.floor(200 + params.precipitation * 200); // 200-400
    const drops: RainDrop[] = [];
    for (let i = 0; i < count; i++) {
      drops.push(createRainDrop(width, height, params.windIntensity, true));
    }
    rainRef.current = drops;
  }, [params.precipitation, params.windIntensity]);

  // ----- Snow particle pool -----
  const initSnow = useCallback((width: number, height: number) => {
    const count = Math.floor(100 + params.precipitation * 100); // 100-200
    const flakes: SnowFlake[] = [];
    for (let i = 0; i < count; i++) {
      flakes.push(createSnowFlake(width, height, true));
    }
    snowRef.current = flakes;
  }, [params.precipitation]);

  // ----- Canvas animation loop -----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Re-init particles on resize
      if (paramsRef.current.isSnow) {
        initSnow(canvas.width, canvas.height);
      } else {
        initRain(canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap dt at 50ms
      lastTime = now;

      const p = paramsRef.current;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      if (p.isSnow && p.precipitation > 0.3) {
        drawSnow(ctx, snowRef.current, w, h, dt);
      } else if (!p.isSnow && p.precipitation > 0.3) {
        drawRain(ctx, rainRef.current, w, h, dt, p, speedRef.current);
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [initRain, initSnow]);

  // ----- Re-init particles when precipitation changes significantly -----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (params.isSnow) {
      initSnow(canvas.width, canvas.height);
    } else {
      initRain(canvas.width, canvas.height);
    }
  }, [params.precipitation > 0.3, params.isSnow, initRain, initSnow]);

  // ----- Thunder scheduling -----
  useEffect(() => {
    if (!params.hasThunder) {
      if (thunderTimerRef.current) {
        clearTimeout(thunderTimerRef.current);
        thunderTimerRef.current = null;
      }
      return;
    }

    const scheduleThunder = () => {
      const delay = 8000 + Math.random() * 12000; // 8-20 seconds
      thunderTimerRef.current = setTimeout(() => {
        // Visual flash
        setThunderFlash(true);
        setTimeout(() => setThunderFlash(false), 50);

        // Audio rumble
        playThunderRumble();

        // Schedule next
        scheduleThunder();
      }, delay);
    };

    scheduleThunder();

    return () => {
      if (thunderTimerRef.current) {
        clearTimeout(thunderTimerRef.current);
        thunderTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.hasThunder]);

  /** Play a sub-bass thunder rumble via Web Audio API */
  const playThunderRumble = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Sub-bass oscillator (40-60Hz)
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(40 + Math.random() * 20, now);

      // Gain envelope: quick attack, 300ms decay
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // Audio not available -- fail silently
    }
  }, []);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // ----- Fog CSS -----
  const fogActive = params.fogDensity > 0.3;
  const fogOpacity = fogActive ? Math.min(0.15, (params.fogDensity - 0.3) * 0.5 + 0.10) : 0;
  const fogBlur = fogActive ? Math.min(5, 3 + (params.fogDensity - 0.3) * 6) : 0;

  // ----- Rain tint (blue edge gradient) -----
  const rainTintActive = !params.isSnow && params.precipitation > 0.3;

  // Nothing to render at all?
  const hasAnyEffect = params.precipitation > 0.3 || fogActive || params.hasThunder || params.isSnow;
  if (!hasAnyEffect && !thunderFlash) return null;

  return (
    <>
      {/* Canvas for rain / snow particles */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 11, width: '100%', height: '100%' }}
      />

      {/* Rain: subtle blue tint at screen edges */}
      {rainTintActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 10,
            background: `radial-gradient(ellipse 110% 100% at 50% 50%, transparent 55%, rgba(60,100,180,${(0.05).toFixed(3)}) 100%)`,
            transition: 'opacity 1s ease-out',
          }}
        />
      )}

      {/* Thunder: screen-wide white flash */}
      {thunderFlash && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            backgroundColor: 'rgba(255,255,255,0.15)',
            animation: 'weather-fx-flash 50ms linear forwards',
          }}
        />
      )}

      {/* Fog: radial blur from edges + white overlay */}
      {fogActive && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 10,
            background: `radial-gradient(ellipse 100% 100% at 50% 50%, transparent 35%, rgba(220,225,230,${fogOpacity.toFixed(3)}) 100%)`,
            WebkitMaskImage: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, black 70%)',
            maskImage: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, black 70%)',
            backdropFilter: `blur(${fogBlur}px)`,
            WebkitBackdropFilter: `blur(${fogBlur}px)`,
            transition: 'backdrop-filter 2s ease-out, background 2s ease-out',
          }}
        />
      )}

      {/* Snow: LOW GRIP warning */}
      {params.isSnow && params.precipitation > 0.3 && (
        <div
          className="absolute pointer-events-none flex items-center justify-center"
          style={{
            zIndex: 12,
            bottom: '12%',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <div
            className="px-4 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-widest"
            style={{
              backgroundColor: 'rgba(255, 180, 0, 0.15)',
              borderColor: 'rgba(255, 180, 0, 0.4)',
              color: 'rgba(255, 200, 50, 0.9)',
              animation: 'weather-fx-grip-pulse 2s ease-in-out infinite',
            }}
          >
            LOW GRIP
          </div>
        </div>
      )}

      {/* CSS keyframes for flash and grip pulse */}
      <style>{`
        @keyframes weather-fx-flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes weather-fx-grip-pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

// -----------------------------------------------------------------------
// Particle helpers
// -----------------------------------------------------------------------

function createRainDrop(w: number, h: number, wind: number, randomY: boolean): RainDrop {
  return {
    x: Math.random() * w * 1.2 - w * 0.1,
    y: randomY ? Math.random() * h : -10,
    speed: 600 + Math.random() * 400, // px/s (fast rain)
    length: 2 + Math.random() * 2, // 2-4 px
    opacity: 0.3 + Math.random() * 0.4,
    drift: (wind * 0.5 + Math.random() * 0.3) * 100, // px/s lateral drift
  };
}

function createSnowFlake(w: number, h: number, randomY: boolean): SnowFlake {
  return {
    x: Math.random() * w,
    y: randomY ? Math.random() * h : -10,
    speed: 30 + Math.random() * 40, // px/s (slow fall)
    radius: 1 + Math.random() * 2.5, // 2-6px diameter
    opacity: 0.4 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
    freq: 0.5 + Math.random() * 1.0,
  };
}

function drawRain(
  ctx: CanvasRenderingContext2D,
  drops: RainDrop[],
  w: number,
  h: number,
  dt: number,
  params: WeatherParams,
  speedKmh: number,
) {
  const windAngle = 5 + params.windIntensity * 15; // degrees from vertical (5-20)
  const speedAngle = Math.min(15, speedKmh / 10); // extra angle from car speed
  const totalAngle = windAngle + speedAngle;
  const rad = (totalAngle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad);

  ctx.lineCap = 'round';

  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];

    // Update position
    d.x += (d.drift + dx * d.speed) * dt;
    d.y += dy * d.speed * dt;

    // Reset if off-screen
    if (d.y > h + 20 || d.x > w + 50 || d.x < -50) {
      drops[i] = createRainDrop(w, h, params.windIntensity, false);
      continue;
    }

    // Draw the rain streak
    const endX = d.x - dx * d.length;
    const endY = d.y - dy * d.length;

    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = `rgba(180, 210, 255, ${d.opacity})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawSnow(
  ctx: CanvasRenderingContext2D,
  flakes: SnowFlake[],
  w: number,
  h: number,
  dt: number,
) {
  const time = performance.now() / 1000;

  for (let i = 0; i < flakes.length; i++) {
    const f = flakes[i];

    // Update position: gentle fall + sinusoidal horizontal drift
    f.y += f.speed * dt;
    f.x += Math.sin(time * f.freq + f.phase) * 20 * dt;

    // Reset if off-screen
    if (f.y > h + 10 || f.x > w + 20 || f.x < -20) {
      flakes[i] = createSnowFlake(w, h, false);
      continue;
    }

    // Draw snowflake as a white circle
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(240, 245, 255, ${f.opacity})`;
    ctx.fill();
  }
}
