import { useEffect, useRef, useState } from 'react';
import { useSocialPresence } from '../hooks/useSocialPresence.ts';
import { RecentRaces } from '../components/RecentRaces.tsx';

// ============================================================
// SPEED CANVAS — road-like vanishing point with rushing light streaks
// ============================================================
function SpeedCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let w = 0, h = 0;

    interface Streak {
      angle: number;
      speed: number;
      progress: number;
      len: number;
      opacity: number;
      hue: number; // 0 = cyan, 1 = green, 2 = blue
    }

    const STREAK_COUNT = 50;
    const streaks: Streak[] = [];
    const hueColors = [
      [0, 210, 255],   // cyan
      [34, 197, 94],   // green
      [59, 130, 246],  // blue
    ];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(): Streak {
      return {
        angle: Math.random() * Math.PI * 2,
        speed: 0.003 + Math.random() * 0.006,
        progress: Math.random(),
        len: 0.08 + Math.random() * 0.14,
        opacity: 0.15 + Math.random() * 0.45,
        hue: Math.floor(Math.random() * 3),
      };
    }

    for (let i = 0; i < STREAK_COUNT; i++) streaks.push(spawn());

    let lastTime = 0;
    function draw(now: number) {
      const dt = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;
      const dtF = dt / 16.67;

      ctx!.clearRect(0, 0, w, h);

      // Subtle perspective grid
      const cx = w * 0.5, cy = h * 0.42;
      ctx!.strokeStyle = 'rgba(0, 210, 255, 0.025)';
      ctx!.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI + Math.PI;
        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(cx + Math.cos(a) * w * 1.5, cy + Math.sin(a) * h * 1.5);
        ctx!.stroke();
      }
      // Horizon lines
      ctx!.strokeStyle = 'rgba(34, 197, 94, 0.018)';
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const y = cy + t * t * (h - cy);
        const spread = t * w * 0.7;
        ctx!.beginPath();
        ctx!.moveTo(cx - spread, y);
        ctx!.lineTo(cx + spread, y);
        ctx!.stroke();
      }

      // Speed streaks
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const innerR = maxR * 0.08;
      const outerR = maxR * 1.15;

      for (const s of streaks) {
        s.progress += s.speed * dtF;
        if (s.progress > 1) {
          Object.assign(s, spawn());
          s.progress = 0;
          continue;
        }

        const startD = innerR + (outerR - innerR) * s.progress;
        const endD = startD + (outerR - innerR) * s.len;
        const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
        const x1 = cx + cos * startD, y1 = cy + sin * startD;
        const x2 = cx + cos * Math.min(endD, outerR), y2 = cy + sin * Math.min(endD, outerR);

        const fadeIn = Math.min(1, s.progress * 4);
        const fadeOut = Math.max(0, 1 - (s.progress - 0.6) / 0.4);
        const alpha = s.opacity * fadeIn * fadeOut;
        if (alpha < 0.01) continue;

        const [r, g, b] = hueColors[s.hue];
        const grad = ctx!.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},${alpha * 0.2})`);

        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.2;
        ctx!.lineCap = 'round';
        ctx!.beginPath();
        ctx!.moveTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />;
}

// ============================================================
// SCROLL-REVEAL HOOK — IntersectionObserver fade-in
// ============================================================
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

// ============================================================
// FEATURE CARD — glassmorphism with hover glow
// ============================================================
function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className="group relative bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-6 sm:p-8 hover:border-cyan-400/20 hover:bg-white/[0.06] transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(40px)',
        transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s, border-color 0.3s, background-color 0.3s`,
      }}
    >
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ boxShadow: 'inset 0 0 60px rgba(0, 210, 255, 0.04), 0 0 40px rgba(0, 210, 255, 0.02)' }}
      />
      <div className="mb-4 text-cyan-400">{icon}</div>
      <h3 className="text-white font-bold text-lg sm:text-xl mb-2">{title}</h3>
      <p className="text-white/45 text-sm sm:text-base leading-relaxed">{desc}</p>
    </div>
  );
}

// ============================================================
// STEP PILL — numbered step in "How it works"
// ============================================================
function StepPill({ n, title, desc, color, delay }: { n: number; title: string; desc: string; color: string; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className="flex flex-col items-center text-center px-4"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
        transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
      }}
    >
      <div
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black mb-4"
        style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}
      >
        {n}
      </div>
      <h3 className="text-white font-bold text-base sm:text-lg mb-1">{title}</h3>
      <p className="text-white/40 text-sm max-w-[220px]">{desc}</p>
    </div>
  );
}

