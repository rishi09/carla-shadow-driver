import type { RaceResult } from '../../types/game';

/**
 * ScoringSystem - Tracks race progress, lap times, penalties, and bonuses
 *
 * Scoring Rules:
 * - Lap Time: Raw ms (primary metric)
 * - Crash Penalty: +3000ms per boundary/obstacle collision
 * - Off-Track: +500ms per second while outside track boundaries
 * - Checkpoint Bonus: -200ms per checkpoint hit cleanly
 * - Perfect Lap: -2000ms bonus for no crashes + all checkpoints in order
 *
 * Winner determination (head-to-head):
 * 1. More laps completed wins
 * 2. If tied, lower total time wins
 */

/** Penalty and bonus constants (in milliseconds) */
export const SCORING_CONSTANTS = {
  CRASH_PENALTY: 3000,
  OFF_TRACK_PENALTY_PER_SECOND: 500,
  CHECKPOINT_BONUS: 200,
  PERFECT_LAP_BONUS: 2000,
} as const;

/** Detailed result of a single lap */
export interface LapDetailedResult {
  lapNumber: number;
  rawTime: number;
  penalties: number;
  checkpointBonuses: number;
  perfectBonus: number;
  finalTime: number;
  crashCount: number;
  checkpointsHit: number;
  totalCheckpoints: number;
  isPerfect: boolean;
}

/** Extended race result with detailed scoring */
export interface ExtendedRaceResult extends RaceResult {
  lapDetails: LapDetailedResult[];
  totalPenalties: number;
  totalBonuses: number;
  perfectLaps: number;
  winner?: 'player' | 'ai';
}

/** Stored personal best for time trial mode */
export interface PersonalBest {
  trackId: string;
  time: number;
  date: string;
  lapTimes: number[];
}

export class ScoringSystem {
  private totalCheckpoints: number;
  private checkpointsHit: Set<number> = new Set();
  private currentLap: number = 0;
  private totalLaps: number = 3;

  // Timing
  private lapStartTime: number = 0;
  private lapTimes: number[] = [];
  private lapDetails: LapDetailedResult[] = [];
  private bestLapTime: number | null = null;

  // Penalties and bonuses (current lap)
  private currentLapCrashCount: number = 0;
  private currentLapOffTrackTime: number = 0;
  private currentLapPenalties: number = 0;

  // Totals (all laps)
  private crashCount: number = 0;
  private offTrackTime: number = 0;
  private totalPenalties: number = 0;
  private totalBonuses: number = 0;
  private perfectLaps: number = 0;

  // State
  private raceFinished: boolean = false;

  constructor(totalCheckpoints: number, totalLaps: number = 3) {
    if (totalCheckpoints < 0) {
      throw new Error('Total checkpoints must be non-negative');
    }
    this.totalCheckpoints = totalCheckpoints;
    this.totalLaps = totalLaps;
  }

  /**
   * Start the race timer
   */
  startRace(time: number): void {
    if (time < 0) {
      throw new Error('Start time must be non-negative');
    }
    this.currentLap = 1;
    this.startLap(time);
  }

  /**
   * Start a new lap
   */
  startLap(time: number): void {
    this.lapStartTime = time;
    this.checkpointsHit.clear();
    this.currentLapCrashCount = 0;
    this.currentLapOffTrackTime = 0;
    this.currentLapPenalties = 0;
  }

  /**
   * Record a checkpoint hit
   * @returns true if checkpoint was successfully recorded
   */
  hitCheckpoint(checkpointId: number): boolean {
    if (this.checkpointsHit.has(checkpointId)) {
      return false; // Already hit
    }

    // Enforce sequential checkpoint order
    const expectedCheckpoint = this.checkpointsHit.size;
    if (checkpointId !== expectedCheckpoint) {
      return false; // Wrong checkpoint
    }

    this.checkpointsHit.add(checkpointId);
    return true;
  }

