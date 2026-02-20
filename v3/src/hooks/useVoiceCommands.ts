/**
 * useVoiceCommands.ts - Voice-Controlled Racing via Web Speech API
 *
 * Uses the browser's built-in SpeechRecognition API (Chrome/Edge) to recognize
 * spoken commands and translate them into racing inputs:
 *   - "go" / "faster" / "boost" / "nitro" -> temporary throttle boost (2s)
 *   - "brake" / "stop" / "slow"           -> temporary brake assist (1s)
 *   - "left"                              -> nudge steer left (0.5s)
 *   - "right"                             -> nudge steer right (0.5s)
 *   - "reset" / "respawn"                 -> trigger respawn callback
 *   - "photo" / "screenshot"              -> trigger photo mode callback
 *
 * Features:
 *   - Continuous recognition with interim results for responsiveness
 *   - 1-second cooldown per command category to prevent spam
 *   - Does NOT conflict with useVoiceBoost (which uses AnalyserNode for volume)
 *   - Graceful fallback: isSupported=false when SpeechRecognition is unavailable
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// --- Types for the Web Speech API (not in all TS libs) ---

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// --- Command definitions ---

type CommandCategory = 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'respawn' | 'photo';

interface CommandDef {
  words: string[];
  category: CommandCategory;
  /** Duration in ms that the effect stays active */
  duration: number;
}

const COMMAND_DEFS: CommandDef[] = [
  { words: ['go', 'faster', 'boost', 'nitro', 'speed'], category: 'throttle', duration: 2000 },
  { words: ['brake', 'stop', 'slow'], category: 'brake', duration: 1000 },
  { words: ['left'], category: 'steerLeft', duration: 500 },
  { words: ['right'], category: 'steerRight', duration: 500 },
  { words: ['reset', 'respawn'], category: 'respawn', duration: 0 },
  { words: ['photo', 'screenshot'], category: 'photo', duration: 0 },
];

/** Cooldown per category: ignore same category for this long after activation */
const COMMAND_COOLDOWN_MS = 1000;

export interface VoiceCommandActiveEffects {
  throttleBoost: boolean;
  brakeAssist: boolean;
  steerLeft: boolean;
  steerRight: boolean;
}

export interface VoiceCommandReturn {
  /** Whether SpeechRecognition is currently listening */
  isListening: boolean;
  /** Whether the browser supports SpeechRecognition */
  isSupported: boolean;
  /** Start listening for voice commands */
  start: () => void;
  /** Stop listening for voice commands */
  stop: () => void;
  /** Last recognized command word and timestamp */
  lastCommand: { word: string; timestamp: number } | null;
  /** Currently active racing effects from voice commands */
  activeEffects: VoiceCommandActiveEffects;
  /** Last recognized transcript text for HUD display */
  transcript: string;
}

/** Check if SpeechRecognition API is available */
function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.SpeechRecognition !== 'undefined') {
    return w.SpeechRecognition as unknown as SpeechRecognitionConstructor;
  }
  if (typeof w.webkitSpeechRecognition !== 'undefined') {
    return w.webkitSpeechRecognition as unknown as SpeechRecognitionConstructor;
  }
  return null;
}

