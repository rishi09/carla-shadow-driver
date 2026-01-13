import { useState } from 'react';

interface HeaderProps {
  className?: string;
}

export function Header({ className = '' }: HeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <header
      className={`
        sticky top-0 z-50
        bg-dark-400/80 backdrop-blur-lg
        border-b border-white/5
        ${className}
      `}
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {/* Logo icon - steering wheel stylized */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-human to-ai flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="9" />
                  <line x1="12" y1="15" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="9" y2="12" />
                  <line x1="15" y1="12" x2="22" y2="12" />
                </svg>
              </div>
              {/* Pulse effect */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-human to-ai opacity-50 animate-ping" />
            </div>

            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Shadow Driver
              </h1>
              <p className="text-xs text-white/50">
                Human vs AI Racing
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <NavLink href="#" active>Home</NavLink>
            <NavLink href="#">Leaderboard</NavLink>
            <NavLink href="#">How to Play</NavLink>
          </nav>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`
              p-2 rounded-lg
              bg-white/5 hover:bg-white/10
              border border-white/10 hover:border-white/20
              transition-all duration-200
              group
            `}
            aria-label="Settings"
          >
            <svg
              className="w-5 h-5 text-white/70 group-hover:text-white transition-colors"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  active?: boolean;
}

function NavLink({ href, children, active = false }: NavLinkProps) {
  return (
    <a
      href={href}
      className={`
        relative text-sm font-medium
        transition-colors duration-200
        ${active ? 'text-white' : 'text-white/60 hover:text-white'}
      `}
    >
      {children}
      {active && (
        <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-human to-ai rounded-full" />
      )}
    </a>
  );
}
