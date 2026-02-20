/**
 * useHighlightDetector.ts - Automatic highlight detection from race telemetry
 *
 * Analyzes real-time telemetry data to detect "highlight-worthy" moments during
 * a race. Each detected highlight includes a type, timestamp, description, and
 * intensity rating.
 *
 * Highlight criteria:
 * - Overtake: gap_seconds changes sign (position swap)
 * - Close finish: race ends with gap < 1.0s
 * - High speed: speed exceeds 180 km/h for >2 seconds
 * - Big drift: drift score > 500
 * - Near miss: AI and player within 3m at combined speed > 80 km/h
 * - Recovery: speed drops >50%, then recovers within 3s
 * - Last lap overtake: position change in the final lap
 */
import { useRef, useCallback } from 'react';
import type { RaceState, RaceFinished } from '../types/index.ts';

/** Categories of highlights the detector can identify */
export type HighlightType =
  | 'overtake'
  | 'close_finish'
  | 'high_speed'
  | 'big_drift'
  | 'near_miss'
  | 'recovery'
  | 'last_lap_overtake';

/** A single detected highlight moment */
export interface Highlight {
  /** The category of highlight */
  type: HighlightType;
  /** When this highlight occurred (performance.now() timestamp) */
  timestamp: number;
  /** Elapsed time in seconds since race start */
  raceElapsed: number;
  /** Human-readable description for the highlight reel */
  description: string;
  /** Intensity rating from 1 (mild) to 5 (epic) */
  intensity: number;
}

/** Maximum number of highlights stored per race */
const MAX_HIGHLIGHTS = 20;

/** Minimum gap between same-type highlights in milliseconds */
const COOLDOWN_MS: Record<HighlightType, number> = {
  overtake: 5000,
  close_finish: 0, // Only fires once at race end
  high_speed: 10000,
  big_drift: 5000,
  near_miss: 4000,
  recovery: 5000,
  last_lap_overtake: 5000,
};

/** Speed threshold for high-speed highlights in km/h */
const HIGH_SPEED_THRESHOLD = 180;

/** Duration in ms the player must stay above speed threshold */
const HIGH_SPEED_DURATION_MS = 2000;

/** Drift score threshold for big drift highlights */
const BIG_DRIFT_THRESHOLD = 500;

/** Distance in meters for near-miss detection */
const NEAR_MISS_DISTANCE = 3;

/** Minimum speed (km/h) for near-miss to count */
const NEAR_MISS_MIN_SPEED = 80;

/** Recovery detection: fraction of peak speed that counts as "crashed" */
const RECOVERY_DROP_FRACTION = 0.5;

/** Recovery detection: fraction of peak speed that counts as "recovered" */
const RECOVERY_RECOVER_FRACTION = 0.7;

/** Minimum peak speed (km/h) before a recovery event is interesting */
const RECOVERY_MIN_PEAK = 60;

export interface UseHighlightDetectorReturn {
  /** Call with each telemetry update to check for new highlights */
  update: (raceState: RaceState) => void;
  /** Call when race finishes to detect close-finish highlights */
  onRaceFinished: (result: RaceFinished) => void;
  /** Start tracking for a new race */
  start: () => void;
  /** Reset all state */
  reset: () => void;
  /** All detected highlights in chronological order */
  getHighlights: () => Highlight[];
  /** The most recently detected highlight, or null */
  getLatestHighlight: () => Highlight | null;
}

