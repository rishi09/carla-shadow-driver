/**
 * TwitchOverlay.tsx - "Twitch Plays" voting overlay
 *
 * Shows during racing when Twitch chat is connected:
 * - TWITCH PLAYS header with Twitch purple accent
 * - Vote bars showing distribution per command
 * - Winning command highlighted with glow
 * - Mini chat log (last 5 messages)
 * - Connected viewer count
 * - Vote window countdown bar (500ms cycle)
 */
import { useState, useEffect, useRef } from 'react';
import type { TwitchCommand, TwitchChatMessage } from '../hooks/useTwitchChat.ts';

const TWITCH_PURPLE = '#9146ff';
const TWITCH_PURPLE_DIM = 'rgba(145, 70, 255, 0.3)';
const VOTE_WINDOW_MS = 500;

const COMMAND_LABELS: Record<TwitchCommand, string> = {
  left: 'LEFT',
  right: 'RIGHT',
  gas: 'GAS',
  brake: 'BRAKE',
  boost: 'BOOST',
  drift: 'DRIFT',
};

const COMMAND_COLORS: Record<TwitchCommand, string> = {
  left: '#60a5fa',   // blue
  right: '#f97316',  // orange
  gas: '#22c55e',    // green
  brake: '#ef4444',  // red
  boost: '#eab308',  // yellow
  drift: '#a78bfa',  // violet
};

interface TwitchOverlayProps {
  isConnected: boolean;
  viewerCount: number;
  currentCommand: TwitchCommand | '';
  votes: Record<TwitchCommand, number>;
  chatLog: TwitchChatMessage[];
  channel: string | null;
}

export function TwitchOverlay({
  isConnected,
  viewerCount,
  currentCommand,
  votes,
  chatLog,
  channel,
}: TwitchOverlayProps) {
  // Vote window progress bar (resets every 500ms)
  const [windowProgress, setWindowProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const windowStartRef = useRef(performance.now());

  useEffect(() => {
    if (!isConnected) return;

    const animate = () => {
      const elapsed = (performance.now() - windowStartRef.current) % VOTE_WINDOW_MS;
      setWindowProgress(elapsed / VOTE_WINDOW_MS);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isConnected]);

  // Reset window start when votes are tallied (viewerCount changes = new window)
  useEffect(() => {
    windowStartRef.current = performance.now();
  }, [votes]);

  if (!isConnected) return null;

  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const maxVotes = Math.max(...Object.values(votes), 1);

  // Commands sorted by vote count (descending), then alphabetical
  const sortedCommands = (Object.keys(COMMAND_LABELS) as TwitchCommand[])
    .filter(cmd => votes[cmd] > 0 || cmd === currentCommand)
    .sort((a, b) => votes[b] - votes[a] || a.localeCompare(b));

  // If nothing has votes, show the main 4 commands
  const displayCommands = sortedCommands.length > 0
    ? sortedCommands
    : (['left', 'right', 'gas', 'brake'] as TwitchCommand[]);

  const lastMessages = chatLog.slice(-5);

  return (
    <div className="absolute top-4 right-4 z-30 pointer-events-none" style={{ width: 220 }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-2 border border-b-0"
        style={{
          borderColor: TWITCH_PURPLE_DIM,
          background: `linear-gradient(135deg, rgba(145, 70, 255, 0.15) 0%, rgba(0, 0, 0, 0.7) 100%)`,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Twitch icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill={TWITCH_PURPLE}>
          <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
        </svg>
        <span
          className="font-black text-xs uppercase tracking-widest"
          style={{ color: TWITCH_PURPLE }}
        >
          Twitch Plays
        </span>
        {/* Viewer count */}
        <div className="ml-auto flex items-center gap-1">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: '#22c55e',
              animation: 'twitch-live-pulse 2s ease-in-out infinite',
            }}
          />
          <span className="text-white/60 text-[10px] font-mono">{viewerCount}</span>
        </div>
      </div>

      {/* Channel name */}
      {channel && (
        <div
          className="px-3 py-1 border-x text-[10px] font-mono"
          style={{
            borderColor: TWITCH_PURPLE_DIM,
            background: 'rgba(0, 0, 0, 0.6)',
            color: 'rgba(145, 70, 255, 0.6)',
          }}
        >
          #{channel}
        </div>
      )}

      {/* Vote bars */}
      <div
        className="px-3 py-2 border-x space-y-1.5"
        style={{
          borderColor: TWITCH_PURPLE_DIM,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {displayCommands.map((cmd) => {
          const count = votes[cmd];
          const pct = maxVotes > 0 ? (count / maxVotes) * 100 : 0;
          const isWinner = cmd === currentCommand && totalVotes > 0;
          const color = COMMAND_COLORS[cmd];

          return (
            <div key={cmd} className="flex items-center gap-2">
              <span
                className="text-[10px] font-mono font-bold w-11 text-right shrink-0"
                style={{ color: isWinner ? color : 'rgba(255,255,255,0.5)' }}
              >
                {COMMAND_LABELS[cmd]}
              </span>
              <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-sm transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    background: isWinner
                      ? `linear-gradient(90deg, ${color}, ${color}cc)`
                      : `${color}44`,
                    boxShadow: isWinner ? `0 0 8px ${color}80` : 'none',
                  }}
                />
              </div>
              <span
                className="text-[10px] font-mono w-5 text-right shrink-0"
                style={{ color: isWinner ? color : 'rgba(255,255,255,0.3)' }}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Vote window countdown bar */}
      <div
        className="h-1 border-x"
        style={{
          borderColor: TWITCH_PURPLE_DIM,
          background: 'rgba(0, 0, 0, 0.8)',
        }}
      >
        <div
          className="h-full transition-none"
          style={{
            width: `${windowProgress * 100}%`,
            background: `linear-gradient(90deg, ${TWITCH_PURPLE}, ${TWITCH_PURPLE}aa)`,
          }}
        />
      </div>

      {/* Winning command display */}
      {currentCommand && totalVotes > 0 && (
        <div
          className="px-3 py-2 border-x flex items-center justify-center"
          style={{
            borderColor: TWITCH_PURPLE_DIM,
            background: 'rgba(0, 0, 0, 0.7)',
          }}
        >
          <span
            className="text-sm font-black uppercase tracking-widest"
            style={{
              color: COMMAND_COLORS[currentCommand],
              textShadow: `0 0 12px ${COMMAND_COLORS[currentCommand]}80, 0 0 24px ${COMMAND_COLORS[currentCommand]}40`,
              animation: 'twitch-cmd-pulse 0.5s ease-out',
            }}
          >
            {COMMAND_LABELS[currentCommand]}
          </span>
        </div>
      )}

      {/* Mini chat log */}
      <div
        className="px-3 py-2 rounded-b-lg border space-y-0.5 max-h-24 overflow-hidden"
        style={{
          borderColor: TWITCH_PURPLE_DIM,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {lastMessages.length === 0 ? (
          <div className="text-[10px] text-white/20 font-mono italic">
            Waiting for chat commands...
          </div>
        ) : (
          lastMessages.map((msg, i) => (
            <div key={`${msg.timestamp}-${i}`} className="text-[10px] font-mono truncate">
              <span style={{ color: TWITCH_PURPLE }} className="font-bold">{msg.user}</span>
              <span className="text-white/30">: </span>
              <span className="text-white/60">{msg.msg}</span>
            </div>
          ))
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes twitch-live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes twitch-cmd-pulse {
          0% { transform: scale(1.2); opacity: 0.6; }
          100% { transform: scale(1.0); opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}

export default TwitchOverlay;
