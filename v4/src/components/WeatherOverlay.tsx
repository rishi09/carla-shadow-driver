import { useRef, useEffect, useState, useMemo } from 'react';

interface WeatherMood {
  mood: 'CALM' | 'BUILDING' | 'TENSE' | 'DRAMATIC' | 'EPIC' | 'FINALE' | 'NIGHT_TENSE';
  intensity: number;
  precipitation: number;
  fog_density: number;
  wind_intensity: number;
  cloudiness: number;
  wetness?: number;
}

interface WeatherOverlayProps {
  weatherMood?: WeatherMood | null;
  speedKmh: number;
}

/**
 * Visual weather overlay that reacts to the server-driven weather mood.
 *
 * Effects:
 *   - Rain streaks: CSS-animated divs that fall diagonally, angled by car speed.
 *   - Fog overlay: semi-transparent gradient at screen edges, scales with fog_density.
 *   - Lightning flash: brief white flash during EPIC mood at random intervals.
 *   - Wind particles: small dots drifting across screen indicating wind direction.
 *
 * All animations are CSS-based (no canvas) so they layer cleanly over the video
 * without interfering with the existing particle/speed effects.
 */
export function WeatherOverlay({ weatherMood, speedKmh }: WeatherOverlayProps) {
  // --- Lightning state ---
  const [lightningFlash, setLightningFlash] = useState(false);
  const lightningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMoodRef = useRef<string | null>(null);

  // Schedule lightning flashes during EPIC or DRAMATIC mood
  useEffect(() => {
    const mood = weatherMood?.mood ?? 'CALM';

    if (mood === 'EPIC' || mood === 'DRAMATIC') {
      // EPIC: more frequent lightning (15-30s), DRAMATIC: less frequent (25-45s)
      const minDelay = mood === 'EPIC' ? 15000 : 25000;
      const maxExtra = mood === 'EPIC' ? 15000 : 20000;

      const scheduleFlash = () => {
        const delay = minDelay + Math.random() * maxExtra;
        lightningTimerRef.current = setTimeout(() => {
          setLightningFlash(true);
          // Flash lasts 100ms
          setTimeout(() => setLightningFlash(false), 100);
          // Schedule next flash
          scheduleFlash();
        }, delay);
      };

      // Start the cycle (first flash after a shorter initial delay)
      if (prevMoodRef.current !== mood) {
        const initialDelay = 5000 + Math.random() * 10000;
        lightningTimerRef.current = setTimeout(() => {
          setLightningFlash(true);
          setTimeout(() => setLightningFlash(false), 100);
          scheduleFlash();
        }, initialDelay);
      }
    } else {
      // Not EPIC or DRAMATIC: cancel any pending flash
      if (lightningTimerRef.current) {
        clearTimeout(lightningTimerRef.current);
        lightningTimerRef.current = null;
      }
      setLightningFlash(false);
    }

    prevMoodRef.current = mood;

    return () => {
      if (lightningTimerRef.current) {
        clearTimeout(lightningTimerRef.current);
        lightningTimerRef.current = null;
      }
    };
  }, [weatherMood?.mood]);

  // --- Rain drops (CSS animated divs) ---
  const rainDrops = useMemo(() => {
    const precipitation = weatherMood?.precipitation ?? 0;
    if (precipitation < 20) return null;

    // Number of rain streaks scales with precipitation: 10 at 20, 30 at 60+
    const dropCount = Math.min(30, Math.floor(10 + (precipitation - 20) * 0.5));
    const opacity = Math.min(0.7, (precipitation - 20) / 80 + 0.15);

    // Rain angle: at rest falls ~75deg from vertical,
    // at high speed it's more horizontal (angled backward)
    const speedFactor = Math.min(1, speedKmh / 150);
    const angleDeg = 75 + speedFactor * 15; // 75-90 degrees from vertical

    const drops: Array<{
      id: number;
      left: string;
      delay: string;
      duration: string;
      opacity: number;
      height: string;
    }> = [];

    for (let i = 0; i < dropCount; i++) {
      drops.push({
        id: i,
        left: `${Math.random() * 120 - 10}%`,
        delay: `${Math.random() * 1.5}s`,
        duration: `${0.4 + Math.random() * 0.4}s`,
        opacity: opacity * (0.4 + Math.random() * 0.6),
        height: `${15 + Math.random() * 25}px`,
      });
    }

    return { drops, angleDeg };
  }, [weatherMood?.precipitation, speedKmh]);

  // --- Fog overlay ---
  const fogStyle = useMemo(() => {
    const fogDensity = weatherMood?.fog_density ?? 0;
    if (fogDensity < 5) return null;

    const opacity = Math.min(0.5, fogDensity / 50);
    return {
      background: `
        radial-gradient(ellipse 120% 100% at 50% 50%, transparent 40%, rgba(200,210,220,${(opacity * 0.3).toFixed(3)}) 70%, rgba(180,190,200,${opacity.toFixed(3)}) 100%)
      `,
    };
  }, [weatherMood?.fog_density]);

  // --- Wind indicator particles ---
  const windParticles = useMemo(() => {
    const windIntensity = weatherMood?.wind_intensity ?? 0;
    if (windIntensity < 15) return null;

    const count = Math.min(15, Math.floor(5 + windIntensity / 10));
    const particles: Array<{
      id: number;
      top: string;
      delay: string;
      duration: string;
      opacity: number;
      size: number;
    }> = [];

    for (let i = 0; i < count; i++) {
      particles.push({
        id: i,
        top: `${10 + Math.random() * 80}%`,
        delay: `${Math.random() * 4}s`,
        duration: `${2 + Math.random() * 3}s`,
        opacity: 0.15 + Math.random() * 0.25,
        size: 1 + Math.random() * 2,
      });
    }

    return particles;
  }, [weatherMood?.wind_intensity]);

  // Don't render anything if there's no weather mood or all effects are off
  if (!weatherMood) return null;

  const mood = weatherMood.mood;
  const isFinale = mood === 'FINALE';
  const isNightTense = mood === 'NIGHT_TENSE';
  const isTense = mood === 'TENSE' || mood === 'DRAMATIC' || mood === 'EPIC';
  const hasAnyEffect = rainDrops || fogStyle || lightningFlash || windParticles || isFinale || isNightTense || isTense;
  if (!hasAnyEffect) return null;

  return (
    <>
      {/* Rain CSS keyframes */}
      <style>{`
        @keyframes weather-rain-fall {
          0% { transform: translateY(-20px) translateX(0px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(110vh) translateX(-40px); opacity: 0; }
        }
        @keyframes weather-wind-drift {
          0% { transform: translateX(-20px); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateX(110vw); opacity: 0; }
        }
        @keyframes weather-lightning {
          0% { opacity: 0.9; }
          50% { opacity: 0.4; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Fog overlay */}
      {fogStyle && (
        <div
          className="absolute inset-0 pointer-events-none z-[8]"
          style={{
            ...fogStyle,
            transition: 'background 2s ease-out',
          }}
        />
      )}

      {/* Rain streaks */}
      {rainDrops && (
        <div className="absolute inset-0 pointer-events-none z-[9] overflow-hidden">
          {rainDrops.drops.map((drop) => (
            <div
              key={drop.id}
              style={{
                position: 'absolute',
                left: drop.left,
                top: '-30px',
                width: '1.5px',
                height: drop.height,
                background: `linear-gradient(to bottom, transparent, rgba(180,200,230,${drop.opacity.toFixed(2)}))`,
                transform: `rotate(${rainDrops.angleDeg}deg)`,
                animation: `weather-rain-fall ${drop.duration} ${drop.delay} linear infinite`,
                willChange: 'transform, opacity',
              }}
            />
          ))}
        </div>
      )}

      {/* Wind particles */}
      {windParticles && (
        <div className="absolute inset-0 pointer-events-none z-[8] overflow-hidden">
          {windParticles.map((particle) => (
            <div
              key={particle.id}
              style={{
                position: 'absolute',
                left: '-10px',
                top: particle.top,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                borderRadius: '50%',
                backgroundColor: `rgba(200,210,220,${particle.opacity.toFixed(2)})`,
                animation: `weather-wind-drift ${particle.duration} ${particle.delay} linear infinite`,
                willChange: 'transform, opacity',
              }}
            />
          ))}
        </div>
      )}

      {/* FINALE: golden hour warm tint overlay */}
      {isFinale && (
        <div
          className="absolute inset-0 pointer-events-none z-[7]"
          style={{
            background: 'radial-gradient(ellipse 130% 100% at 50% 60%, transparent 30%, rgba(255,180,50,0.08) 60%, rgba(255,140,20,0.15) 100%)',
            transition: 'opacity 3s ease-out',
          }}
        />
      )}

      {/* NIGHT_TENSE: dark blue vignette for night tension */}
      {isNightTense && (
        <div
          className="absolute inset-0 pointer-events-none z-[7]"
          style={{
            background: 'radial-gradient(ellipse 110% 100% at 50% 50%, transparent 35%, rgba(20,30,60,0.12) 65%, rgba(10,15,40,0.25) 100%)',
            transition: 'opacity 3s ease-out',
          }}
        />
      )}

      {/* TENSE / DRAMATIC / EPIC: blue-tinted vignette for rain mood */}
      {isTense && (
        <div
          className="absolute inset-0 pointer-events-none z-[7]"
          style={{
            background: `radial-gradient(ellipse 120% 100% at 50% 50%, transparent 40%, rgba(40,60,100,${(weatherMood.intensity * 0.08).toFixed(3)}) 70%, rgba(20,30,60,${(weatherMood.intensity * 0.15).toFixed(3)}) 100%)`,
            transition: 'opacity 2s ease-out',
          }}
        />
      )}

      {/* Lightning flash */}
      {lightningFlash && (
        <div
          className="absolute inset-0 pointer-events-none z-[20]"
          style={{
            backgroundColor: 'rgba(255,255,255,0.85)',
            animation: 'weather-lightning 100ms ease-out forwards',
          }}
        />
      )}
    </>
  );
}
