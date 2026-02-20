/**
 * useDrunkAIMode.ts - "Drunk AI" mode
 *
 * The AI's steering gets progressively noisier as the race progresses.
 * By the final lap, it's swerving wildly. Hilarious to watch.
 *
 * drunkLevel ramps from 0 (lap 1) to 1.0 (final lap).
 * Sends { type: 'drunk_ai', level: drunkLevel } to the server via WebSocket
 * when the lap changes, so the server can add steering noise:
 *   noise = random() * drunkLevel * 0.5
 *
 * Server-side implementation note (v3/server/carla_manager.py):
 *   When receiving 'drunk_ai' message, store the level and apply:
 *     ai_steer += (random.random() * 2 - 1) * drunk_level * 0.5
 *   to the AI's steering each tick. This makes the AI progressively swerve.
 */
import { useState, useCallback, useEffect, useRef } from 'react';

interface UseDrunkAIModeOptions {
  enabled: boolean;
  lapNumber: number;
  totalLaps: number;
  /** Function to send the drunk_ai message to the server */
  sendMessage?: (level: number) => void;
}

interface UseDrunkAIModeReturn {
  /** Drunk level from 0 (sober) to 1 (wasted). Ramps with lap progress. */
  drunkLevel: number;
  /** Whether drunk AI mode is enabled */
  enabled: boolean;
  /** Toggle drunk AI mode on/off */
  toggle: () => void;
  /** Whether drunk AI mode is on (alias for enabled, used by RaceSetup) */
  isDrunkMode: boolean;
  /** Set drunk AI mode enabled state */
  setDrunkMode: (on: boolean) => void;
}

export function useDrunkAIMode(options?: UseDrunkAIModeOptions): UseDrunkAIModeReturn {
  const [isDrunkMode, setIsDrunkMode] = useState(false);

  const enabled = options?.enabled ?? isDrunkMode;
  const lapNumber = options?.lapNumber ?? 1;
  const totalLaps = options?.totalLaps ?? 1;
  const sendMessage = options?.sendMessage;

  // Compute drunk level: 0 on lap 1, ramps to 1.0 by the final lap
  const drunkLevel = enabled
    ? Math.min(1, (lapNumber - 1) / Math.max(1, totalLaps - 1))
    : 0;

  // Track previous lap to detect lap changes
  const prevLapRef = useRef(lapNumber);

  // Send drunk_ai message to server when lap changes
  useEffect(() => {
    if (!enabled || !sendMessage) return;
    if (lapNumber !== prevLapRef.current) {
      prevLapRef.current = lapNumber;
      sendMessage(drunkLevel);
    }
  }, [enabled, lapNumber, drunkLevel, sendMessage]);

  // Send initial drunk_ai message when mode is first enabled
  const prevEnabledRef = useRef(enabled);
  useEffect(() => {
    if (enabled && !prevEnabledRef.current && sendMessage) {
      sendMessage(drunkLevel);
    }
    prevEnabledRef.current = enabled;
  }, [enabled, drunkLevel, sendMessage]);

  const toggle = useCallback(() => {
    setIsDrunkMode(prev => !prev);
  }, []);

  return {
    drunkLevel,
    enabled,
    toggle,
    isDrunkMode,
    setDrunkMode: setIsDrunkMode,
  };
}
