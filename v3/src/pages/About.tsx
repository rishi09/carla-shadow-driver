import { useEffect, useRef, useState } from 'react';

// ============================================================
// SCROLL-REVEAL HOOK
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
// SECTION COMPONENT — each story section with icon + text
// ============================================================
function StorySection({ icon, title, children, delay }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  delay: number;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className="relative bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-8 sm:p-10 hover:border-cyan-400/15 hover:bg-white/[0.05] transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(40px)',
        transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s, border-color 0.3s, background-color 0.3s`,
      }}
    >
      <div className="flex items-start gap-5">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-cyan-400"
          style={{ background: 'rgba(0, 210, 255, 0.08)', border: '1px solid rgba(0, 210, 255, 0.12)' }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-xl sm:text-2xl mb-3">{title}</h2>
          <div className="text-white/50 text-base sm:text-lg leading-relaxed space-y-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// INLINE SVG ICONS
// ============================================================
const GamepadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="3" />
    <path d="M8 6v12" />
    <path d="M16 6v12" />
    <path d="M6 10h4" />
    <path d="M8 8v4" />
    <circle cx="17" cy="10" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
  </svg>
);

const CloudIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    <path d="M22 10a4.5 4.5 0 0 0-7.29-3.5" />
  </svg>
);

const SparklesIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    <path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z" />
  </svg>
);

const BrainIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a5 5 0 0 1 4.9 4A5 5 0 0 1 21 11a5 5 0 0 1-3 4.6V20a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-4.4A5 5 0 0 1 3 11a5 5 0 0 1 4.1-4.9A5 5 0 0 1 12 2z" />
    <path d="M12 2v20" />
    <path d="M8 8h8" />
    <path d="M9 12h6" />
  </svg>
);

const HeartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

// ============================================================
// ABOUT PAGE
// ============================================================
export function About() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#030308] text-white overflow-x-hidden">
      {/* Keyframes */}
      <style>{`
        @keyframes float-up {
          from { opacity:0; transform:translateY(35px); }
          to { opacity:1; transform:translateY(0); }
        }
        @keyframes title-glow {
          0%,100% { text-shadow: 0 0 30px rgba(0,210,255,0.25), 0 0 60px rgba(0,210,255,0.08); }
          50% { text-shadow: 0 0 40px rgba(0,210,255,0.4), 0 0 80px rgba(0,210,255,0.12); }
        }
      `}</style>

      {/* Radial glow overlays */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% 20%, rgba(0,210,255,0.04) 0%, transparent 70%), radial-gradient(ellipse 50% 40% at 20% 80%, rgba(34,197,94,0.025) 0%, transparent 60%)',
        zIndex: 0,
      }} />

      {/* ===================== NAV BAR ===================== */}
      <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <a
          href="/"
          className="text-white/40 hover:text-white/70 transition-colors text-sm flex items-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to home
        </a>
        <a
          href="/race?quickstart=true"
          className="text-sm font-bold px-5 py-2 rounded-lg transition-all duration-300 hover:scale-105"
          style={{
            background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
            boxShadow: '0 0 15px rgba(34,197,94,0.2)',
          }}
        >
          Race Now
        </a>
      </nav>

      {/* ===================== HERO ===================== */}
      <section className="relative z-10 pt-16 sm:pt-24 pb-20 sm:pb-28 px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto">
          <p
            className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-white/25 mb-4"
            style={{
              animation: mounted ? 'float-up 0.7s ease-out forwards' : 'none',
              opacity: 0,
            }}
          >
            About the project
          </p>
          <h1
            className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight leading-tight mb-6"
            style={{
              animation: mounted ? 'float-up 0.8s ease-out 0.1s forwards, title-glow 4s ease-in-out 0.9s infinite' : 'none',
              opacity: 0,
            }}
          >
            The story behind{' '}
            <span style={{
              background: 'linear-gradient(135deg, #22C55E 0%, #00D2FF 50%, #3B82F6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Shadow Driver
            </span>
          </h1>
          <p
            className="text-lg sm:text-xl text-white/45 font-light max-w-xl mx-auto"
            style={{
              animation: mounted ? 'float-up 0.7s ease-out 0.25s forwards' : 'none',
              opacity: 0,
            }}
          >
            A racing game that turns your browser into the windshield of a high-performance car.
          </p>
        </div>
      </section>

      {/* ===================== STORY SECTIONS ===================== */}
      <section className="relative z-10 pb-24 sm:pb-36 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">

          {/* What is Shadow Driver? */}
          <StorySection icon={<GamepadIcon />} title="What is Shadow Driver?" delay={0}>
            <p>
              Shadow Driver is a racing game you play right in your browser. No downloads, no installs,
              no sign-ups. Just open the link and drive.
            </p>
            <p>
              You race against a computer-controlled opponent through realistic city streets --
              dodging traffic, taking corners, and trying to cross the finish line first.
              Think of it like a console racing game, except it runs in a browser tab.
            </p>
          </StorySection>

          {/* How does it work? */}
          <StorySection icon={<CloudIcon />} title="How does it work?" delay={0.1}>
            <p>
              When you hit "Race Now," we fire up a powerful computer in the cloud that runs a
              beautiful driving simulator. That simulator renders the entire 3D world -- the roads,
              the buildings, the cars, the sky -- and streams the video straight to your browser, like
              a live video call.
            </p>
            <p>
              When you press W to accelerate or A to turn left, those key presses travel to the cloud
              computer, and your car responds right away. It feels just like playing a game installed
              on your own machine, but all the heavy lifting is happening somewhere else.
            </p>
          </StorySection>

          {/* Why is this cool? */}
          <StorySection icon={<SparklesIcon />} title="Why is this cool?" delay={0.2}>
            <p>
              Most browser games are simple -- flat graphics, basic physics, nothing like what you would
              see on a gaming console. Shadow Driver is different. Because the graphics are rendered
              on powerful hardware in the cloud and streamed to you, you get console-quality visuals
              without needing a gaming PC.
            </p>
            <p>
              The cars behave like real cars. They have weight, momentum, and tire grip. Slam the brakes
              mid-turn and you will spin out. Floor it on a wet road and the tires lose traction.
              It is not an arcade game pretending to be realistic -- it is the same technology
              used by self-driving car researchers.
            </p>
          </StorySection>

          {/* The AI opponent */}
          <StorySection icon={<BrainIcon />} title="The AI opponent" delay={0.3}>
            <p>
              Your opponent is not following a pre-recorded path or a set of "if this, then that" rules.
              It is an AI that looks at the road ahead -- the same camera view you see -- and makes
              real decisions about when to turn the wheel, hit the gas, or tap the brakes.
            </p>
            <p>
              Think of it like a self-driving car, but one that is trying to beat you in a race.
              It sees the road, plans its moves, and drives. Sometimes it is smooth and fast.
              Sometimes it makes mistakes. That unpredictability is what makes racing against it
              genuinely fun.
            </p>
          </StorySection>

          {/* Who made this? */}
          <StorySection icon={<HeartIcon />} title="Who made this?" delay={0.4}>
            <p>
              Shadow Driver is a passion project -- built out of curiosity and a love for racing games.
              The question that started it all was simple: "What if you could play a beautiful,
              realistic racing game without owning a powerful computer?"
            </p>
            <p>
              Turns out, you can. All you need is a browser and a decent internet connection. The rest
              happens in the cloud.
            </p>
            <p>
              The project is open source. Anyone can peek under the hood, suggest improvements,
              or build on top of it.
            </p>
          </StorySection>

        </div>
      </section>

      {/* ===================== CTA ===================== */}
      <section className="relative z-10 pb-24 sm:pb-36 px-4 sm:px-6">
        <CTA />
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8 sm:py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/15 text-xs sm:text-sm font-mono">
            Shadow Driver &middot; A passion project
          </p>
          <div className="flex items-center gap-6">
            <a href="/" className="text-white/15 hover:text-white/40 transition-colors text-xs sm:text-sm">
              Home
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
// CTA
// ============================================================
function CTA() {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} className="text-center" style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(30px)',
      transition: 'opacity 0.8s ease, transform 0.8s ease',
    }}>
      <h2 className="text-3xl sm:text-5xl font-black mb-4 text-white tracking-tight">
        Want to try it?
      </h2>
      <p className="text-white/35 text-sm sm:text-base mb-10 max-w-md mx-auto">
        Open your browser. Pick a car. Beat the AI.
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