  /**
   * Complete current lap and start next
   * @returns true if lap was valid (all checkpoints hit)
   */
  completeLap(time: number): boolean {
    // Verify all checkpoints were hit
    if (this.checkpointsHit.size < this.totalCheckpoints) {
      return false;
    }

    const rawTime = time - this.lapStartTime;

    // Calculate checkpoint bonuses
    const checkpointsHitCount = this.checkpointsHit.size;
    const checkpointBonuses = checkpointsHitCount * SCORING_CONSTANTS.CHECKPOINT_BONUS;

    // Determine if perfect lap (no crashes + all checkpoints)
    const isPerfect = this.currentLapCrashCount === 0 && checkpointsHitCount === this.totalCheckpoints;
    const perfectBonus = isPerfect ? SCORING_CONSTANTS.PERFECT_LAP_BONUS : 0;

    if (isPerfect) {
      this.perfectLaps++;
    }

    // Calculate final lap time with penalties and bonuses
    const totalBonuses = checkpointBonuses + perfectBonus;
    const finalTime = Math.max(0, rawTime + this.currentLapPenalties - totalBonuses);

    // Store detailed lap result
    const lapDetail: LapDetailedResult = {
      lapNumber: this.currentLap,
      rawTime,
      penalties: this.currentLapPenalties,
      checkpointBonuses,
      perfectBonus,
      finalTime,
      crashCount: this.currentLapCrashCount,
      checkpointsHit: checkpointsHitCount,
      totalCheckpoints: this.totalCheckpoints,
      isPerfect,
    };
    this.lapDetails.push(lapDetail);

    // Store raw time for backwards compatibility
    this.lapTimes.push(rawTime);

    // Update best lap time (using final time with bonuses/penalties)
    if (this.bestLapTime === null || finalTime < this.bestLapTime) {
      this.bestLapTime = finalTime;
    }

    // Update totals
    this.totalPenalties += this.currentLapPenalties;
    this.totalBonuses += totalBonuses;

    this.currentLap++;

    if (this.currentLap > this.totalLaps) {
      this.raceFinished = true;
      return true; // Race complete
    }

    // Start next lap
    this.startLap(time);
    return true;
  }

  /**
   * Add crash penalty (+3000ms)
   */
  addCrashPenalty(): void {
    this.currentLapCrashCount++;
    this.crashCount++;
    this.currentLapPenalties += SCORING_CONSTANTS.CRASH_PENALTY;
  }

  /**
   * Add off-track time penalty (+500ms per second)
   * @param deltaMs - Time spent off-track this frame (in milliseconds)
   */
  addOffTrackTime(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error('Off-track delta time must be non-negative');
    }
    this.currentLapOffTrackTime += deltaMs;
    this.offTrackTime += deltaMs;
    // Convert ms to seconds, then apply penalty rate
    const penaltyTime = (deltaMs / 1000) * SCORING_CONSTANTS.OFF_TRACK_PENALTY_PER_SECOND;
    this.currentLapPenalties += penaltyTime;
  }

  /**
   * Get current lap number
   */
  getCurrentLap(): number {
    return Math.min(this.currentLap, this.totalLaps);
  }

  /**
   * Get total laps
   */
  getTotalLaps(): number {
    return this.totalLaps;
  }

  /**
   * Get current lap time (raw, without penalties)
   */
  getCurrentLapTime(currentTime: number): number {
    if (this.raceFinished) {
      return this.lapTimes[this.lapTimes.length - 1] || 0;
    }
    return currentTime - this.lapStartTime;
  }

  /**
   * Get current lap time with penalties applied (for HUD display)
   */
  getCurrentLapTimeWithPenalties(currentTime: number): number {
    if (this.raceFinished) {
      const lastDetail = this.lapDetails[this.lapDetails.length - 1];
      return lastDetail ? lastDetail.finalTime : 0;
    }
    const rawTime = currentTime - this.lapStartTime;
    return rawTime + this.currentLapPenalties;
  }

  /**
   * Get best lap time (final time with bonuses/penalties)
   */
  getBestLapTime(): number | null {
    return this.bestLapTime;
  }

  /**
   * Get number of checkpoints hit in current lap
   */
  getCheckpointsHit(): number {
    return this.checkpointsHit.size;
  }

  /**
   * Get total checkpoints
   */
  getTotalCheckpoints(): number {
    return this.totalCheckpoints;
  }

  /**
   * Get current lap crash count
   */
  getCurrentLapCrashCount(): number {
    return this.currentLapCrashCount;
  }

  /**
   * Get current lap penalties
   */
  getCurrentLapPenalties(): number {
    return this.currentLapPenalties;
  }

  /**
   * Check if race is finished
   */
  isRaceFinished(): boolean {
    return this.raceFinished;
  }

  /**
   * Check if currently racing (lap started, not finished)
   */
  isRacing(): boolean {
    return this.currentLap > 0 && !this.raceFinished;
  }

  /**
   * Get final race result (backwards compatible with RaceResult interface)
   */
  getRaceResult(): RaceResult {
    const totalTime = this.lapDetails.reduce((sum, lap) => sum + lap.finalTime, 0);

    return {
      finalTime: totalTime,
      bestLapTime: this.bestLapTime,
      lapTimes: this.lapTimes,
      crashCount: this.crashCount,
      offTrackTime: this.offTrackTime,
      position: 1, // To be set by RaceScene based on comparison
    };
  }

  /**
   * Get extended race result with detailed scoring
   */
  getExtendedRaceResult(): ExtendedRaceResult {
    const baseResult = this.getRaceResult();

    return {
      ...baseResult,
      lapDetails: [...this.lapDetails],
      totalPenalties: this.totalPenalties,
      totalBonuses: this.totalBonuses,
      perfectLaps: this.perfectLaps,
    };
  }

  /**
   * Get total race time so far (with penalties)
   */
  getTotalRaceTime(currentTime: number): number {
    const completedLapsTime = this.lapDetails.reduce((sum, lap) => sum + lap.finalTime, 0);
    const currentLapTime = this.raceFinished ? 0 : currentTime - this.lapStartTime + this.currentLapPenalties;
    return completedLapsTime + currentLapTime;
  }

  /**
   * Reset the scoring system for a new race
   */
  reset(): void {
    this.checkpointsHit.clear();
    this.currentLap = 0;
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.lapDetails = [];
    this.bestLapTime = null;
    this.currentLapCrashCount = 0;
    this.currentLapOffTrackTime = 0;
    this.currentLapPenalties = 0;
    this.crashCount = 0;
    this.offTrackTime = 0;
    this.totalPenalties = 0;
    this.totalBonuses = 0;
    this.perfectLaps = 0;
    this.raceFinished = false;
  }

  /**
   * For head-to-head mode: determine winner between player and AI
   *
   * Winner determination rules:
   * 1. More laps completed wins
   * 2. If tied on laps, lower total time wins
   */
  static determineWinner(
    playerResult: RaceResult | ExtendedRaceResult,
    aiResult: RaceResult | ExtendedRaceResult
  ): 'player' | 'ai' {
    const playerLaps = playerResult.lapTimes.length;
    const aiLaps = aiResult.lapTimes.length;

    // First priority: more laps completed
    if (playerLaps > aiLaps) {
      return 'player';
    }
    if (aiLaps > playerLaps) {
      return 'ai';
    }

    // Same number of laps: lower total time wins
    if (playerResult.finalTime <= aiResult.finalTime) {
      return 'player';
    }
    return 'ai';
  }
}

