/**
 * useTabPenalty.ts - "The Tab Penalty"
 *
 * Fourth-wall breaking feature: when the player switches browser tabs during
 * a race, the AI "trains" while they're gone. Tracks time away and shows
 * witty messages when the player returns.
 *
 * Implementation:
 * - Listens to document.visibilitychange
 * - Tracks cumulative time away
 * - Shows a toast message on return
 * - Sends tab_penalty message to server via WebSocket (for future server-side boost)
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface TabPenaltyMessage {
  text: string;
  id: number;
}

export interface UseTabPenaltyReturn {
  /** Total seconds the player spent away from the tab during the race */
  totalSecondsAway: number;
  /** Number of times the player switched away */
  switchCount: number;
  /** Current toast message to display (null when hidden) */
  message: TabPenaltyMessage | null;
  /** Reset all tracking (for new race) */
  reset: () => void;
}

const TAB_AWAY_MESSAGES = [
  'The AI trained while you were gone.',
  'You left? The AI got faster.',
  'Alt-Tab detected. The AI does not forgive.',
  'Welcome back. The AI used the time wisely.',
  'Tab switch penalty applied. Focus up.',
  'The AI practiced its racing line while you were away.',
  'Gone for {seconds}s? The AI sends its regards.',
  'The AI does not take breaks. Neither should you.',
];

function getReturnMessage(secondsAway: number): string {
  const template = TAB_AWAY_MESSAGES[Math.floor(Math.random() * TAB_AWAY_MESSAGES.length)];
  return template.replace('{seconds}', secondsAway.toFixed(1));
}

export function useTabPenalty(
  isRacing: boolean,
  sendWebSocketMessage?: (msg: string) => void,
): UseTabPenaltyReturn {
  const [totalSecondsAway, setTotalSecondsAway] = useState(0);
  const [switchCount, setSwitchCount] = useState(0);
  const [message, setMessage] = useState<TabPenaltyMessage | null>(null);
  const messageIdRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);
  const totalAwayRef = useRef(0);
  const switchCountRef = useRef(0);

  const reset = useCallback(() => {
    setTotalSecondsAway(0);
    setSwitchCount(0);
    setMessage(null);
    totalAwayRef.current = 0;
    switchCountRef.current = 0;
    hiddenAtRef.current = null;
  }, []);

  useEffect(() => {
    if (!isRacing) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Player switched away -- start timer
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtRef.current !== null) {
        // Player returned -- calculate time away
        const secondsAway = (Date.now() - hiddenAtRef.current) / 1000;
        hiddenAtRef.current = null;

        // Only count meaningful absences (> 1 second)
        if (secondsAway < 1) return;

        totalAwayRef.current += secondsAway;
        switchCountRef.current += 1;
        setTotalSecondsAway(totalAwayRef.current);
        setSwitchCount(switchCountRef.current);

        // Show return message
        const id = ++messageIdRef.current;
        const text = getReturnMessage(secondsAway);
        setMessage({ text, id });

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
          setMessage(prev => prev?.id === id ? null : prev);
        }, 3000);

        // Send penalty info to server via WebSocket
        if (sendWebSocketMessage) {
          try {
            sendWebSocketMessage(JSON.stringify({
              type: 'tab_penalty',
              seconds_away: Math.round(secondsAway * 10) / 10,
              total_away: Math.round(totalAwayRef.current * 10) / 10,
              switch_count: switchCountRef.current,
            }));
          } catch {
            // WebSocket might not be open -- ignore
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isRacing, sendWebSocketMessage]);

  return {
    totalSecondsAway,
    switchCount,
    message,
    reset,
  };
}
