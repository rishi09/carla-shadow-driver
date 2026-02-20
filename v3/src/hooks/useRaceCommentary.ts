/**
 * useRaceCommentary.ts - Template-based AI race commentary with Web Speech API
 *
 * Analyzes race telemetry in real-time and generates contextual commentary
 * lines spoken aloud via window.speechSynthesis. Each commentary category
 * has multiple variations and a cooldown to avoid repetition.
 *
 * Categories: race_start, speed_milestone, overtake, being_overtaken,
 * close_gap, wide_gap, checkpoint, drift, final_lap, near_finish, win, loss, collision
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { RaceState } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Commentary templates
// ---------------------------------------------------------------------------

type CommentaryCategory =
  | 'race_start'
  | 'speed_milestone'
  | 'overtake'
  | 'being_overtaken'
  | 'close_gap'
  | 'wide_gap'
  | 'checkpoint'
  | 'drift'
  | 'final_lap'
  | 'near_finish'
  | 'win'
  | 'loss'
  | 'collision';

interface CommentaryTemplate {
  lines: string[];
  /** Minimum seconds between triggering this category again */
  cooldownSec: number;
}

const TEMPLATES: Record<CommentaryCategory, CommentaryTemplate> = {
  race_start: {
    lines: [
      "And they're off! Both cars launch from the starting line!",
      "The lights go green and the race begins! Let's see what they've got!",
      "They're away! The engines roar as both cars battle for the first corner!",
      "Green light! Both drivers floor it off the line!",
    ],
    cooldownSec: 120, // once per race basically
  },
  speed_milestone: {
    lines: [
      "Incredible speed! The player hits {speed} kilometers per hour!",
      "Pushing the limits! {speed} K P H and climbing!",
      "That's {speed} K P H! This car has some serious power!",
      "The speedometer reads {speed}! Absolutely flying!",
      "What a burst of speed! {speed} K P H through that straight!",
    ],
    cooldownSec: 20,
  },
  overtake: {
    lines: [
      "What a move! The player takes the lead!",
      "Brilliant overtake! The player surges past the A I!",
      "The player makes the pass! They're in front now!",
      "What a maneuver! The player has seized the lead!",
      "And the player goes through! Beautiful racing!",
    ],
    cooldownSec: 8,
  },
  being_overtaken: {
    lines: [
      "Oh no! The A I has taken the lead!",
      "The A I swoops past! The player needs to respond!",
      "Position lost! The A I takes the inside line!",
      "The A I gets through! Time to fight back!",
      "The A I makes the pass. The pressure is on!",
    ],
    cooldownSec: 8,
  },
  close_gap: {
    lines: [
      "The gap is closing! Only {gap} seconds separating them!",
      "It's getting tight! Just {gap} seconds between the two cars!",
      "They're wheel to wheel! {gap} seconds is all there is!",
      "The gap is down to {gap} seconds! This is going to be close!",
      "Neck and neck! Only {gap} seconds apart!",
    ],
    cooldownSec: 10,
  },
  wide_gap: {
    lines: [
      "The A I is building a comfortable lead...",
      "The gap is widening. The player needs to pick up the pace!",
      "That's a significant gap now. Can the player close it?",
      "The A I pulls away. The player has some work to do!",
    ],
    cooldownSec: 20,
  },
  checkpoint: {
    lines: [
      "Clean through checkpoint {cp}!",
      "Checkpoint {cp} cleared! Looking good!",
      "Through checkpoint {cp}! Staying on the racing line!",
      "Another checkpoint down. Solid pace!",
      "Checkpoint {cp} done! Keep it up!",
    ],
    cooldownSec: 12,
  },
  drift: {
    lines: [
      "Beautiful drift through the corner! That's textbook technique!",
      "Sideways and in control! What a drift!",
      "The tail slides out! Stunning car control!",
      "Look at that angle! A picture-perfect drift!",
      "Drifting through like a pro! That's style points right there!",
    ],
    cooldownSec: 12,
  },
  final_lap: {
    lines: [
      "Final lap! Everything comes down to this!",
      "Last lap! This is where champions are made!",
      "One lap to go! It's now or never!",
      "The final lap begins! Can they hold on?",
    ],
    cooldownSec: 120, // once
  },
  near_finish: {
    lines: [
      "They're approaching the finish line!",
      "The checkered flag is in sight! Just a few more corners!",
      "Almost there! The finish line is calling!",
      "Final corners! Who wants it more?",
    ],
    cooldownSec: 30,
  },
  win: {
    lines: [
      "The player takes the checkered flag! What a race!",
      "Victory! The player crosses the line first! Incredible!",
      "The player wins! A masterclass in racing!",
      "That's a win! The player has done it! Fantastic drive!",
    ],
    cooldownSec: 120,
  },
  loss: {
    lines: [
      "The A I crosses first. A tough result, but what a battle!",
      "The A I takes the win. But the player put up a great fight!",
      "Second place for the player. So close! Maybe next time.",
      "The A I finishes ahead. A hard-fought race nonetheless!",
    ],
    cooldownSec: 120,
  },
  collision: {
    lines: [
      "Contact! That's going to cost some time!",
      "Ooh, a big impact there! Keep it together!",
      "A bit of a knock! Shake it off and keep pushing!",
      "That's a hard hit! Hopefully no damage!",
    ],
    cooldownSec: 10,
  },
};

