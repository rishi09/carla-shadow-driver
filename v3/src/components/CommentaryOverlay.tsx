/**
 * CommentaryOverlay.tsx - Animated race commentary toast notifications
 *
 * Displays contextual messages about race events as animated toasts
 * that slide in from the top, hold briefly, then fade out.
 *
 * Also shows spoken commentary subtitles at the bottom of the screen.
 */
import type { CommentaryMessage } from '../hooks/useGPUConnection.ts';

interface CommentaryOverlayProps {
  messages: CommentaryMessage[];
  /** Currently spoken commentary text (from useRaceCommentary) */
  spokenText?: string | null;
}

const CATEGORY_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  positive: {
    bg: 'bg-green-500/20',
    border: 'border-green-400/50',
    text: 'text-green-300',
    icon: '\u25B2', // up triangle
  },
  warning: {
    bg: 'bg-amber-500/20',
    border: 'border-amber-400/50',
    text: 'text-amber-300',
    icon: '\u26A0', // warning sign
  },
  critical: {
    bg: 'bg-red-500/20',
    border: 'border-red-400/50',
    text: 'text-red-300',
    icon: '\u2757', // exclamation
  },
  collision: {
    bg: 'bg-orange-500/20',
    border: 'border-orange-400/50',
    text: 'text-orange-300',
    icon: '\u2B50', // impact star
  },
  drift: {
    bg: 'bg-purple-500/20',
    border: 'border-purple-400/50',
    text: 'text-purple-300',
    icon: '\u21BB', // drift arrow
  },
  info: {
    bg: 'bg-cyan-500/20',
    border: 'border-cyan-400/50',
    text: 'text-cyan-300',
    icon: '\u2139', // info
  },
};

export function CommentaryOverlay({ messages, spokenText }: CommentaryOverlayProps) {
  const hasMessages = messages.length > 0;
  const hasSubtitle = !!spokenText;

  if (!hasMessages && !hasSubtitle) return null;

  return (
    <>
      {/* Server-sent commentary toasts (top-right) */}
      {hasMessages && (
        <div className="absolute top-28 right-4 z-20 pointer-events-none flex flex-col items-end gap-2 w-[360px] max-w-[40vw]">
          {messages.map((msg) => {
            const style = CATEGORY_STYLES[msg.category] || CATEGORY_STYLES.info;
            return (
              <div
                key={msg.id}
                className={`${style.bg} ${style.border} border backdrop-blur-md rounded-lg px-5 py-2.5 shadow-lg`}
                style={{
                  animation: 'commentary-slide-in 0.4s ease-out',
                }}
              >
                <div className={`${style.text} font-bold text-sm font-mono text-center flex items-center gap-2 justify-center`}>
                  <span className="text-base">{style.icon}</span>
                  <span>{msg.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Spoken commentary subtitle (bottom-center) */}
      {hasSubtitle && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[80vw] w-auto">
          <div
            className="bg-black/70 backdrop-blur-md rounded-xl px-6 py-3 shadow-2xl border border-white/10"
            style={{
              animation: 'subtitle-fade-in 0.3s ease-out',
            }}
          >
            <p className="text-white text-base font-semibold text-center leading-relaxed tracking-wide drop-shadow-lg">
              {spokenText}
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes commentary-slide-in {
          0% {
            opacity: 0;
            transform: translateY(-20px) scale(0.9);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes subtitle-fade-in {
          0% {
            opacity: 0;
            transform: translateX(-50%) translateY(10px);
          }
          100% {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `}</style>
    </>
  );
}
