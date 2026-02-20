import { useEffect, useMemo, useRef, useState } from 'react';

// --- Particle / star-field canvas background ---
function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let width = 0;
    let height = 0;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      opacity: number;
      color: string;
    }

    const PARTICLE_COUNT = 60;
    const particles: Particle[] = [];
    const colors = ['#22C55E', '#00D2FF', '#3B82F6', '#ffffff'];

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width;
      canvas!.height = height;
    }

    function initParticles() {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.6 + 0.1,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }

    // Perspective grid lines (road-like vanishing point)
    function drawGrid() {
      const vanishX = width * 0.5;
      const vanishY = height * 0.38;

      ctx!.strokeStyle = 'rgba(34, 197, 94, 0.04)';
      ctx!.lineWidth = 1;

      // Radial lines from vanishing point
      const lineCount = 12;
      for (let i = 0; i < lineCount; i++) {
        const angle = (i / lineCount) * Math.PI + Math.PI;
        const endX = vanishX + Math.cos(angle) * width * 1.5;
        const endY = vanishY + Math.sin(angle) * height * 1.5;
        ctx!.beginPath();
        ctx!.moveTo(vanishX, vanishY);
        ctx!.lineTo(endX, endY);
        ctx!.stroke();
      }

      // Horizontal perspective lines (increasing spacing)
      ctx!.strokeStyle = 'rgba(0, 210, 255, 0.03)';
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const y = vanishY + t * t * (height - vanishY);
        const spread = t * width * 0.6;
        ctx!.beginPath();
        ctx!.moveTo(vanishX - spread, y);
        ctx!.lineTo(vanishX + spread, y);
        ctx!.stroke();
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);

      drawGrid();

      // Update and draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = p.opacity;
        ctx!.fill();
      }

      // Draw faint connection lines between nearby particles
      ctx!.globalAlpha = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(0, 210, 255, ${0.06 * (1 - dist / 120)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    initParticles();
    draw();

    window.addEventListener('resize', () => {
      resize();
      initParticles();
    });

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

// --- Speed streak text effect (SVG-based glow lines behind title) ---
function SpeedStreaks() {
  // Pre-compute random values to avoid flickering on re-render
  const streaks = useMemo(() => {
    const left = Array.from({ length: 6 }, (_, i) => ({
      top: 42 + (i - 2.5) * 4,
      opacity: 0.08 + Math.random() * 0.06,
      width: 30 + Math.random() * 40,
      offset: 5 + Math.random() * 15,
      duration: 2 + i * 0.3,
    }));
    const right = Array.from({ length: 6 }, (_, i) => ({
      top: 42 + (i - 2.5) * 4,
      opacity: 0.08 + Math.random() * 0.06,
      width: 30 + Math.random() * 40,
      offset: 5 + Math.random() * 15,
      duration: 2 + i * 0.3,
    }));
    return { left, right };
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" aria-hidden="true">
      {/* Horizontal speed lines */}
      {streaks.left.map((s, i) => (
        <div
          key={`left-${i}`}
          className="absolute h-px"
          style={{
            top: `${s.top}%`,
            left: `${s.offset}%`,
            width: `${s.width}%`,
            background: `linear-gradient(90deg, transparent, rgba(0, 210, 255, ${s.opacity}), transparent)`,
            animation: `streak-left ${s.duration}s ease-in-out infinite alternate`,
          }}
        />
      ))}
      {streaks.right.map((s, i) => (
        <div
          key={`right-${i}`}
          className="absolute h-px"
          style={{
            top: `${s.top}%`,
            right: `${s.offset}%`,
            width: `${s.width}%`,
            background: `linear-gradient(270deg, transparent, rgba(34, 197, 94, ${s.opacity}), transparent)`,
            animation: `streak-right ${s.duration}s ease-in-out infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

// --- Feature card ---
function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="group relative bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-6 sm:p-8 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-300">
      {/* Glow on hover */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ boxShadow: 'inset 0 0 40px rgba(0, 210, 255, 0.03)' }}
      />
      <div className="text-3xl sm:text-4xl mb-4">{icon}</div>
      <h3 className="text-white font-bold text-lg sm:text-xl mb-2">{title}</h3>
      <p className="text-white/50 text-sm sm:text-base leading-relaxed">{description}</p>
    </div>
  );
}

// --- Main Landing Page ---
export function Landing() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger entrance animations after mount
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#050510] text-white overflow-x-hidden">
      {/* Inline keyframes for speed streaks and CTA pulse */}
      <style>{`
        @keyframes streak-left {
          0% { transform: translateX(-10px); opacity: 0.5; }
          100% { transform: translateX(10px); opacity: 1; }
        }
        @keyframes streak-right {
          0% { transform: translateX(10px); opacity: 0.5; }
          100% { transform: translateX(-10px); opacity: 1; }
        }
        @keyframes cta-glow {
          0% { box-shadow: 0 0 20px rgba(34, 197, 94, 0.3), 0 0 60px rgba(34, 197, 94, 0.1); }
          50% { box-shadow: 0 0 30px rgba(34, 197, 94, 0.5), 0 0 80px rgba(34, 197, 94, 0.2); }
          100% { box-shadow: 0 0 20px rgba(34, 197, 94, 0.3), 0 0 60px rgba(34, 197, 94, 0.1); }
        }
        @keyframes title-glow {
          0% { text-shadow: 0 0 20px rgba(0, 210, 255, 0.3), 0 0 40px rgba(0, 210, 255, 0.1); }
          50% { text-shadow: 0 0 30px rgba(0, 210, 255, 0.5), 0 0 60px rgba(0, 210, 255, 0.15); }
          100% { text-shadow: 0 0 20px rgba(0, 210, 255, 0.3), 0 0 40px rgba(0, 210, 255, 0.1); }
        }
        @keyframes float-in-up {
          0% { opacity: 0; transform: translateY(30px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes scroll-hint {
          0%, 100% { opacity: 0.3; transform: translateY(0); }
          50% { opacity: 0.7; transform: translateY(8px); }
        }
      `}</style>

      {/* Background gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(0, 210, 255, 0.04) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 30% 70%, rgba(34, 197, 94, 0.03) 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 70% 30%, rgba(59, 130, 246, 0.03) 0%, transparent 50%), linear-gradient(180deg, #050510 0%, #080820 40%, #0a0a28 70%, #050510 100%)',
          zIndex: 0,
        }}
      />

      {/* Particle canvas */}
      <ParticleBackground />

      {/* Speed streaks behind title */}
      <SpeedStreaks />

      {/* ===== HERO SECTION ===== */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 sm:px-6">
        <div className="text-center max-w-4xl mx-auto">
          {/* Title */}
          <h1
            className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-black tracking-tighter mb-4 sm:mb-6 select-none"
            style={{
              animation: mounted ? 'float-in-up 0.8s ease-out forwards, title-glow 4s ease-in-out infinite' : 'none',
              opacity: mounted ? 1 : 0,
              color: '#ffffff',
              letterSpacing: '-0.04em',
            }}
          >
            SHADOW
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #22C55E, #00D2FF, #3B82F6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              DRIVER
            </span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base sm:text-lg md:text-xl text-white/60 mb-8 sm:mb-10 font-light max-w-xl mx-auto"
            style={{
              animation: mounted ? 'float-in-up 0.8s ease-out 0.2s forwards' : 'none',
              opacity: 0,
            }}
          >
            Race an AI that learned to drive. In your browser.
          </p>

          {/* CTA Button */}
          <div
            style={{
              animation: mounted ? 'float-in-up 0.8s ease-out 0.4s forwards' : 'none',
              opacity: 0,
            }}
          >
            <a
              href="/race"
              className="inline-block relative group"
            >
              <span
                className="relative z-10 inline-block py-4 px-14 sm:py-5 sm:px-20 rounded-2xl text-white font-black text-xl sm:text-2xl md:text-3xl tracking-wide transition-all duration-300 group-hover:scale-105 group-hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                  animation: 'cta-glow 2.5s ease-in-out infinite',
                }}
              >
                RACE NOW
              </span>
              {/* Hover bloom effect */}
              <span
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl"
                style={{ background: 'linear-gradient(135deg, #22C55E, #00D2FF)', zIndex: 0 }}
              />
            </a>
          </div>

          {/* Sub-CTA text */}
          <p
            className="mt-5 sm:mt-6 text-xs sm:text-sm text-white/30 font-mono tracking-wider"
            style={{
              animation: mounted ? 'float-in-up 0.8s ease-out 0.6s forwards' : 'none',
              opacity: 0,
            }}
          >
            No download. No signup. Just race.
          </p>
        </div>

        {/* Scroll hint arrow */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          style={{ animation: 'scroll-hint 2s ease-in-out infinite' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      {/* ===== FEATURES SECTION ===== */}
      <section className="relative z-10 py-20 sm:py-32 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          {/* Section heading */}
          <div className="text-center mb-12 sm:mb-16">
            <p className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-white/30 mb-3">Why it hits different</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
              A real simulator.{' '}
              <span className="text-white/40">In a browser tab.</span>
            </h2>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <FeatureCard
              icon="&#9889;"
              title="Cloud GPU Power"
              description="CARLA simulator running on RTX GPUs, streamed to your browser in real time."
            />
            <FeatureCard
              icon="&#129302;"
              title="Race Against AI"
              description="Challenge an AI opponent with adjustable difficulty. No scripted behavior."
            />
            <FeatureCard
              icon="&#127950;"
              title="Pick Your Ride"
              description="Choose from 6 iconic vehicles -- Tesla, Mustang, and more."
            />
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="relative z-10 py-16 sm:py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-14">
            <p className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-white/30 mb-3">How it works</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              Three clicks to racing
            </h2>
          </div>

          <div className="space-y-6 sm:space-y-8">
            <StepRow number={1} title="Hit Race Now" description="We spin up a GPU with CARLA simulator in the cloud." />
            <StepRow number={2} title="Configure your race" description="Pick your track, weather, car, and number of laps." />
            <StepRow number={3} title="Drive" description="WASD controls. Video streams live. Beat the AI in 3 laps to win." />
          </div>
        </div>
      </section>

      {/* ===== SECOND CTA ===== */}
      <section className="relative z-10 py-20 sm:py-32 px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-2xl sm:text-4xl md:text-5xl font-bold mb-4 sm:mb-6 text-white">
            Ready to race?
          </h2>
          <p className="text-white/40 text-sm sm:text-base mb-8 max-w-md mx-auto">
            Your browser is the only hardware you need.
          </p>
          <a
            href="/race"
            className="inline-block py-3 px-10 sm:py-4 sm:px-14 rounded-2xl text-white font-bold text-lg sm:text-xl transition-all duration-300 hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
              boxShadow: '0 0 20px rgba(34, 197, 94, 0.3)',
            }}
          >
            RACE NOW
          </a>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="relative z-10 border-t border-white/[0.05] py-8 sm:py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/20 text-xs sm:text-sm font-mono">
            Built with CARLA Simulator + cloud GPUs
          </p>
          <a
            href="https://github.com/rishi09/carla-shadow-driver"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/20 hover:text-white/50 transition-colors"
            aria-label="GitHub repository"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </footer>
    </div>
  );
}

// --- Step row component ---
function StepRow({ number, title, description }: { number: number; title: string; description: string }) {
  const colors = ['#22C55E', '#00D2FF', '#3B82F6'];
  const color = colors[(number - 1) % colors.length];

  return (
    <div className="flex items-start gap-4 sm:gap-6">
      <div
        className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-lg sm:text-xl font-black"
        style={{
          background: `${color}15`,
          color: color,
          border: `1px solid ${color}30`,
        }}
      >
        {number}
      </div>
      <div className="pt-1 sm:pt-2">
        <h3 className="text-white font-bold text-base sm:text-lg">{title}</h3>
        <p className="text-white/40 text-sm sm:text-base mt-1">{description}</p>
      </div>
    </div>
  );
}
