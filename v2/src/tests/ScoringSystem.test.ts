/**
 * ScoringSystem Tests
 *
 * Tests for the scoring system that tracks lap times, penalties, and winners.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ScoringSystem,
  TimeTrialScoring,
  SCORING_CONSTANTS,
} from '../game/systems/ScoringSystem';
import type { RaceResult } from '../types/game';

describe('ScoringSystem', () => {
  let scoringSystem: ScoringSystem;

  beforeEach(() => {
    scoringSystem = new ScoringSystem(5); // 5 checkpoints per lap
  });

  describe('constructor', () => {
    it('should create a scoring system with specified checkpoints', () => {
      const system = new ScoringSystem(10);
      expect(system.getTotalCheckpoints()).toBe(10);
      expect(system.getCheckpointsHit()).toBe(0);
    });

    it('should throw error for negative checkpoint count', () => {
      expect(() => new ScoringSystem(-1)).toThrow('Total checkpoints must be non-negative');
    });

    it('should allow zero checkpoints', () => {
      const system = new ScoringSystem(0);
      expect(system.getTotalCheckpoints()).toBe(0);
    });

    it('should use default 3 laps', () => {
      expect(scoringSystem.getTotalLaps()).toBe(3);
    });

    it('should allow custom lap count', () => {
      const system = new ScoringSystem(5, 5);
      expect(system.getTotalLaps()).toBe(5);
    });
  });

  describe('startRace', () => {
    it('should initialize race with correct start time', () => {
      scoringSystem.startRace(1000);
      expect(scoringSystem.getCurrentLapTime(1500)).toBe(500);
    });

    it('should set current lap to 1', () => {
      scoringSystem.startRace(0);
      expect(scoringSystem.getCurrentLap()).toBe(1);
    });

    it('should throw error for negative start time', () => {
      expect(() => scoringSystem.startRace(-100)).toThrow('Start time must be non-negative');
    });

    it('should set racing state', () => {
      expect(scoringSystem.isRacing()).toBe(false);
      scoringSystem.startRace(0);
      expect(scoringSystem.isRacing()).toBe(true);
    });
  });

  describe('Basic lap timing', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should calculate raw lap time correctly', () => {
      // Hit all checkpoints
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      const completed = scoringSystem.completeLap(10000);

      expect(completed).toBe(true);
      const result = scoringSystem.getExtendedRaceResult();
      expect(result.lapDetails[0].rawTime).toBe(10000);
    });

    it('should track multiple laps', () => {
      // Lap 1
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(10000);

      // Lap 2
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(22000);

      // Lap 3
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(35000);

      const result = scoringSystem.getRaceResult();
      expect(result.lapTimes.length).toBe(3);
      expect(scoringSystem.isRaceFinished()).toBe(true);
    });

    it('should not complete lap without all checkpoints', () => {
      scoringSystem.hitCheckpoint(0);
      scoringSystem.hitCheckpoint(1);
      // Missing checkpoints 2, 3, 4

      const completed = scoringSystem.completeLap(10000);
      expect(completed).toBe(false);
    });
  });

  describe('Checkpoint handling', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should accept checkpoints in sequence', () => {
      expect(scoringSystem.hitCheckpoint(0)).toBe(true);
      expect(scoringSystem.hitCheckpoint(1)).toBe(true);
      expect(scoringSystem.hitCheckpoint(2)).toBe(true);
      expect(scoringSystem.getCheckpointsHit()).toBe(3);
    });

    it('should reject out-of-order checkpoints', () => {
      expect(scoringSystem.hitCheckpoint(0)).toBe(true);
      expect(scoringSystem.hitCheckpoint(2)).toBe(false); // Should be 1
      expect(scoringSystem.getCheckpointsHit()).toBe(1);
    });

    it('should reject duplicate checkpoints', () => {
      expect(scoringSystem.hitCheckpoint(0)).toBe(true);
      expect(scoringSystem.hitCheckpoint(0)).toBe(false);
      expect(scoringSystem.getCheckpointsHit()).toBe(1);
    });
  });

  describe('Crash penalty accumulation', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should add crash penalty correctly', () => {
      scoringSystem.addCrashPenalty();
      expect(scoringSystem.getCurrentLapPenalties()).toBe(SCORING_CONSTANTS.CRASH_PENALTY);
    });

    it('should accumulate multiple crash penalties', () => {
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();

      expect(scoringSystem.getCurrentLapPenalties()).toBe(SCORING_CONSTANTS.CRASH_PENALTY * 3);
      expect(scoringSystem.getCurrentLapCrashCount()).toBe(3);
    });

    it('should include crash penalties in final time', () => {
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();

      // Complete lap with all checkpoints
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      expect(result.lapDetails[0].crashCount).toBe(2);
      expect(result.lapDetails[0].penalties).toBe(SCORING_CONSTANTS.CRASH_PENALTY * 2);
    });
  });

  describe('Off-track penalty', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should accumulate off-track time penalty', () => {
      scoringSystem.addOffTrackTime(1000); // 1 second off-track

      const expectedPenalty = SCORING_CONSTANTS.OFF_TRACK_PENALTY_PER_SECOND; // 500ms
      expect(scoringSystem.getCurrentLapPenalties()).toBe(expectedPenalty);
    });

    it('should handle fractional off-track time', () => {
      scoringSystem.addOffTrackTime(500); // 0.5 seconds off-track

      const expectedPenalty = SCORING_CONSTANTS.OFF_TRACK_PENALTY_PER_SECOND * 0.5; // 250ms
      expect(scoringSystem.getCurrentLapPenalties()).toBe(expectedPenalty);
    });

    it('should combine off-track and crash penalties', () => {
      scoringSystem.addCrashPenalty();
      scoringSystem.addOffTrackTime(2000); // 2 seconds off-track

      const expectedPenalty =
        SCORING_CONSTANTS.CRASH_PENALTY +
        SCORING_CONSTANTS.OFF_TRACK_PENALTY_PER_SECOND * 2;

      expect(scoringSystem.getCurrentLapPenalties()).toBe(expectedPenalty);
    });

    it('should throw error for negative off-track time', () => {
      expect(() => scoringSystem.addOffTrackTime(-100)).toThrow(
        'Off-track delta time must be non-negative'
      );
    });
  });

  describe('Checkpoint bonuses', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should grant checkpoint bonus for each checkpoint', () => {
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      expect(result.lapDetails[0].checkpointsHit).toBe(5);
      expect(result.lapDetails[0].checkpointBonuses).toBe(SCORING_CONSTANTS.CHECKPOINT_BONUS * 5);
    });

    it('should subtract checkpoint bonus from final time', () => {
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      const lap = result.lapDetails[0];

      // Final = raw + penalties - checkpointBonuses - perfectBonus
      const expectedFinal = 10000 - (5 * SCORING_CONSTANTS.CHECKPOINT_BONUS) - SCORING_CONSTANTS.PERFECT_LAP_BONUS;
      expect(lap.finalTime).toBe(expectedFinal);
    });
  });

  describe('Perfect lap detection', () => {
    beforeEach(() => {
      scoringSystem.startRace(0);
    });

    it('should detect perfect lap (no crashes, all checkpoints in order)', () => {
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      expect(result.lapDetails[0].isPerfect).toBe(true);
      expect(result.lapDetails[0].perfectBonus).toBe(SCORING_CONSTANTS.PERFECT_LAP_BONUS);
    });

    it('should not be perfect with crashes', () => {
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      scoringSystem.addCrashPenalty();
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      expect(result.lapDetails[0].isPerfect).toBe(false);
      expect(result.lapDetails[0].perfectBonus).toBe(0);
    });

    it('should apply perfect bonus to final time', () => {
      for (let i = 0; i < 5; i++) {
        scoringSystem.hitCheckpoint(i);
      }
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      const lap = result.lapDetails[0];

      // Perfect lap: raw - checkpointBonuses - perfectBonus
      const expectedFinalTime =
        10000 -
        SCORING_CONSTANTS.CHECKPOINT_BONUS * 5 -
        SCORING_CONSTANTS.PERFECT_LAP_BONUS;

      expect(lap.finalTime).toBe(expectedFinalTime);
    });

    it('should count perfect laps in extended race result', () => {
      // Perfect lap 1
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(10000);

      // Imperfect lap 2
      scoringSystem.addCrashPenalty();
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(20000);

      // Perfect lap 3
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(30000);

      const result = scoringSystem.getExtendedRaceResult();
      expect(result.perfectLaps).toBe(2);
    });
  });

  describe('Final time calculation', () => {
    it('should calculate final time with all components', () => {
      scoringSystem.startRace(0);

      // 2 crashes: +6000ms
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();

      // 1.5s off-track: +750ms
      scoringSystem.addOffTrackTime(1500);

      // 3 checkpoints: -600ms (not all, so no perfect bonus)
      scoringSystem.hitCheckpoint(0);
      scoringSystem.hitCheckpoint(1);
      scoringSystem.hitCheckpoint(2);
      scoringSystem.hitCheckpoint(3);
      scoringSystem.hitCheckpoint(4);

      // Raw time: 10000ms
      // Not perfect because of crashes
      // Final: 10000 + 6000 + 750 - 1000 (5 checkpoints) - 0 (no perfect) = 15750ms
      scoringSystem.completeLap(10000);

      const result = scoringSystem.getExtendedRaceResult();
      const lap = result.lapDetails[0];

      expect(lap.rawTime).toBe(10000);
      expect(lap.crashCount).toBe(2);
      expect(lap.checkpointsHit).toBe(5);
      expect(lap.isPerfect).toBe(false);
      expect(lap.finalTime).toBe(15750);
    });

    it('should not allow negative final time', () => {
      const system = new ScoringSystem(100, 1); // Many checkpoints, 1 lap

      system.startRace(0);

      // Hit many checkpoints to accumulate large bonus
      for (let i = 0; i < 100; i++) {
        system.hitCheckpoint(i);
      }

      // With perfect lap bonus + 100 checkpoint bonuses = 2000 + 20000 = 22000ms bonus
      // Raw time of 5000ms would result in negative, should clamp to 0
      system.completeLap(5000);

      const result = system.getExtendedRaceResult();
      expect(result.lapDetails[0].finalTime).toBe(0);
    });
  });

  describe('Race results', () => {
    it('should return empty-like result for no completed laps', () => {
      const result = scoringSystem.getRaceResult();

      expect(result.lapTimes).toHaveLength(0);
      expect(result.finalTime).toBe(0);
      expect(result.crashCount).toBe(0);
    });

    it('should calculate total time correctly', () => {
      scoringSystem.startRace(0);

      // Lap 1: 10s raw, perfect
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(10000);

      // Lap 2: 15s raw, perfect
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(25000);

      // Lap 3: 15s raw, perfect
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(40000);

      const result = scoringSystem.getRaceResult();

      // Each perfect lap: raw - 1000 (checkpoints) - 2000 (perfect) = raw - 3000
      // Lap 1: 10000 - 3000 = 7000
      // Lap 2: 15000 - 3000 = 12000
      // Lap 3: 15000 - 3000 = 12000
      // Total: 31000
      expect(result.finalTime).toBe(31000);
    });

    it('should find best lap correctly', () => {
      scoringSystem.startRace(0);

      // Lap 1: 12s raw
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(12000);

      // Lap 2: 8s raw - best
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(20000);

      // Lap 3: 11s raw
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(31000);

      const result = scoringSystem.getRaceResult();

      // Best lap is lap 2: 8000 - 1000 - 2000 = 5000
      expect(result.bestLapTime).toBe(5000);
    });

    it('should sum total crashes across all laps', () => {
      scoringSystem.startRace(0);

      // Lap 1: 2 crashes
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(10000);

      // Lap 2: 1 crash
      scoringSystem.addCrashPenalty();
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(20000);

      // Lap 3: 3 crashes
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();
      scoringSystem.addCrashPenalty();
      for (let i = 0; i < 5; i++) scoringSystem.hitCheckpoint(i);
      scoringSystem.completeLap(30000);

      const result = scoringSystem.getRaceResult();
      expect(result.crashCount).toBe(6);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      scoringSystem.startRace(0);
      scoringSystem.addCrashPenalty();
      scoringSystem.hitCheckpoint(0);
      scoringSystem.hitCheckpoint(1);
      scoringSystem.hitCheckpoint(2);
      scoringSystem.hitCheckpoint(3);
      scoringSystem.hitCheckpoint(4);
      scoringSystem.completeLap(10000);

      scoringSystem.reset();

      expect(scoringSystem.getCurrentLap()).toBe(0);
      expect(scoringSystem.isRacing()).toBe(false);
      expect(scoringSystem.getCurrentLapCrashCount()).toBe(0);
      expect(scoringSystem.getCurrentLapPenalties()).toBe(0);
      expect(scoringSystem.getCheckpointsHit()).toBe(0);
      expect(scoringSystem.isRaceFinished()).toBe(false);
    });
  });

  describe('Winner determination', () => {
    it('should declare winner by more laps completed', () => {
      const playerResult: RaceResult = {
        finalTime: 35000,
        bestLapTime: 10000,
        lapTimes: [12000, 11000, 12000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      const aiResult: RaceResult = {
        finalTime: 20000,
        bestLapTime: 9000,
        lapTimes: [10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 2,
      };

      expect(ScoringSystem.determineWinner(playerResult, aiResult)).toBe('player');
    });

    it('should declare winner by lower total time when laps are tied', () => {
      const playerResult: RaceResult = {
        finalTime: 30000,
        bestLapTime: 9000,
        lapTimes: [10000, 10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      const aiResult: RaceResult = {
        finalTime: 32000,
        bestLapTime: 10000,
        lapTimes: [11000, 10000, 11000],
        crashCount: 0,
        offTrackTime: 0,
        position: 2,
      };

      expect(ScoringSystem.determineWinner(playerResult, aiResult)).toBe('player');
    });

    it('should declare AI winner when AI has lower time', () => {
      const playerResult: RaceResult = {
        finalTime: 35000,
        bestLapTime: 11000,
        lapTimes: [12000, 11000, 12000],
        crashCount: 2,
        offTrackTime: 1000,
        position: 1,
      };

      const aiResult: RaceResult = {
        finalTime: 30000,
        bestLapTime: 9000,
        lapTimes: [10000, 10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 2,
      };

      expect(ScoringSystem.determineWinner(playerResult, aiResult)).toBe('ai');
    });

    it('should favor player on exact tie', () => {
      const playerResult: RaceResult = {
        finalTime: 20000,
        bestLapTime: 10000,
        lapTimes: [10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      const aiResult: RaceResult = {
        finalTime: 20000,
        bestLapTime: 10000,
        lapTimes: [10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 2,
      };

      expect(ScoringSystem.determineWinner(playerResult, aiResult)).toBe('player');
    });
  });
});

describe('TimeTrialScoring', () => {
  const mockLocalStorage = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: jest.fn((key: string) => store[key] || null),
      setItem: jest.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
      }),
      clear: jest.fn(() => {
        store = {};
      }),
      key: jest.fn((index: number) => Object.keys(store)[index] || null),
      get length() {
        return Object.keys(store).length;
      },
    };
  })();

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    mockLocalStorage.clear();
  });

  describe('getPersonalBest', () => {
    it('should return null for non-existent track', () => {
      const result = TimeTrialScoring.getPersonalBest('nonexistent');
      expect(result).toBeNull();
    });

    it('should return stored personal best', () => {
      const pb = {
        trackId: 'track1',
        time: 30000,
        date: '2024-01-01',
        lapTimes: [10000, 10000, 10000],
      };
      mockLocalStorage.setItem('shadowdriver_pb_track1', JSON.stringify(pb));

      const result = TimeTrialScoring.getPersonalBest('track1');
      expect(result).toEqual(pb);
    });
  });

  describe('savePersonalBest', () => {
    it('should save new personal best', () => {
      const result: RaceResult = {
        finalTime: 30000,
        bestLapTime: 10000,
        lapTimes: [10000, 10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      const saved = TimeTrialScoring.savePersonalBest('track1', result);

      expect(saved).toBe(true);
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should not save if not a new record', () => {
      const existingPb = {
        trackId: 'track1',
        time: 25000, // Better than new result
        date: '2024-01-01',
        lapTimes: [8000, 8000, 9000],
      };
      mockLocalStorage.setItem('shadowdriver_pb_track1', JSON.stringify(existingPb));

      const result: RaceResult = {
        finalTime: 30000, // Worse time
        bestLapTime: 10000,
        lapTimes: [10000, 10000, 10000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      // Clear the call count from setup
      mockLocalStorage.setItem.mockClear();

      const saved = TimeTrialScoring.savePersonalBest('track1', result);

      expect(saved).toBe(false);
    });

    it('should replace if new record is better', () => {
      const existingPb = {
        trackId: 'track1',
        time: 35000,
        date: '2024-01-01',
        lapTimes: [12000, 11000, 12000],
      };
      mockLocalStorage.setItem('shadowdriver_pb_track1', JSON.stringify(existingPb));

      const result: RaceResult = {
        finalTime: 28000, // Better time!
        bestLapTime: 9000,
        lapTimes: [9000, 9500, 9500],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      const saved = TimeTrialScoring.savePersonalBest('track1', result);

      expect(saved).toBe(true);
    });
  });

  describe('compareToTrackTimes', () => {
    it('should return gold for times <= goldTime', () => {
      const result: RaceResult = {
        finalTime: 25000,
        bestLapTime: 8000,
        lapTimes: [8000, 8500, 8500],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      expect(TimeTrialScoring.compareToTrackTimes(result, 35000, 28000)).toBe('gold');
    });

    it('should return par for times between goldTime and parTime', () => {
      const result: RaceResult = {
        finalTime: 32000,
        bestLapTime: 10000,
        lapTimes: [10500, 10500, 11000],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      expect(TimeTrialScoring.compareToTrackTimes(result, 35000, 28000)).toBe('par');
    });

    it('should return below_par for times > parTime', () => {
      const result: RaceResult = {
        finalTime: 40000,
        bestLapTime: 12000,
        lapTimes: [13000, 13500, 13500],
        crashCount: 0,
        offTrackTime: 0,
        position: 1,
      };

      expect(TimeTrialScoring.compareToTrackTimes(result, 35000, 28000)).toBe('below_par');
    });
  });

  describe('clearPersonalBest', () => {
    it('should remove personal best from storage', () => {
      const pb = {
        trackId: 'track1',
        time: 30000,
        date: '2024-01-01',
        lapTimes: [10000, 10000, 10000],
      };
      mockLocalStorage.setItem('shadowdriver_pb_track1', JSON.stringify(pb));

      TimeTrialScoring.clearPersonalBest('track1');

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('shadowdriver_pb_track1');
    });
  });
});

describe('Integration: Full Race Scenario', () => {
  it('should handle a complete 3-lap race', () => {
    const scoringSystem = new ScoringSystem(4, 3);

    scoringSystem.startRace(0);

    // Lap 1: Good lap, hit all checkpoints, no crashes (perfect)
    scoringSystem.hitCheckpoint(0);
    scoringSystem.hitCheckpoint(1);
    scoringSystem.hitCheckpoint(2);
    scoringSystem.hitCheckpoint(3);
    scoringSystem.completeLap(12000);

    const result1 = scoringSystem.getExtendedRaceResult();
    expect(result1.lapDetails[0].isPerfect).toBe(true);
    expect(result1.lapDetails[0].rawTime).toBe(12000);

    // Lap 2: Rough lap, 2 crashes
    scoringSystem.hitCheckpoint(0);
    scoringSystem.addCrashPenalty();
    scoringSystem.hitCheckpoint(1);
    scoringSystem.hitCheckpoint(2);
    scoringSystem.addCrashPenalty();
    scoringSystem.hitCheckpoint(3);
    scoringSystem.completeLap(27000);

    const result2 = scoringSystem.getExtendedRaceResult();
    expect(result2.lapDetails[1].isPerfect).toBe(false);
    expect(result2.lapDetails[1].rawTime).toBe(15000);
    expect(result2.lapDetails[1].crashCount).toBe(2);
    expect(result2.lapDetails[1].checkpointsHit).toBe(4);

    // Lap 3: Moderate lap, 1 crash, all checkpoints
    scoringSystem.addCrashPenalty();
    scoringSystem.hitCheckpoint(0);
    scoringSystem.hitCheckpoint(1);
    scoringSystem.hitCheckpoint(2);
    scoringSystem.hitCheckpoint(3);
    scoringSystem.completeLap(40000);

    const result3 = scoringSystem.getExtendedRaceResult();
    expect(result3.lapDetails[2].isPerfect).toBe(false);
    expect(result3.lapDetails[2].rawTime).toBe(13000);

    // Check final race result
    const raceResult = scoringSystem.getExtendedRaceResult();

    expect(raceResult.lapDetails).toHaveLength(3);
    expect(scoringSystem.isRaceFinished()).toBe(true);
    expect(raceResult.perfectLaps).toBe(1);
  });

  it('should handle head-to-head race with scoring', () => {
    const playerScoring = new ScoringSystem(3, 3);
    const aiScoring = new ScoringSystem(3, 3);

    // Player: completes 3 laps with some errors
    playerScoring.startRace(0);

    playerScoring.hitCheckpoint(0);
    playerScoring.hitCheckpoint(1);
    playerScoring.hitCheckpoint(2);
    playerScoring.completeLap(10000);

    playerScoring.addCrashPenalty();
    playerScoring.hitCheckpoint(0);
    playerScoring.hitCheckpoint(1);
    playerScoring.hitCheckpoint(2);
    playerScoring.completeLap(22000);

    playerScoring.hitCheckpoint(0);
    playerScoring.hitCheckpoint(1);
    playerScoring.hitCheckpoint(2);
    playerScoring.completeLap(33000);

    // AI: completes 3 laps perfectly but slower raw times
    aiScoring.startRace(0);

    aiScoring.hitCheckpoint(0);
    aiScoring.hitCheckpoint(1);
    aiScoring.hitCheckpoint(2);
    aiScoring.completeLap(11000);

    aiScoring.hitCheckpoint(0);
    aiScoring.hitCheckpoint(1);
    aiScoring.hitCheckpoint(2);
    aiScoring.completeLap(22000);

    aiScoring.hitCheckpoint(0);
    aiScoring.hitCheckpoint(1);
    aiScoring.hitCheckpoint(2);
    aiScoring.completeLap(33000);

    const playerResult = playerScoring.getRaceResult();
    const aiResult = aiScoring.getRaceResult();

    // Both completed same laps
    expect(playerResult.lapTimes.length).toBe(3);
    expect(aiResult.lapTimes.length).toBe(3);

    // AI should win (all perfect laps = more bonuses, lower final time)
    const winner = ScoringSystem.determineWinner(playerResult, aiResult);
    expect(winner).toBe('ai');
  });
});
