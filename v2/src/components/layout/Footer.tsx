interface FooterProps {
  gpuStatus?: 'connected' | 'disconnected' | 'connecting';
  className?: string;
}

export function Footer({ gpuStatus = 'disconnected', className = '' }: FooterProps) {
  const statusConfig = {
    connected: {
      color: 'bg-human',
      text: 'GPU Connected',
      pulse: false,
    },
    disconnected: {
      color: 'bg-warning',
      text: 'GPU Offline',
      pulse: false,
    },
    connecting: {
      color: 'bg-accent',
      text: 'Connecting...',
      pulse: true,
    },
  };

  const status = statusConfig[gpuStatus];

  return (
    <footer
      className={`
        bg-dark-400/60 backdrop-blur-md
        border-t border-white/5
        ${className}
      `}
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Credits */}
          <div className="text-sm text-white/40">
            <span>Shadow Driver v2</span>
            <span className="mx-2">|</span>
            <span>Powered by CARLA Simulator</span>
          </div>

          {/* GPU Status Indicator */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className={`
                    w-2 h-2 rounded-full
                    ${status.color}
                  `}
                />
                {status.pulse && (
                  <div
                    className={`
                      absolute inset-0 rounded-full
                      ${status.color}
                      animate-ping
                    `}
                  />
                )}
              </div>
              <span className="text-sm text-white/60">{status.text}</span>
            </div>

            {/* GPU Icon */}
            <div
              className={`
                p-1.5 rounded-md
                ${gpuStatus === 'connected' ? 'bg-human/10' : 'bg-white/5'}
                transition-colors duration-300
              `}
            >
              <svg
                className={`
                  w-4 h-4
                  ${gpuStatus === 'connected' ? 'text-human' : 'text-white/40'}
                  transition-colors duration-300
                `}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
