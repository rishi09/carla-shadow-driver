/**
 * useCommentary.ts - Race commentary hook
 *
 * Manages a static commentary system that picks random lines from a pre-generated
 * bank based on race events. Implements cooldown, de-duplication, priority override,
 * and auto-dismiss timing.
 */
import { useState, useRef, useCallback } from 'react';
import { COMMENTARY_LINES, COMMENTARY_PRIORITY } from '../data/commentary.ts';
import type { CommentaryEventType } from '../data/commentary.ts';

/** Minimum time between commentary lines (ms). */
const COOLDOWN_MS = 3000;

/** How long a commentary line stays visible (ms). */
const DISPLAY_DURATION_MS = 3000;

export interface UseCommentaryReturn {
  /** The current commentary line to display, or null if none. */
  currentLine: string | null;
  /** Trigger commentary for a given event type. */
  triggerCommentary: (event: CommentaryEventType) => void;
}

export function useCommentary(): UseCommentaryReturn {
  const [currentLine, setCurrentLine] = useState<string | null>(null);

  /** Timestamp of the last displayed commentary (for cooldown). */
  const lastTriggerTimeRef = useRef<number>(0);

  /** The last line that was shown (to avoid immediate repeats). */
  const lastLineRef = useRef<string | null>(null);

  /** The priority of the currently displayed line (for override checks). */
  const currentPriorityRef = useRef<number>(0);

  /** Timer ID for auto-dismiss. */
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerCommentary = useCallback((event: CommentaryEventType) => {
    const now = performance.now();
    const eventPriority = COMMENTARY_PRIORITY[event] ?? 0;

    // Check cooldown: skip if within cooldown AND the new event is not higher priority
    const elapsed = now - lastTriggerTimeRef.current;
    if (elapsed < COOLDOWN_MS && eventPriority <= currentPriorityRef.current) {
      return;
    }

    // Pick a random line that is different from the last one shown
    const lines = COMMENTARY_LINES[event];
    if (!lines || lines.length === 0) return;

    let line: string;
    if (lines.length === 1) {
      line = lines[0];
    } else {
      let attempts = 0;
      do {
        line = lines[Math.floor(Math.random() * lines.length)];
        attempts++;
      } while (line === lastLineRef.current && attempts < 5);
    }

    // Clear any pending dismiss timer
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
    }

    // Set the line
    lastLineRef.current = line;
    lastTriggerTimeRef.current = now;
    currentPriorityRef.current = eventPriority;
    setCurrentLine(line);

    // Auto-dismiss after DISPLAY_DURATION_MS
    dismissTimerRef.current = setTimeout(() => {
      setCurrentLine(null);
      currentPriorityRef.current = 0;
      dismissTimerRef.current = null;
    }, DISPLAY_DURATION_MS);
  }, []);

  return { currentLine, triggerCommentary };
}
