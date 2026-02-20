/**
 * CommentarySubtitle.tsx - Race commentary subtitle bar
 *
 * Renders the current commentary line as a cinematic subtitle at the bottom
 * of the screen. Features a slide-up entrance, fade-out exit, typing effect,
 * and quotation mark decoration.
 */
import { useState, useEffect, useRef } from 'react';

interface CommentarySubtitleProps {
  /** The current commentary line, or null to hide. */
  line: string | null;
}

/** Speed of the typing effect in characters per second. */
const TYPING_SPEED = 30;

export function CommentarySubtitle({ line }: CommentarySubtitleProps) {
  /** The visible portion of the text (typing effect). */
  const [displayedText, setDisplayedText] = useState('');
  /** Whether the subtitle is in the process of fading out. */
  const [fadingOut, setFadingOut] = useState(false);
  /** Whether the subtitle is visible at all. */
  const [visible, setVisible] = useState(false);
  /** The line currently being typed/displayed. */
  const activeLineRef = useRef<string | null>(null);
  /** Typing interval reference. */
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Clean up typing interval on unmount
    return () => {
      if (typingRef.current !== null) {
        clearInterval(typingRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (line && line !== activeLineRef.current) {
      // New line arrived: start typing effect
      activeLineRef.current = line;
      setFadingOut(false);
      setVisible(true);
      setDisplayedText('');

      // Clear any existing typing interval
      if (typingRef.current !== null) {
        clearInterval(typingRef.current);
      }

      let charIndex = 0;
      const intervalMs = 1000 / TYPING_SPEED;
      typingRef.current = setInterval(() => {
        charIndex++;
        if (charIndex >= line.length) {
          setDisplayedText(line);
          if (typingRef.current !== null) {
            clearInterval(typingRef.current);
            typingRef.current = null;
          }
        } else {
          setDisplayedText(line.slice(0, charIndex));
        }
      }, intervalMs);
    } else if (!line && activeLineRef.current) {
      // Line removed: start fade-out
      activeLineRef.current = null;
      if (typingRef.current !== null) {
        clearInterval(typingRef.current);
        typingRef.current = null;
      }
      setFadingOut(true);
      // After fade-out animation, hide completely
      const timeout = setTimeout(() => {
        setVisible(false);
        setFadingOut(false);
        setDisplayedText('');
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [line]);

  if (!visible) return null;

  return (
    <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-none z-30">
      <div
        className="max-w-[700px] mx-4"
        style={{
          animation: fadingOut
            ? 'commentary-subtitle-out 0.5s ease-in forwards'
            : 'commentary-subtitle-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        }}
      >
        <div className="bg-black/70 backdrop-blur-md rounded-lg px-6 py-3 border border-white/10 shadow-lg shadow-black/40">
          <div className="flex items-start gap-2">
            {/* Microphone / quotation mark icon */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-white/40 shrink-0 mt-0.5"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span
              className="text-white text-base font-semibold leading-snug"
              style={{
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}
            >
              {displayedText}
              {/* Typing cursor: visible while still typing */}
              {displayedText.length < (activeLineRef.current?.length ?? 0) && (
                <span className="text-white/50 animate-pulse">|</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes commentary-subtitle-in {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes commentary-subtitle-out {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(10px);
          }
        }
      `}</style>
    </div>
  );
}
