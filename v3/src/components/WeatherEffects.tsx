/**
 * WeatherEffects.tsx - Client-side weather visual effects rendered over the
 * video feed. Uses a canvas for particle systems (rain, snow) and CSS overlays
 * for fog, lightning, and screen tints.
 *
 * Effects:
 *   Rain   - Falling thin white/blue streaks (200-400 particles, 2-4px long),
 *            wind-affected angle. Splash circles expand at the bottom.
 *            Longer "windshield wipe" streaks sweep across the screen.
 *            Subtle blue tint at screen edges (5% opacity gradient).
 *   Thunder- Random screen-wide white flash (50ms, 10-30% opacity),
 *            followed by a bass rumble via parent callback to
 *            useWeatherEffects.playThunder(). Interval: 8-20 seconds.
 *   Fog    - Radial CSS blur from edges inward (center clear, edges 3-5px blur).
 *            White/gray overlay at 10-15% opacity.
 *            Animated wisps: slowly drifting semi-transparent CSS shapes.
 *   Snow   - Falling white circles (2-6px diameter, 100-200 particles),
 *            slow fall with sinusoidal horizontal drift. Gradual white
 *            accumulation at screen bottom. "LOW GRIP" warning text.
 *
 * All layers use pointer-events: none to avoid blocking interaction.
 * Canvas uses requestAnimationFrame with delta-time for consistent speed.
 */

import { useRef, useEffect, useState, useMemo } from 'react';
import type { WeatherEffectState } from '../hooks/useWeatherEffects.ts';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WeatherEffectsProps {
  /** Normalized weather effect state from useWeatherEffects hook */
  effects: WeatherEffectState;
  /** Called when a lightning flash fires so the parent can trigger audio */
  onLightningFlash?: () => void;
  /** Current player speed in km/h (affects rain angle) */
  speedKmh?: number;
}

// ---------------------------------------------------------------------------
// Particle interfaces
// ---------------------------------------------------------------------------

interface RainDrop {
  x: number;
  y: number;
  speed: number;  // px/s vertical
  length: number; // streak length multiplier (2-4)
  opacity: number;
  drift: number;  // px/s horizontal wind drift
}

interface RainSplash {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number; // 1 = just born, 0 = dead
}

interface WindshieldStreak {
  x: number;     // px
  y: number;     // px
  length: number; // px
  angle: number;  // radians
  opacity: number;
  speed: number;  // px/s wipe speed downward
  life: number;   // 1 -> 0
}