/**
 * Time Trial utilities for managing personal bests
 */
export class TimeTrialScoring {
  private static STORAGE_KEY_PREFIX = 'shadowdriver_pb_';

  /**
   * Get personal best for a track from localStorage
   */
  static getPersonalBest(trackId: string): PersonalBest | null {
    try {
      const key = `${TimeTrialScoring.STORAGE_KEY_PREFIX}${trackId}`;
      const stored = localStorage.getItem(key);
      if (!stored) {
        return null;
      }
      return JSON.parse(stored) as PersonalBest;
    } catch {
      console.warn('Failed to load personal best from localStorage');
      return null;
    }
  }

  /**
   * Save personal best to localStorage if it beats the current record
   * @returns true if new record was saved
   */
  static savePersonalBest(
    trackId: string,
    result: RaceResult | ExtendedRaceResult
  ): boolean {
    const currentBest = TimeTrialScoring.getPersonalBest(trackId);

    // Only save if this is a new record
    if (currentBest && result.finalTime >= currentBest.time) {
      return false;
    }

    const newBest: PersonalBest = {
      trackId,
      time: result.finalTime,
      date: new Date().toISOString(),
      lapTimes: result.lapTimes,
    };

    try {
      const key = `${TimeTrialScoring.STORAGE_KEY_PREFIX}${trackId}`;
      localStorage.setItem(key, JSON.stringify(newBest));
      return true;
    } catch {
      console.warn('Failed to save personal best to localStorage');
      return false;
    }
  }

  /**
   * Compare result against track target times
   */
  static compareToTrackTimes(
    result: RaceResult | ExtendedRaceResult,
    parTime: number,
    goldTime: number
  ): 'gold' | 'par' | 'below_par' {
    if (result.finalTime <= goldTime) {
      return 'gold';
    }
    if (result.finalTime <= parTime) {
      return 'par';
    }
    return 'below_par';
  }

  /**
   * Clear personal best for a track
   */
  static clearPersonalBest(trackId: string): void {
    try {
      const key = `${TimeTrialScoring.STORAGE_KEY_PREFIX}${trackId}`;
      localStorage.removeItem(key);
    } catch {
      console.warn('Failed to clear personal best from localStorage');
    }
  }

  /**
   * Get all personal bests
   */
  static getAllPersonalBests(): PersonalBest[] {
    const bests: PersonalBest[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(TimeTrialScoring.STORAGE_KEY_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            bests.push(JSON.parse(stored) as PersonalBest);
          }
        }
      }
    } catch {
      console.warn('Failed to load personal bests from localStorage');
    }
    return bests;
  }
}

export default ScoringSystem;