// ============================================================
// SVG ICONS — inline, no external deps
// ============================================================
const GpuIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" />
    <path d="M7 8h2M7 11h2" /><rect x="11" y="7" width="6" height="5" rx="1" />
  </svg>
);

const AiIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

const PhysicsIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="10" ry="4" /><ellipse cx="12" cy="12" rx="4" ry="10" />
  </svg>
);

const CarIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 17h14M5 17a2 2 0 01-2-2v-2a1 1 0 011-1h1l2-4h10l2 4h1a1 1 0 011 1v2a2 2 0 01-2 2" />
    <circle cx="7.5" cy="17" r="1.5" /><circle cx="16.5" cy="17" r="1.5" />
  </svg>
);

// ============================================================
// TECH BADGE — small branded pill for "Powered by" section
// ============================================================
function TechBadge({ label, delay }: { label: string; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <span
      ref={ref}
      className="inline-block px-4 py-2 rounded-full border border-white/[0.08] bg-white/[0.03] text-white/50 text-xs sm:text-sm font-mono tracking-wide hover:border-cyan-400/20 hover:text-white/70 transition-all duration-300 cursor-default"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(15px)',
        transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s, border-color 0.3s, color 0.3s`,
      }}
    >
      {label}
    </span>
  );
}

// ============================================================
// MAIN LANDING PAGE
// ============================================================
export function Landing() {
  const [mounted, setMounted] = useState(false);
  const social = useSocialPresence();

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#030308] text-white overflow-x-hidden">
      {/* Keyframes */}
      <style>{`
        @keyframes cta-pulse {
          0%,100% { box-shadow: 0 0 20px rgba(34,197,94,0.3), 0 0 60px rgba(34,197,94,0.08); }
          50% { box-shadow: 0 0 35px rgba(34,197,94,0.5), 0 0 90px rgba(34,197,94,0.15); }
        }
        @keyframes title-glow {
          0%,100% { text-shadow: 0 0 30px rgba(0,210,255,0.25), 0 0 60px rgba(0,210,255,0.08); }
          50% { text-shadow: 0 0 40px rgba(0,210,255,0.4), 0 0 80px rgba(0,210,255,0.12); }
        }
        @keyframes float-up {
          from { opacity:0; transform:translateY(35px); }
          to { opacity:1; transform:translateY(0); }
        }
        @keyframes scroll-bob {
          0%,100% { opacity:0.25; transform:translateY(0); }
          50% { opacity:0.6; transform:translateY(10px); }
        }
        @keyframes stat-count {
          from { opacity:0; transform:scale(0.8); }
          to { opacity:1; transform:scale(1); }
        }
        @keyframes live-pulse {
          0%,100% { opacity:1; }
          50% { opacity:0.4; }
        }
      `}</style>

      {/* Radial glow overlays */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% 35%, rgba(0,210,255,0.05) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 25% 75%, rgba(34,197,94,0.03) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 25%, rgba(59,130,246,0.03) 0%, transparent 60%)',
        zIndex: 0,
      }} />

      <SpeedCanvas />

      {/* ===================== HERO ===================== */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 sm:px-6">
        <div className="text-center max-w-5xl mx-auto">
          {/* Title */}
          <h1
            className="text-6xl sm:text-8xl md:text-9xl lg:text-[10rem] font-black tracking-[-0.05em] leading-[0.85] mb-5 sm:mb-7 select-none"
            style={{
              fontFamily: 'Impact, "Arial Narrow", "Helvetica Neue", sans-serif',
              animation: mounted ? 'float-up 0.9s ease-out forwards, title-glow 4s ease-in-out 0.9s infinite' : 'none',
              opacity: mounted ? undefined : 0,
            }}
          >
            <span className="block text-white">SHADOW</span>
            <span className="block" style={{
              background: 'linear-gradient(135deg, #22C55E 0%, #00D2FF 50%, #3B82F6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              DRIVER
            </span>
          </h1>

          {/* Tagline */}
          <p
            className="text-lg sm:text-xl md:text-2xl text-white/55 font-light max-w-lg mx-auto mb-9 sm:mb-11"
            style={{
              animation: mounted ? 'float-up 0.8s ease-out 0.25s forwards' : 'none',
              opacity: 0,
            }}
          >
            Race an AI. In your browser. On a real GPU.
          </p>

          {/* CTA */}
          <div style={{
            animation: mounted ? 'float-up 0.8s ease-out 0.45s forwards' : 'none',
            opacity: 0,
          }}>
            <a href="/race?quickstart=true" className="inline-block relative group">
              <span
                className="relative z-10 inline-block py-4 px-16 sm:py-5 sm:px-22 rounded-2xl text-white font-black text-2xl sm:text-3xl tracking-wide transition-transform duration-300 group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                  animation: 'cta-pulse 2.5s ease-in-out infinite',
                }}
              >
                RACE NOW
              </span>
              <span className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-400 blur-2xl" style={{ background: 'linear-gradient(135deg, #22C55E, #00D2FF)', zIndex: 0 }} />
            </a>
          </div>

          {/* Sub-text */}
          <p
            className="mt-5 sm:mt-7 text-xs sm:text-sm text-white/25 font-mono tracking-[0.15em] uppercase"
            style={{
              animation: mounted ? 'float-up 0.7s ease-out 0.65s forwards' : 'none',
              opacity: 0,
            }}
          >
            No download &middot; No signup &middot; Just drive
          </p>

          {/* Live player count + total races */}
          {!social.loading && (
            <div
              className="mt-5 flex flex-col items-center gap-2"
              style={{
                animation: mounted ? 'float-up 0.7s ease-out 0.85s forwards' : 'none',
                opacity: 0,
              }}
            >
              {social.activePlayers > 0 ? (
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-green-500/20 bg-green-500/[0.06]">
                  <span
                    className="w-2 h-2 rounded-full bg-green-400"
                    style={{ animation: 'live-pulse 2s ease-in-out infinite' }}
                  />
                  <span className="text-green-400/80 text-xs sm:text-sm font-medium">
                    {social.activePlayers} {social.activePlayers === 1 ? 'person' : 'people'} racing right now
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
                  <span className="text-white/30 text-xs sm:text-sm">
                    Be the first to race today!
                  </span>
                </div>
              )}
              {social.totalRaces > 0 && (
                <span className="text-white/15 text-xs font-mono">
                  {social.totalRaces.toLocaleString()} races completed
                </span>
              )}
            </div>
          )}
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2" style={{ animation: 'scroll-bob 2.5s ease-in-out infinite' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-white/25">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      {/* ===================== FEATURES ===================== */}
      <section className="relative z-10 py-24 sm:py-36 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeading tag="What makes it different" title={<>A real driving simulator. <span className="text-white/35">In a browser tab.</span></>} />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 mt-14 sm:mt-18">
            <FeatureCard icon={<GpuIcon />} title="Cloud GPU Power" desc="CARLA simulator running on RTX 3090 GPUs in the cloud, streamed to your browser in real time via WebSocket." delay={0} />
            <FeatureCard icon={<AiIcon />} title="AI Opponent" desc="Race against an AI with three difficulty levels. From cautious Sunday Driver to aggressive Speed Demon." delay={0.1} />
            <FeatureCard icon={<PhysicsIcon />} title="Real Physics" desc="Unreal Engine 4 physics simulation. Real tire grip, weight transfer, and collision dynamics. Not a toy." delay={0.2} />
            <FeatureCard icon={<CarIcon />} title="Choose Your Car" desc="6 vehicles from Tesla Model 3 to Dodge Charger. Each with unique handling characteristics." delay={0.3} />
          </div>
        </div>
      </section>

      {/* ===================== HOW IT WORKS ===================== */}
      <section className="relative z-10 py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <SectionHeading tag="How it works" title="Three clicks to the starting grid" />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8 mt-14 sm:mt-18">
            <StepPill n={1} title="Click Race Now" desc="We spin up an RTX GPU with CARLA simulator in the cloud." color="#22C55E" delay={0} />
            <StepPill n={2} title="Configure" desc="Pick your track, weather, car, and AI difficulty." color="#00D2FF" delay={0.12} />
            <StepPill n={3} title="Drive" desc="WASD to steer. Video streams live. Beat the AI to win." color="#3B82F6" delay={0.24} />
          </div>

          {/* Connection lines between steps (desktop only) */}
          <div className="hidden sm:block relative -mt-[106px] mb-0 pointer-events-none" aria-hidden="true">
            <div className="max-w-4xl mx-auto flex justify-center">
              <div className="w-full max-w-[520px] h-px" style={{ background: 'linear-gradient(90deg, #22C55E30, #00D2FF30, #3B82F630)' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ===================== RECENT RACES TICKER ===================== */}
      {social.recentRaces.length > 0 && (
        <section className="relative z-10 py-8 sm:py-12 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <RecentRaces results={social.recentRaces} />
          </div>
        </section>
      )}

      {/* ===================== TECHNICAL FLEX ===================== */}
      <section className="relative z-10 py-20 sm:py-28 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <SectionHeading tag="Under the hood" title="Built for performance nerds" />

          <div className="mt-14 sm:mt-18 space-y-12">
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
              <StatBlock value="30" unit="FPS" label="Stream rate" delay={0} />
              <StatBlock value="<100" unit="ms" label="Input lag" delay={0.08} />
              <StatBlock value="720p" unit="" label="Live video" delay={0.16} />
              <StatBlock value="24" unit="GB" label="GPU VRAM" delay={0.24} />
            </div>

            {/* Powered by */}
            <div className="text-center">
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-white/25 mb-5">Powered by</p>
              <div className="flex flex-wrap justify-center gap-3">
                <TechBadge label="CARLA 0.9.15" delay={0} />
                <TechBadge label="Unreal Engine 4" delay={0.06} />
                <TechBadge label="WebSocket" delay={0.12} />
                <TechBadge label="React" delay={0.18} />
                <TechBadge label="PyTorch" delay={0.24} />
                <TechBadge label="Vast.ai GPUs" delay={0.30} />
              </div>
            </div>

            {/* Open source badge */}
            <div className="flex justify-center">
              <a
                href="https://github.com/rishi09/carla-shadow-driver"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-3 px-6 py-3 rounded-full border border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05] transition-all duration-300"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white/40 group-hover:text-white/70 transition-colors">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span className="text-white/50 group-hover:text-white/80 text-sm font-medium transition-colors">Open Source on GitHub</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== FINAL CTA ===================== */}
      <section className="relative z-10 py-24 sm:py-36 px-4 sm:px-6">
        <div className="text-center">
          <FinalCTA />
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8 sm:py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/15 text-xs sm:text-sm font-mono">
            Shadow Driver &middot; CARLA Simulator + Cloud GPUs
          </p>
          <div className="flex items-center gap-6">
            <a
              href="/about"
              className="text-white/15 hover:text-white/40 transition-colors text-xs sm:text-sm"
            >
              About
            </a>
            <a
              href="https://github.com/rishi09/carla-shadow-driver"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/15 hover:text-white/40 transition-colors"
              aria-label="GitHub"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function SectionHeading({ tag, title }: { tag: string; title: React.ReactNode }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} className="text-center" style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(20px)',
      transition: 'opacity 0.6s ease, transform 0.6s ease',
    }}>
      <p className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-white/25 mb-3">{tag}</p>
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{title}</h2>
    </div>
  );
}

function StatBlock({ value, unit, label, delay }: { value: string; unit: string; label: string; delay: number }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} className="text-center" style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'scale(1)' : 'scale(0.85)',
      transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
    }}>
      <div className="text-3xl sm:text-4xl font-black text-white mb-1">
        {value}<span className="text-cyan-400 text-lg sm:text-xl font-bold ml-0.5">{unit}</span>
      </div>
      <p className="text-white/30 text-xs sm:text-sm font-mono uppercase tracking-wider">{label}</p>
    </div>
  );
}

function FinalCTA() {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(30px)',
      transition: 'opacity 0.8s ease, transform 0.8s ease',
    }}>
      <h2 className="text-3xl sm:text-5xl md:text-6xl font-black mb-4 sm:mb-6 text-white tracking-tight">
        Ready to race?
      </h2>
      <p className="text-white/35 text-sm sm:text-base mb-10 max-w-md mx-auto">
        Your browser is the only hardware you need.
      </p>
      <a
        href="/race?quickstart=true"
        className="inline-block py-4 px-14 sm:py-5 sm:px-18 rounded-2xl text-white font-black text-xl sm:text-2xl transition-all duration-300 hover:scale-105"
        style={{
          background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
          boxShadow: '0 0 25px rgba(34,197,94,0.3), 0 0 60px rgba(34,197,94,0.08)',
        }}
      >
        RACE NOW
      </a>
    </div>
  );
}