interface SnowFlake {
  x: number;
  y: number;
  speed: number;  // px/s fall speed
  radius: number; // 1-3 px (renders as 2-6px diameter)
  opacity: number;
  phase: number;  // sinusoidal drift phase
  freq: number;   // drift frequency multiplier
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIGHTNING_MIN_INTERVAL = 8000;
const LIGHTNING_MAX_INTERVAL = 20000;
const LIGHTNING_FLASH_DURATION = 50;
const SPLASH_LIFETIME = 0.3;
const WISP_COUNT = 5;

// ---------------------------------------------------------------------------
// Particle factory helpers
// ---------------------------------------------------------------------------

function createRainDrop(w: number, h: number, wind: number, randomY: boolean): RainDrop {
  return {
    x: Math.random() * w * 1.2 - w * 0.1,
    y: randomY ? Math.random() * h : -(10 + Math.random() * 30),
    speed: 600 + Math.random() * 400,
    length: 2 + Math.random() * 2,
    opacity: 0.3 + Math.random() * 0.4,
    drift: (wind * 0.5 + Math.random() * 0.3) * 100,
  };
}

function createSnowFlake(w: number, h: number, randomY: boolean): SnowFlake {
  return {
    x: Math.random() * w,
    y: randomY ? Math.random() * h : -(5 + Math.random() * 20),
    speed: 30 + Math.random() * 50,
    radius: 1 + Math.random() * 2,
    opacity: 0.4 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
    freq: 0.5 + Math.random() * 1.0,
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing functions
// ---------------------------------------------------------------------------

function drawRainParticles(
  ctx: CanvasRenderingContext2D,
  drops: RainDrop[],
  splashes: RainSplash[],
  streaks: WindshieldStreak[],
  w: number,
  h: number,
  dt: number,
  wind: number,
  rainIntensity: number,
  speedKmh: number,
) {
  // Wind angle: slight angle from vertical, affected by wind + car speed
  const windAngle = 5 + wind * 15;
  const speedAngle = Math.min(15, speedKmh / 10);
  const totalAngleDeg = windAngle + speedAngle;
  const rad = (totalAngleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad);

  // --- Raindrops (thin white/blue lines, 2-4px long) ---
  ctx.lineCap = 'round';
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    d.x += (d.drift + dx * d.speed * 0.3) * dt;
    d.y += dy * d.speed * dt;

    // Off-screen: spawn a splash at bottom before resetting
    if (d.y > h + 20 || d.x > w + 50 || d.x < -50) {
      if (d.y > h - 30 && splashes.length < 60) {
        splashes.push({
          x: Math.min(Math.max(d.x, 0), w),
          y: h - Math.random() * 4,
          radius: 0,
          maxRadius: 2 + Math.random() * 3,
          life: 1,
        });
      }
      drops[i] = createRainDrop(w, h, wind, false);
      continue;
    }

    // Draw raindrop as a short line
    const endX = d.x - dx * d.length * 4;
    const endY = d.y - dy * d.length * 4;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = `rgba(180, 210, 255, ${d.opacity})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // --- Splash circles (small expanding rings at screen bottom) ---
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.life -= dt / SPLASH_LIFETIME;
    s.radius = s.maxRadius * (1 - s.life);

    if (s.life <= 0) {
      splashes.splice(i, 1);
      continue;
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(180, 210, 255, ${(s.life * 0.35 * rainIntensity).toFixed(2)})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // --- Windshield wipe streaks (longer lines that sweep across) ---
  const maxStreaks = Math.round(6 * rainIntensity);
  if (streaks.length < maxStreaks && Math.random() < dt * 2 * rainIntensity) {
    streaks.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.4,
      length: 40 + Math.random() * 80,
      angle: rad * 0.6 + (Math.random() - 0.5) * 0.2,
      opacity: 0.04 + Math.random() * 0.08,
      speed: 200 + Math.random() * 300,
      life: 1,
    });
  }

  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i];
    s.y += s.speed * dt;
    s.life -= dt * 0.5;

    if (s.life <= 0 || s.y > h + 20) {
      streaks.splice(i, 1);
      continue;
    }

    const endX = s.x + Math.sin(s.angle) * s.length;
    const endY = s.y + Math.cos(s.angle) * s.length;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = `rgba(200, 220, 255, ${(s.opacity * s.life).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawSnowParticles(
  ctx: CanvasRenderingContext2D,
  flakes: SnowFlake[],
  w: number,
  h: number,
  dt: number,
  wind: number,
  snowAccum: { value: number },
  snowIntensity: number,
) {
  const time = performance.now() / 1000;

  // Update and draw snowflakes (white circles, 2-6px diameter, gentle drift)
  for (let i = 0; i < flakes.length; i++) {
    const f = flakes[i];
    f.y += f.speed * dt;
    f.x += Math.sin(time * f.freq + f.phase) * 20 * dt; // sinusoidal drift
    f.x += wind * 30 * dt; // wind effect

    if (f.y > h + 10 || f.x > w + 20 || f.x < -20) {
      flakes[i] = createSnowFlake(w, h, false);
      continue;
    }

    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(240, 245, 255, ${f.opacity})`;
    ctx.fill();
  }

  // Snow accumulation: bottom of screen gradually gets white
  snowAccum.value = Math.min(1, snowAccum.value + dt * 0.008 * snowIntensity);
  const accumHeight = snowAccum.value * 12;
  if (accumHeight > 0.5) {
    const gradient = ctx.createLinearGradient(0, h - accumHeight * 3, 0, h);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(1, `rgba(255, 255, 255, ${(0.12 * snowIntensity).toFixed(2)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, h - accumHeight * 3, w, accumHeight * 3);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeatherEffects({ effects, onLightningFlash, speedKmh = 0 }: WeatherEffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef(0);

  // Particle pools (persisted via refs across frames)
  const rainDropsRef = useRef<RainDrop[]>([]);
  const splashesRef = useRef<RainSplash[]>([]);
  const streaksRef = useRef<WindshieldStreak[]>([]);
  const snowFlakesRef = useRef<SnowFlake[]>([]);
  const snowAccumRef = useRef({ value: 0 });

  // Lightning
  const [lightningFlash, setLightningFlash] = useState(false);
  const lightningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lightningOpacityRef = useRef(0);

  // Cache props in refs so the stable animation loop can read them
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;
  const onLightningFlashRef = useRef(onLightningFlash);
  onLightningFlashRef.current = onLightningFlash;

  // Fog wisp data (stable across component lifetime)
  const fogWisps = useMemo(() => {
    return Array.from({ length: WISP_COUNT }, (_, i) => ({
      id: i,
      x: 10 + Math.random() * 80,
      y: 20 + Math.random() * 60,
      width: 150 + Math.random() * 200,
      height: 40 + Math.random() * 60,
      duration: 12 + Math.random() * 13,
      delay: Math.random() * 8,
      opacity: 0.03 + Math.random() * 0.05,
    }));
  }, []);

  // ------------------------------------------------------------------
  // Lightning scheduling: fires on random 8-20 second intervals
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!effects.thunder) {
      if (lightningTimerRef.current) {
        clearTimeout(lightningTimerRef.current);
        lightningTimerRef.current = null;
      }
      setLightningFlash(false);
      return;
    }

    const scheduleFlash = () => {
      const delay = LIGHTNING_MIN_INTERVAL + Math.random() * (LIGHTNING_MAX_INTERVAL - LIGHTNING_MIN_INTERVAL);
      lightningTimerRef.current = setTimeout(() => {
        lightningOpacityRef.current = 0.1 + Math.random() * 0.2;
        setLightningFlash(true);
        onLightningFlashRef.current?.();

        setTimeout(() => {
          setLightningFlash(false);
          lightningOpacityRef.current = 0;
        }, LIGHTNING_FLASH_DURATION);

        scheduleFlash();
      }, delay);
    };

    // First flash after a shorter initial delay
    const initialDelay = 3000 + Math.random() * 5000;
    lightningTimerRef.current = setTimeout(() => {
      lightningOpacityRef.current = 0.1 + Math.random() * 0.2;
      setLightningFlash(true);
      onLightningFlashRef.current?.();
      setTimeout(() => {
        setLightningFlash(false);
        lightningOpacityRef.current = 0;
      }, LIGHTNING_FLASH_DURATION);
      scheduleFlash();
    }, initialDelay);

    return () => {
      if (lightningTimerRef.current) {
        clearTimeout(lightningTimerRef.current);
        lightningTimerRef.current = null;
      }
    };
  }, [effects.thunder]);

  // ------------------------------------------------------------------
  // Canvas animation loop (stable effect, reads from refs)
  // ------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
      lastTime = now;

      const parent = canvas.parentElement;
      if (!parent) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }
      const rect = parent.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const eff = effectsRef.current;
      const spd = speedRef.current;

      ctx.clearRect(0, 0, w, h);

      // --- Sync rain pool size ---
      if (eff.rain >= 0.05) {
        const target = Math.round(200 + eff.rain * 200);
        const pool = rainDropsRef.current;
        while (pool.length < target) {
          pool.push(createRainDrop(w, h, eff.wind, true));
        }
        if (pool.length > target) pool.length = target;
      } else {
        rainDropsRef.current.length = 0;
        splashesRef.current.length = 0;
        streaksRef.current.length = 0;
      }

      // --- Sync snow pool size ---
      if (eff.snow >= 0.05) {
        const target = Math.round(100 + eff.snow * 100);
        const pool = snowFlakesRef.current;
        while (pool.length < target) {
          pool.push(createSnowFlake(w, h, true));
        }
        if (pool.length > target) pool.length = target;
      } else {
        snowFlakesRef.current.length = 0;
        // Slowly reduce accumulation when snow stops
        snowAccumRef.current.value = Math.max(0, snowAccumRef.current.value - dt * 0.02);
      }

      // --- Draw rain ---
      if (rainDropsRef.current.length > 0) {
        drawRainParticles(
          ctx,
          rainDropsRef.current,
          splashesRef.current,
          streaksRef.current,
          w, h, dt,
          eff.wind,
          eff.rain,
          spd,
        );
      }

      // --- Draw snow ---
      if (snowFlakesRef.current.length > 0) {
        drawSnowParticles(
          ctx,
          snowFlakesRef.current,
          w, h, dt,
          eff.wind,
          snowAccumRef.current,
          eff.snow,
        );
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // ------------------------------------------------------------------
  // Early exit: nothing to render
  // ------------------------------------------------------------------
  const hasRain = effects.rain >= 0.05;
  const hasSnow = effects.snow >= 0.05;
  const hasFog = effects.fog >= 0.05;
  const hasAnyEffect = hasRain || hasSnow || hasFog || effects.thunder;

  if (!hasAnyEffect) return null;

  // Fog CSS parameters
  const fogOverlayOpacity = hasFog ? Math.min(0.15, effects.fog * 0.25 + 0.08) : 0;
  const fogBlurPx = hasFog ? Math.min(5, 3 + effects.fog * 4) : 0;

  // Rain blue tint opacity
  const rainTintOpacity = hasRain ? Math.min(0.05, effects.rain * 0.06) : 0;

  return (
    <>
      {/* Canvas for rain/snow particle systems */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 11 }}
      />

      {/* Rain: subtle blue tint at screen edges */}
      {hasRain && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 10,
            background: `radial-gradient(ellipse 110% 100% at 50% 50%, transparent 55%, rgba(60, 100, 180, ${rainTintOpacity.toFixed(3)}) 100%)`,
            transition: 'background 1.5s ease-out',
          }}
        />
      )}

      {/* Fog: white/gray radial overlay at 10-15% opacity */}
      {hasFog && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 10,
            background: `radial-gradient(ellipse 100% 100% at 50% 50%, transparent 35%, rgba(220, 225, 230, ${fogOverlayOpacity.toFixed(3)}) 100%)`,
            transition: 'background 2s ease-out',
          }}
        />
      )}

