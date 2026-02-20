import { useRef, useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;       // 0..1 (1 = just born, 0 = dead)
  maxLife: number;     // total life in seconds
  size: number;
  r: number;
  g: number;
  b: number;
  type: 'spark' | 'smoke' | 'rain';
}

interface ParticleOverlayProps {
  /** Current collision array from raceState */
  collisions?: Array<{ intensity: number }>;
  /** Whether handbrake is engaged */
  handbrake: boolean;
  /** Current speed in km/h */
  speedKmh: number;
  /** Current weather setting */
  weather: string;
  className?: string;
}

const MAX_PARTICLES = 200;

/**
 * Canvas-based particle overlay for visual effects:
 * - Collision sparks: orange/yellow bursts scattering outward
 * - Tire smoke: white puffs rising from bottom on handbrake
 * - Rain streaks: diagonal lines when weather is rain/storm
 *
 * Uses a single canvas + requestAnimationFrame for performance.
 * All reads from props are via refs to avoid effect teardown (LEARNINGS.md pattern).
 */
export function ParticleOverlay({
  collisions,
  handbrake,
  speedKmh,
  weather,
  className = '',
}: ParticleOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const lastTimeRef = useRef(0);

  // Prop refs (avoid effect teardown)
  const collisionsRef = useRef(collisions);
  const handbrakeRef = useRef(handbrake);
  const speedRef = useRef(speedKmh);
  const weatherRef = useRef(weather);

  collisionsRef.current = collisions;
  handbrakeRef.current = handbrake;
  speedRef.current = speedKmh;
  weatherRef.current = weather;

  // Track previous collision count to detect new collisions
  const prevCollisionCountRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function spawnCollisionSparks(w: number, h: number, intensity: number) {
      const particles = particlesRef.current;
      // Spawn 15-40 sparks based on intensity
      const count = Math.min(40, Math.floor(15 + (intensity / 500) * 25));
      // Sparks originate from a random point in the lower-center area (where car is)
      const originX = w * (0.35 + Math.random() * 0.3);
      const originY = h * (0.5 + Math.random() * 0.3);

      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 150 + Math.random() * 350;
        // Orange-yellow color palette
        const r = 255;
        const g = Math.floor(120 + Math.random() * 135); // 120-255 (orange to yellow)
        const b = Math.floor(Math.random() * 50); // 0-50 (warm)
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 100, // bias upward
          life: 1,
          maxLife: 0.3 + Math.random() * 0.4,
          size: 1.5 + Math.random() * 2.5,
          r, g, b,
          type: 'spark',
        });
      }
    }

    function spawnTireSmoke(w: number, h: number) {
      const particles = particlesRef.current;
      // Spawn 2-3 smoke puffs per frame near bottom
      for (let i = 0; i < 3 && particles.length < MAX_PARTICLES; i++) {
        particles.push({
          x: w * (0.3 + Math.random() * 0.4),
          y: h * (0.88 + Math.random() * 0.1),
          vx: (Math.random() - 0.5) * 60,
          vy: -40 - Math.random() * 80,
          life: 1,
          maxLife: 0.6 + Math.random() * 0.5,
          size: 8 + Math.random() * 12,
          r: 200, g: 200, b: 210,
          type: 'smoke',
        });
      }
    }

    function spawnRainDrops(w: number, h: number, isStorm: boolean) {
      const particles = particlesRef.current;
      const count = isStorm ? 6 : 3;
      for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
        particles.push({
          x: Math.random() * w * 1.3 - w * 0.15,
          y: -10 - Math.random() * 50,
          vx: isStorm ? 200 + Math.random() * 150 : 80 + Math.random() * 60,
          vy: 600 + Math.random() * 400,
          life: 1,
          maxLife: 0.5 + Math.random() * 0.4,
          size: isStorm ? 2.5 : 1.5,
          r: 180, g: 200, b: 230,
          type: 'rain',
        });
      }
    }

    function draw(now: number) {
      if (!running) return;

      const dt = lastTimeRef.current ? Math.min((now - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = now;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      const collisions = collisionsRef.current;
      const speed = speedRef.current;
      const weather = weatherRef.current;

      // Detect new collisions
      const currentCollisionCount = collisions?.length ?? 0;
      if (currentCollisionCount > 0 && currentCollisionCount !== prevCollisionCountRef.current) {
        const maxIntensity = Math.max(...(collisions ?? []).map(c => c.intensity));
        spawnCollisionSparks(w, h, maxIntensity);
      }
      prevCollisionCountRef.current = currentCollisionCount;

      // Tire smoke on handbrake at speed
      if (handbrakeRef.current && speed > 20) {
        spawnTireSmoke(w, h);
      }

      // Rain particles
      if (weather === 'rain' || weather === 'storm') {
        spawnRainDrops(w, h, weather === 'storm');
      }

      // Update and draw particles
      ctx.save();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Decrease life
        p.life -= dt / p.maxLife;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        // Physics update
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.type === 'spark') {
          // Gravity pulls sparks down
          p.vy += 800 * dt;
          // Sparks slow down due to air resistance
          p.vx *= 1 - 3 * dt;
          // Sparks shrink as they die
          const alpha = p.life * 0.9;
          const currentSize = p.size * (0.3 + p.life * 0.7);

          ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
          ctx.shadowColor = `rgba(${p.r},${p.g},${Math.min(255, p.b + 100)},${(alpha * 0.6).toFixed(3)})`;
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (p.type === 'smoke') {
          // Smoke rises and expands
          p.vx *= 1 - 2 * dt;
          const alpha = p.life * 0.25;
          const currentSize = p.size * (1 + (1 - p.life) * 2);

          ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'rain') {
          // Rain: draw as a short diagonal line
          const alpha = p.life * 0.4;
          const len = 10 + p.size * 5;
          const angle = Math.atan2(p.vy, p.vx);

          ctx.strokeStyle = `rgba(${p.r},${p.g},${p.b},${alpha.toFixed(3)})`;
          ctx.lineWidth = p.size * 0.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len);
          ctx.stroke();
        }
      }
      ctx.restore();

      animRef.current = requestAnimationFrame(draw);
    }

    // Resize canvas to match container
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const dpr = window.devicePixelRatio || 1;
        const rect = entry.contentRect;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    resizeObserver.observe(canvas.parentElement || canvas);

    animRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none z-[6] ${className}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