export function useVoiceCommands(
  onRespawn?: () => void,
  onPhoto?: () => void,
): VoiceCommandReturn {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<{ word: string; timestamp: number } | null>(null);
  const [transcript, setTranscript] = useState('');
  const [activeEffects, setActiveEffects] = useState<VoiceCommandActiveEffects>({
    throttleBoost: false,
    brakeAssist: false,
    steerLeft: false,
    steerRight: false,
  });

  const isSupported = typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;

  // Refs for cleanup and state tracking
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListeningRef = useRef(false);
  const cooldownsRef = useRef<Record<string, number>>({});
  const effectTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const onRespawnRef = useRef(onRespawn);
  const onPhotoRef = useRef(onPhoto);

  // Keep callback refs up to date
  useEffect(() => {
    onRespawnRef.current = onRespawn;
    onPhotoRef.current = onPhoto;
  }, [onRespawn, onPhoto]);

  /**
   * Try to match a word in the transcript to a known command.
   * Returns the first matching CommandDef or null.
   */
  const matchCommand = useCallback((text: string): { def: CommandDef; word: string } | null => {
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      for (const def of COMMAND_DEFS) {
        if (def.words.includes(word)) {
          return { def, word };
        }
      }
    }
    return null;
  }, []);

  /**
   * Activate a command: set the active effect flag with an auto-clear timer,
   * respecting cooldowns.
   */
  const activateCommand = useCallback((def: CommandDef, word: string) => {
    const now = Date.now();
    const lastActivation = cooldownsRef.current[def.category] ?? 0;

    // Enforce cooldown
    if (now - lastActivation < COMMAND_COOLDOWN_MS) return;
    cooldownsRef.current[def.category] = now;

    // Update last command display
    setLastCommand({ word, timestamp: now });
    setTranscript(word);

    // Handle action commands (no duration, just fire callback)
    if (def.category === 'respawn') {
      onRespawnRef.current?.();
      return;
    }
    if (def.category === 'photo') {
      onPhotoRef.current?.();
      return;
    }

    // Map category to effect key
    const effectKey = {
      throttle: 'throttleBoost',
      brake: 'brakeAssist',
      steerLeft: 'steerLeft',
      steerRight: 'steerRight',
    }[def.category] as keyof VoiceCommandActiveEffects;

    // Clear any existing timer for this effect
    if (effectTimersRef.current[effectKey]) {
      clearTimeout(effectTimersRef.current[effectKey]);
    }

    // Set the effect flag
    setActiveEffects(prev => ({ ...prev, [effectKey]: true }));

    // Auto-clear after duration
    effectTimersRef.current[effectKey] = setTimeout(() => {
      setActiveEffects(prev => ({ ...prev, [effectKey]: false }));
      delete effectTimersRef.current[effectKey];
    }, def.duration);
  }, []);

  /**
   * Start SpeechRecognition with continuous mode and interim results.
   */
  const start = useCallback(() => {
    if (!isSupported) return;
    if (wantListeningRef.current) return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    wantListeningRef.current = true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Process results starting from the latest
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();

        // Update transcript display
        setTranscript(text);

        // Try to match a command (process both interim and final for speed)
        const match = matchCommand(text);
        if (match) {
          activateCommand(match.def, match.word);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[VoiceCommands] SpeechRecognition error:', event.error, event.message);
      // 'no-speech' and 'aborted' are normal - don't stop listening
      if (event.error === 'not-allowed') {
        wantListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if we still want to listen (SpeechRecognition stops periodically)
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started or browser blocked - ignore
        }
      } else {
        setIsListening(false);
      }
    };

    try {
      recognition.start();
    } catch {
      console.warn('[VoiceCommands] Failed to start SpeechRecognition');
      wantListeningRef.current = false;
    }

    recognitionRef.current = recognition;
  }, [isSupported, matchCommand, activateCommand]);

  /**
   * Stop SpeechRecognition and clear all active effects.
   */
  const stop = useCallback(() => {
    wantListeningRef.current = false;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }

    setIsListening(false);
    setTranscript('');
    setActiveEffects({
      throttleBoost: false,
      brakeAssist: false,
      steerLeft: false,
      steerRight: false,
    });

    // Clear all effect timers
    for (const key of Object.keys(effectTimersRef.current)) {
      clearTimeout(effectTimersRef.current[key]);
    }
    effectTimersRef.current = {};
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ok
        }
        recognitionRef.current = null;
      }
      for (const key of Object.keys(effectTimersRef.current)) {
        clearTimeout(effectTimersRef.current[key]);
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    start,
    stop,
    lastCommand,
    activeEffects,
    transcript,
  };
}

export default useVoiceCommands;
