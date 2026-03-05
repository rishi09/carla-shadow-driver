/**
 * AIChat.tsx - Personality-aware speech bubble for AI opponent trash talk
 *
 * Shows a slide-in speech bubble in the top-left area of the screen with
 * the AI's avatar, name, and message text. Style varies by personality type.
 * Slides in from the left, auto-dismisses with fade-out.
 */

import { useState, useEffect, useRef } from 'react';
import type { AIPersonality, PersonalityStyle } from '../data/aiPersonalities.ts';
import type { AIPersonalityMessage } from '../hooks/useAIPersonality.ts';

interface AIChatProps {
  personality: AIPersonality | null;
  message: AIPersonalityMessage | null;
  isGrudgeMode?: boolean;
}

/** Border color by personality style */
const STYLE_BORDER_COLORS: Record<PersonalityStyle, string> = {
  cold: '#7DD3FC',        // ice blue
  reckless: '#FB923C',    // orange
  sneaky: '#C084FC',      // purple
  professional: '#4ADE80', // green
  cocky: '#FBBF24',       // gold
};

/** Background glow color (subtle) by personality style */
const STYLE_GLOW_COLORS: Record<PersonalityStyle, string> = {
  cold: 'rgba(125, 211, 252, 0.1)',
  reckless: 'rgba(251, 146, 60, 0.1)',
  sneaky: 'rgba(192, 132, 252, 0.1)',
  professional: 'rgba(74, 222, 128, 0.1)',
  cocky: 'rgba(251, 191, 36, 0.1)',
};

/** Text accent color for the AI name label */
const STYLE_NAME_COLORS: Record<PersonalityStyle, string> = {
  cold: '#7DD3FC',
  reckless: '#FB923C',
  sneaky: '#C084FC',
  professional: '#4ADE80',
  cocky: '#FBBF24',
};

export function AIChat({ personality, message, isGrudgeMode = false }: AIChatProps) {
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [fading, setFading] = useState(false);
  const [displayKey, setDisplayKey] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);

    if (message && message.text) {
      setDisplayText(message.text);
      setDisplayKey(message.key);
      setFading(false);
      setVisible(true);

      // Start fade-out after 3 seconds
      timeoutRef.current = setTimeout(() => {
        setFading(true);
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

  if (!visible || !personality) return null;

  const borderColor = isGrudgeMode ? '#EF4444' : STYLE_BORDER_COLORS[personality.style];
  const glowColor = isGrudgeMode ? 'rgba(239, 68, 68, 0.15)' : STYLE_GLOW_COLORS[personality.style];
  const nameColor = isGrudgeMode ? '#EF4444' : STYLE_NAME_COLORS[personality.style];

  return (
    <div
      key={displayKey}
      className="absolute top-20 left-4 z-20 pointer-events-none"
      style={{
        animation: fading
          ? 'ai-chat-out 0.5s ease-in forwards'
          : 'ai-chat-in 0.4s ease-out forwards',
      }}
    >
      <div className="flex items-start gap-2.5 max-w-[340px]">
        {/* Avatar */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg border-2"
          style={{
            borderColor: `${borderColor}88`,
            backgroundColor: glowColor,
            boxShadow: isGrudgeMode ? `0 0 12px rgba(239, 68, 68, 0.3)` : `0 0 8px ${borderColor}30`,
          }}
        >
          {personality.avatar}
        </div>

        {/* Speech bubble */}
        <div className="relative">
          {/* Triangle tail pointing left */}
          <div
            className="absolute left-0 top-3 w-0 h-0"
            style={{
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderRight: `8px solid ${borderColor}50`,
              transform: 'translateX(-8px)',
            }}
          />
          <div
            className="relative rounded-xl rounded-tl-sm px-4 py-2.5 shadow-lg backdrop-blur-md"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              border: `1px solid ${borderColor}50`,
              boxShadow: `0 4px 20px ${glowColor}, 0 0 1px ${borderColor}30`,
            }}
          >
            {/* Name label */}
            <div
              className="text-[10px] font-bold font-mono uppercase tracking-widest mb-0.5 flex items-center gap-1.5"
              style={{ color: nameColor }}
            >
              {personality.name}
              {isGrudgeMode && (
                <span
                  className="text-[9px] px-1 py-px rounded font-bold tracking-wider"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#EF4444',
                  }}
                >
                  GRUDGE
                </span>
              )}
            </div>
            {/* Message text */}
            <div className="text-white text-sm font-semibold leading-snug">
              {displayText}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ai-chat-in {
          0% {
            opacity: 0;
            transform: translateX(-80px) scale(0.9);
          }
          100% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        @keyframes ai-chat-out {
          0% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateX(-40px) scale(0.95);
          }
        }
      `}</style>
    </div>
  );
}