export function useHighlightDetector(): UseHighlightDetectorReturn {
  // --- Stored highlights ---
  const highlightsRef = useRef<Highlight[]>([]);

  // --- Race timing ---
  const raceStartRef = useRef<number>(0);
  const isActiveRef = useRef(false);

  // --- Cooldown tracking: last trigger time per type ---
  const lastTriggerRef = useRef<Partial<Record<HighlightType, number>>>({});

  // --- Gap sign tracking for overtake detection ---
  // positive gap = player behind AI, negative = player ahead
  const prevGapSignRef = useRef<number>(0);

  // --- High speed tracking ---
  const highSpeedStartRef = useRef<number>(0);
  const highSpeedTriggeredRef = useRef(false);

  // --- Recovery tracking: rolling speed history ---
  // Stores recent speeds for ~3 seconds at 30fps (90 samples)
  const speedHistoryRef = useRef<number[]>([]);

  // --- Drift tracking ---
  const prevDriftScoreRef = useRef<number>(0);

  // --- Lap tracking for last-lap overtake ---
  const prevLapRef = useRef<number>(0);

  /**
   * Add a highlight if not on cooldown and under the maximum count.
   */
  const addHighlight = useCallback((type: HighlightType, description: string, intensity: number) => {
    const now = performance.now();

    // Check cooldown
    const lastTrigger = lastTriggerRef.current[type] ?? 0;
    if (now - lastTrigger < COOLDOWN_MS[type]) return;

    // Cap at MAX_HIGHLIGHTS
    if (highlightsRef.current.length >= MAX_HIGHLIGHTS) return;

    const elapsed = raceStartRef.current > 0 ? (now - raceStartRef.current) / 1000 : 0;

    highlightsRef.current.push({
      type,
      timestamp: now,
      raceElapsed: elapsed,
      description,
      intensity: Math.max(1, Math.min(5, intensity)),
    });

    lastTriggerRef.current[type] = now;
  }, []);

  /**
   * Process a telemetry update and check for highlight-worthy events.
   */
  const update = useCallback((raceState: RaceState) => {
    if (!isActiveRef.current) return;
    if (raceState.race_status !== 'racing' && raceState.race_status !== 'finishing') return;

    const player = raceState.player;
    const ai = raceState.ai;
    if (!player) return;

    const now = performance.now();

    // === OVERTAKE DETECTION ===
    const gap = player.gap_seconds;
    if (gap != null) {
      const currentSign = gap > 0 ? 1 : gap < 0 ? -1 : 0;

      if (prevGapSignRef.current > 0 && currentSign < 0) {
        // Player just overtook the AI
        const isFinalLap = player.lap === player.total_laps;
        if (isFinalLap) {
          const totalCp = player.total_checkpoints ?? 0;
          const cpProgress = totalCp > 0 ? player.checkpoint / totalCp : 0;
          addHighlight(
            'last_lap_overtake',
            cpProgress >= 0.8
              ? 'Overtook AI in the final stretch of the last lap!'
              : 'Took the lead on the final lap!',
            cpProgress >= 0.8 ? 5 : 4,
          );
        } else {
          addHighlight(
            'overtake',
            `Overtook AI at ${Math.round(player.speed_kmh)} km/h!`,
            player.speed_kmh > 120 ? 3 : 2,
          );
        }
      } else if (prevGapSignRef.current < 0 && currentSign > 0) {
        // AI overtook the player
        const isFinalLap = player.lap === player.total_laps;
        if (isFinalLap) {
          addHighlight(
            'last_lap_overtake',
            'AI reclaimed the lead on the final lap!',
            4,
          );
        } else {
          addHighlight(
            'overtake',
            'AI took the lead!',
            2,
          );
        }
      }

      if (currentSign !== 0) {
        prevGapSignRef.current = currentSign;
      }
    }

    // === HIGH SPEED DETECTION ===
    if (player.speed_kmh >= HIGH_SPEED_THRESHOLD) {
      if (highSpeedStartRef.current === 0) {
        highSpeedStartRef.current = now;
        highSpeedTriggeredRef.current = false;
      } else if (!highSpeedTriggeredRef.current && now - highSpeedStartRef.current >= HIGH_SPEED_DURATION_MS) {
        highSpeedTriggeredRef.current = true;
        const maxSpeed = Math.round(player.speed_kmh);
        addHighlight(
          'high_speed',
          `Hit ${maxSpeed} km/h! Sustained high speed for ${((now - highSpeedStartRef.current) / 1000).toFixed(1)}s`,
          maxSpeed >= 220 ? 4 : maxSpeed >= 200 ? 3 : 2,
        );
      }
    } else {
      highSpeedStartRef.current = 0;
      highSpeedTriggeredRef.current = false;
    }

    // === BIG DRIFT DETECTION ===
    const driftScore = raceState.drift?.score ?? 0;
    const driftActive = raceState.drift?.active ?? false;

    // Detect when a drift ends with a big score (score was high, now drift ended)
    if (!driftActive && prevDriftScoreRef.current >= BIG_DRIFT_THRESHOLD && driftScore === 0) {
      const finalScore = prevDriftScoreRef.current;
      addHighlight(
        'big_drift',
        `Massive drift! Scored ${Math.round(finalScore)} points`,
        finalScore >= 1500 ? 5 : finalScore >= 1000 ? 4 : finalScore >= 700 ? 3 : 2,
      );
    }
    prevDriftScoreRef.current = driftScore;

    // === NEAR MISS DETECTION ===
    if (
      ai &&
      player.x != null && player.y != null &&
      ai.x != null && ai.y != null
    ) {
      const dx = player.x - ai.x;
      const dy = player.y - ai.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < NEAR_MISS_DISTANCE && player.speed_kmh > NEAR_MISS_MIN_SPEED) {
        addHighlight(
          'near_miss',
          `Close call! ${distance.toFixed(1)}m from AI at ${Math.round(player.speed_kmh)} km/h`,
          player.speed_kmh > 150 ? 4 : 3,
        );
      }
    }

    // === RECOVERY DETECTION ===
    const speed = player.speed_kmh;
    const history = speedHistoryRef.current;
    history.push(speed);
    // Keep ~3 seconds at 30fps = 90 frames
    if (history.length > 90) history.shift();

    if (history.length >= 30) {
      // Look for pattern: peak -> drop > 50% -> recovery > 70% of peak
      const windowSize = Math.min(history.length, 90);
      const window = history.slice(-windowSize);
      const peak = Math.max(...window);

      if (peak >= RECOVERY_MIN_PEAK) {
        // Find the minimum after the peak
        const peakIdx = window.lastIndexOf(peak);
        const afterPeak = window.slice(peakIdx);
        const trough = Math.min(...afterPeak);

        if (
          trough < peak * RECOVERY_DROP_FRACTION &&
          speed > peak * RECOVERY_RECOVER_FRACTION
        ) {
          addHighlight(
            'recovery',
            `Nice save! Recovered from ${Math.round(trough)} to ${Math.round(speed)} km/h`,
            speed > 120 ? 4 : 3,
          );
          // Reset history to prevent re-triggering
          speedHistoryRef.current = [speed];
        }
      }
    }

    // Track lap changes
    prevLapRef.current = player.lap;
  }, [addHighlight]);

  /**
   * Check for close-finish highlight when the race ends.
   */
  const onRaceFinished = useCallback((result: RaceFinished) => {
    if (!isActiveRef.current) return;

    const pTime = result.player_time;
    const aTime = result.ai_time;
    if (pTime != null && aTime != null) {
      const gap = Math.abs(pTime - aTime);
      if (gap < 1.0) {
        const winner = result.winner === 'player' ? 'Won' : 'Lost';
        addHighlight(
          'close_finish',
          `Photo finish! ${winner} by just ${gap.toFixed(3)}s`,
          gap < 0.3 ? 5 : gap < 0.5 ? 4 : 3,
        );
      }
    }

    isActiveRef.current = false;
  }, [addHighlight]);

  /**
   * Start tracking for a new race.
   */
  const start = useCallback(() => {
    highlightsRef.current = [];
    raceStartRef.current = performance.now();
    isActiveRef.current = true;
    lastTriggerRef.current = {};
    prevGapSignRef.current = 0;
    highSpeedStartRef.current = 0;
    highSpeedTriggeredRef.current = false;
    speedHistoryRef.current = [];
    prevDriftScoreRef.current = 0;
    prevLapRef.current = 0;
  }, []);

  /**
   * Reset all state.
   */
  const reset = useCallback(() => {
    highlightsRef.current = [];
    raceStartRef.current = 0;
    isActiveRef.current = false;
    lastTriggerRef.current = {};
    prevGapSignRef.current = 0;
    highSpeedStartRef.current = 0;
    highSpeedTriggeredRef.current = false;
    speedHistoryRef.current = [];
    prevDriftScoreRef.current = 0;
    prevLapRef.current = 0;
  }, []);

  const getHighlights = useCallback((): Highlight[] => {
    return [...highlightsRef.current];
  }, []);

  const getLatestHighlight = useCallback((): Highlight | null => {
    const h = highlightsRef.current;
    return h.length > 0 ? h[h.length - 1] : null;
  }, []);

  return {
    update,
    onRaceFinished,
    start,
    reset,
    getHighlights,
    getLatestHighlight,
  };
}
