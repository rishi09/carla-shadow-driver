/**
 * AIChatBubble.tsx - Animated speech bubble for AI opponent trash talk
 *
 * Shows a slide-in speech bubble in the top-right corner with a
 * helmet icon and the AI's message. Auto-dismisses after 3 seconds
 * with a fade-out animation.
 */
import { useState, useEffect, useRef } from 'react';
import type { AIChatMessage } from '../types/index.ts';

interface AIChatBubbleProps {
  message: AIChatMessage | null;
}

export function AIChatBubble({ message }: AIChatBubbleProps) {
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [fading, setFading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clean up any running timers
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);

    if (message && message.text) {
      setDisplayText(message.text);
      setFading(false);
      setVisible(true);

      // Start fade-out after 3 seconds
      timeoutRef.current = setTimeout(() => {
        setFading(true);
        // Remove from DOM after fade animation completes (500ms)
        fadeTimeoutRef.current = setTimeout(() => {
          setVisible(false);
          setFading(false);
        }, 500);
      }, 3000);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [message]);

  if (!visible) return null;

  return (
    <div
      className="absolute top-20 right-4 z-20 pointer-events-none"
      style={{
        animation: fading ? 'ai-chat-fade-out 0.5s ease-in forwards' : 'ai-chat-slide-in 0.4s ease-out forwards',
      }}
    >
      <div className="flex items-start gap-2.5 max-w-[320px]">
        {/* Helmet icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-500/30 border border-red-400/50 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-300">
            <path d="M12 2C6.5 2 2 6.5 2 12v3c0 1.1.9 2 2 2h1c1.1 0 2-.9 2-2v-1c0-1.1-.9-2-2-2" />
            <path d="M22 12v3c0 1.1-.9 2-2 2h-1c-1.1 0-2-.9-2-2v-1c0-1.1.9-2 2-2" />
            <path d="M12 2a10 10 0 0 1 10 10" />
            <path d="M12 2a10 10 0 0 0-10 10" />
          </svg>
        </div>

        {/* Speech bubble */}
        <div className="relative bg-black/70 backdrop-blur-md border border-red-400/30 rounded-xl rounded-tl-sm px-4 py-2.5 shadow-lg shadow-red-500/10">
          {/* Name label */}
          <div className="text-red-400 text-[10px] font-bold font-mono uppercase tracking-widest mb-0.5">
            SHADOW
          </div>
          {/* Message text */}
          <div className="text-white text-sm font-semibold leading-snug">
            {displayText}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ai-chat-slide-in {
          0% {
            opacity: 0;
            transform: translateX(80px) scale(0.9);
          }
          100% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        @keyframes ai-chat-fade-out {
          0% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateX(40px) scale(0.95);
          }
        }
      `}</style>
    </div>
  );
}