      {/* Fog: radial blur from edges inward (center clear, edges blurred) */}
      {hasFog && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 10,
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, black 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, black 100%)',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${fogBlurPx.toFixed(1)}px)`,
              WebkitBackdropFilter: `blur(${fogBlurPx.toFixed(1)}px)`,
            }}
          />
        </div>
      )}

      {/* Fog: animated wisps (slowly drifting semi-transparent shapes) */}
      {hasFog && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }}>
          {fogWisps.map((wisp) => (
            <div
              key={wisp.id}
              style={{
                position: 'absolute',
                left: `${wisp.x}%`,
                top: `${wisp.y}%`,
                width: `${wisp.width}px`,
                height: `${wisp.height}px`,
                borderRadius: '50%',
                background: `radial-gradient(ellipse at center, rgba(255,255,255,${(wisp.opacity * effects.fog * 3).toFixed(3)}) 0%, transparent 70%)`,
                animation: `weatherFxWispDrift ${wisp.duration}s ease-in-out ${wisp.delay}s infinite alternate`,
                willChange: 'transform, opacity',
              }}
            />
          ))}
        </div>
      )}

      {/* Lightning: screen-wide white flash (50ms, 10-30% opacity) */}
      {lightningFlash && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 25,
            backgroundColor: `rgba(255, 255, 255, ${lightningOpacityRef.current.toFixed(2)})`,
            animation: `weatherFxLightningFlash ${LIGHTNING_FLASH_DURATION}ms ease-out forwards`,
          }}
        />
      )}

      {/* Snow: LOW GRIP warning */}
      {hasSnow && effects.snow > 0.3 && (
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
              backgroundColor: 'rgba(255, 180, 0, 0.12)',
              borderColor: 'rgba(255, 180, 0, 0.35)',
              color: 'rgba(255, 200, 50, 0.85)',
              animation: 'weatherFxGripPulse 2s ease-in-out infinite',
            }}
          >
            LOW GRIP
          </div>
        </div>
      )}

      {/* CSS keyframes */}
      <style>{`
        @keyframes weatherFxWispDrift {
          0% {
            transform: translateX(-25px) translateY(-8px) scale(1);
            opacity: 0.5;
          }
          50% { opacity: 1; }
          100% {
            transform: translateX(25px) translateY(8px) scale(1.12);
            opacity: 0.5;
          }
        }
        @keyframes weatherFxLightningFlash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes weatherFxGripPulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