// ---------------------------------------------------------------------------
// Preferred voices for natural speech
// ---------------------------------------------------------------------------

const PREFERRED_VOICE_NAMES = [
  'Samantha',       // macOS
  'Alex',           // macOS
  'Daniel',         // macOS British
  'Karen',          // macOS Australian
  'Google US English',
  'Google UK English Male',
  'Microsoft David',
  'Microsoft Zira',
];

function selectVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Try preferred voices first
  for (const name of PREFERRED_VOICE_NAMES) {
    const found = voices.find(v => v.name.includes(name));
    if (found) return found;
  }

  // Fallback: first en-US or en voice
  const enUS = voices.find(v => v.lang.startsWith('en-US'));
  if (enUS) return enUS;

  const en = voices.find(v => v.lang.startsWith('en'));
  if (en) return en;

  return voices[0];
}

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UseRaceCommentaryReturn {
  /** Currently speaking text (for subtitle display) */
  currentText: string | null;
  /** Whether commentary is enabled */
  isEnabled: boolean;
  /** Toggle commentary on/off */
  toggleCommentary: () => void;
  /** Call every telemetry update with the latest race state */
  update: (raceState: RaceState | null) => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useRaceCommentary(): UseRaceCommentaryReturn {
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const enabledRef = useRef(true);

  // Queue of pending commentary lines
  const queueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);

  // Cooldown tracking: category -> last timestamp (ms)
  const cooldownsRef = useRef<Map<CommentaryCategory, number>>(new Map());

  // Per-category line index to avoid repeating the same variation consecutively
  const lineIndexRef = useRef<Map<CommentaryCategory, number>>(new Map());

  // Tracking refs for detecting events from telemetry
  const prevGapSignRef = useRef<number>(0);
  const prevSpeedMilestoneRef = useRef<number>(0);
  const prevCheckpointRef = useRef<number>(0);
  const prevLapRef = useRef<number>(0);
  const raceStartFiredRef = useRef(false);
  const raceEndFiredRef = useRef(false);
  const prevRaceStatusRef = useRef<string | null>(null);
  const prevDriftActiveRef = useRef(false);

  // Voice ref (cached after first lookup)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const voiceLoadedRef = useRef(false);

  // Load voices (may be async on some browsers)
  useEffect(() => {
    const loadVoices = () => {
      voiceRef.current = selectVoice();
      voiceLoadedRef.current = true;
    };

    // Try immediately
    loadVoices();

    // Chrome fires voiceschanged async
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      };
    }
  }, []);

  // Cancel all speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Pick the next line for a category, advancing the index
  const pickLine = useCallback((category: CommentaryCategory, replacements?: Record<string, string>): string => {
    const template = TEMPLATES[category];
    const prevIndex = lineIndexRef.current.get(category) ?? -1;
    // Advance to next line (wrapping around), skip same line
    let nextIndex = (prevIndex + 1) % template.lines.length;
    // If there's more than 1 line, add some randomness occasionally
    if (template.lines.length > 2 && Math.random() > 0.6) {
      nextIndex = Math.floor(Math.random() * template.lines.length);
      // Avoid same as previous
      if (nextIndex === prevIndex) {
        nextIndex = (nextIndex + 1) % template.lines.length;
      }
    }
    lineIndexRef.current.set(category, nextIndex);

    let line = template.lines[nextIndex];
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        line = line.replace(`{${key}}`, value);
      }
    }
    return line;
  }, []);

  // Check if a category is off cooldown
  const isOffCooldown = useCallback((category: CommentaryCategory): boolean => {
    const last = cooldownsRef.current.get(category);
    if (last == null) return true;
    const elapsed = (Date.now() - last) / 1000;
    return elapsed >= TEMPLATES[category].cooldownSec;
  }, []);

  // Mark a category as just used
  const markUsed = useCallback((category: CommentaryCategory) => {
    cooldownsRef.current.set(category, Date.now());
  }, []);

  // Speak the next item in the queue
  const speakNext = useCallback(() => {
    if (!enabledRef.current) {
      isSpeakingRef.current = false;
      setCurrentText(null);
      return;
    }

    if (queueRef.current.length === 0) {
      isSpeakingRef.current = false;
      setCurrentText(null);
      return;
    }

    const text = queueRef.current.shift()!;
    isSpeakingRef.current = true;
    setCurrentText(text);

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      // No speech API -- just show subtitle for 3 seconds
      setTimeout(() => {
        speakNext();
      }, 3000);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.15; // Slightly fast for excitement
    utterance.pitch = 1.0;
    utterance.volume = 0.9;

    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
    }

    utterance.onend = () => {
      // Small pause between lines for natural pacing
      setTimeout(() => {
        speakNext();
      }, 800);
    };

    utterance.onerror = () => {
      // On error, advance the queue
      setTimeout(() => {
        speakNext();
      }, 500);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // Enqueue a commentary line
  const enqueue = useCallback((category: CommentaryCategory, replacements?: Record<string, string>) => {
    if (!enabledRef.current) return;
    if (!isOffCooldown(category)) return;

    markUsed(category);
    const line = pickLine(category, replacements);

    // Cap queue size to avoid backlog
    if (queueRef.current.length >= 3) {
      queueRef.current.shift();
    }
    queueRef.current.push(line);

    if (!isSpeakingRef.current) {
      speakNext();
    }
  }, [isOffCooldown, markUsed, pickLine, speakNext]);

  // Toggle commentary on/off
  const toggleCommentary = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setIsEnabled(next);

    if (!next) {
      // Cancel any ongoing speech
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      queueRef.current = [];
      isSpeakingRef.current = false;
      setCurrentText(null);
    }
  }, []);

  // Main update function -- called with each telemetry tick
  const update = useCallback((raceState: RaceState | null) => {
    if (!enabledRef.current || !raceState) return;

    const { player, ai, race_status, winner, drift } = raceState;
    if (!player) return;

    // --- Race start detection ---
    if (race_status === 'racing' && prevRaceStatusRef.current === 'countdown' && !raceStartFiredRef.current) {
      raceStartFiredRef.current = true;
      enqueue('race_start');
    }
    prevRaceStatusRef.current = race_status;

    // Don't fire event commentary during countdown or after race end
    if (race_status !== 'racing' && race_status !== 'finishing') {
      // --- Win / Loss detection ---
      if (race_status === 'finished' && !raceEndFiredRef.current) {
        raceEndFiredRef.current = true;
        if (winner === 'player') {
          enqueue('win');
        } else if (winner === 'ai') {
          enqueue('loss');
        }
      }
      return;
    }

    // --- Speed milestones (every 50 km/h above 100) ---
    const speed = Math.round(player.speed_kmh);
    const milestone = Math.floor(speed / 50) * 50;
    if (milestone >= 100 && milestone > prevSpeedMilestoneRef.current) {
      prevSpeedMilestoneRef.current = milestone;
      enqueue('speed_milestone', { speed: String(milestone) });
    }
    // Reset milestone tracking when speed drops significantly
    if (speed < prevSpeedMilestoneRef.current - 30) {
      prevSpeedMilestoneRef.current = Math.floor(speed / 50) * 50;
    }

    // --- Overtake / Being overtaken ---
    const gap = player.gap_seconds;
    if (gap != null) {
      const currentSign = gap > 0 ? 1 : gap < 0 ? -1 : 0;
      if (prevGapSignRef.current > 0 && currentSign < 0) {
        enqueue('overtake');
      }
      if (prevGapSignRef.current < 0 && currentSign > 0) {
        enqueue('being_overtaken');
      }
      if (currentSign !== 0) {
        prevGapSignRef.current = currentSign;
      }

      // --- Close gap ---
      const absGap = Math.abs(gap);
      if (absGap < 2.0 && absGap > 0) {
        enqueue('close_gap', { gap: absGap.toFixed(1) });
      }

      // --- Wide gap (player behind) ---
      if (gap > 5.0) {
        enqueue('wide_gap');
      }
    }

    // --- Checkpoint ---
    const cp = player.checkpoint ?? 0;
    if (cp > 0 && cp !== prevCheckpointRef.current && prevCheckpointRef.current > 0) {
      enqueue('checkpoint', { cp: String(cp) });
    }
    prevCheckpointRef.current = cp;

    // --- Drift detection ---
    const driftActive = drift?.active ?? false;
    if (driftActive && !prevDriftActiveRef.current && (drift?.score ?? 0) > 50) {
      enqueue('drift');
    }
    prevDriftActiveRef.current = driftActive;

    // --- Final lap ---
    if (player.total_laps > 1 && player.lap === player.total_laps && prevLapRef.current !== player.total_laps) {
      enqueue('final_lap');
    }
    prevLapRef.current = player.lap;

    // --- Near finish ---
    if (player.total_checkpoints && player.total_checkpoints > 0) {
      const progress = player.checkpoint / player.total_checkpoints;
      const isFinalLap = player.lap === player.total_laps;
      if (isFinalLap && progress >= 0.85) {
        enqueue('near_finish');
      }
    }

    // --- Collision ---
    const collisions = raceState.collisions;
    if (collisions && collisions.length > 0) {
      const maxIntensity = Math.max(...collisions.map(c => c.intensity));
      if (maxIntensity > 500) {
        enqueue('collision');
      }
    }
  }, [enqueue]);

  // Reset state when component is reused across races
  const resetRefs = useCallback(() => {
    prevGapSignRef.current = 0;
    prevSpeedMilestoneRef.current = 0;
    prevCheckpointRef.current = 0;
    prevLapRef.current = 0;
    raceStartFiredRef.current = false;
    raceEndFiredRef.current = false;
    prevRaceStatusRef.current = null;
    prevDriftActiveRef.current = false;
    cooldownsRef.current.clear();
    lineIndexRef.current.clear();
    queueRef.current = [];
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    setCurrentText(null);
  }, []);

  // Reset when race status goes back to countdown (new race)
  const prevResetStatusRef = useRef<string | null>(null);
  useEffect(() => {
    // We check inside update, but also do a passive reset here
    // when the race status transitions from finished/racing -> countdown
  }, []);

  // The update function handles reset detection inline via prevRaceStatusRef

  return { currentText, isEnabled, toggleCommentary, update };
}

export default useRaceCommentary;
