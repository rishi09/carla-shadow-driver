/**
 * VoiceCommandHUD.tsx - Voice Command Visual Feedback Overlay
 *
 * Renders a small bottom-center HUD when voice commands are active:
 * - Microphone icon when listening
 * - Flashes the recognized command text with a color-coded glow
 * - Shows command hints on first enable (auto-dismisses after 5s)
 *
 * Color coding:
 *   - Green: "go" / throttle commands
 *   - Red: "brake" / stop commands
 *   - Blue: "left" / "right" steering commands
 *
 * All elements are pointer-events-none (non-interactive overlay).
 */
import { useState, useEffect, useRef } from 'react';
import type { VoiceCommandActiveEffects } from '../hooks/useVoiceCommands.ts';

interface VoiceCommandHUDProps {
  /** Whether SpeechRecognition is actively listening */
  isListening: boolean;
  /** Last recognized transcript text */
  transcript: string;
  /** Last recognized command word and timestamp */
  lastCommand: { word: string; timestamp: number } | null;
  /** Currently active effects for visual feedback */
  activeEffects: VoiceCommandActiveEffects;
  /** Toggle callback for the voice commands button */
  onToggle: () => void;
}

/** Map command words to display colors */
function getCommandColor(word: string): string {
  const w = word.toLowerCase();
  if (['go', 'faster', 'boost', 'nitro', 'speed'].includes(w)) return '#22c55e'; // green
  if (['brake', 'stop', 'slow'].includes(w)) return '#ef4444'; // red
  if (['left', 'right'].includes(w)) return '#3b82f6'; // blue
  if (['reset', 'respawn'].includes(w)) return '#f59e0b'; // amber
  if (['photo', 'screenshot'].includes(w)) return '#a855f7'; // purple
  return '#ffffff';
}

/** Map command words to display label */
function getCommandLabel(word: string): string {
  const w = word.toLowerCase();
  if (['go', 'faster', 'boost', 'nitro', 'speed'].includes(w)) return 'BOOST!';
  if (['brake', 'stop', 'slow'].includes(w)) return 'BRAKE!';
  if (w === 'left') return 'LEFT!';
  if (w === 'right') return 'RIGHT!';
  if (['reset', 'respawn'].includes(w)) return 'RESPAWN!';
  if (['photo', 'screenshot'].includes(w)) return 'PHOTO!';
  return word.toUpperCase();
}

export function VoiceCommandHUD({
  isListening,
  transcript,
  lastCommand,
  activeEffects,
  onToggle,
}: VoiceCommandHUDProps) {
  // Show hint text on first enable, then auto-dismiss after 5 seconds
  const [showHint, setShowHint] = useState(true);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasShownHintRef = useRef(false);

  // Animate command flash: re-key the animation on each new command
  const [flashCommand, setFlashCommand] = useState<{ word: string; color: string; label: string; key: number } | null>(null);
  const flashKeyRef = useRef(0);

  // Start hint timer when listening begins
  useEffect(() => {
    if (isListening && !hasShownHintRef.current) {
      hasShownHintRef.current = true;
      setShowHint(true);
      hintTimerRef.current = setTimeout(() => {
        setShowHint(false);
      }, 5000);
    }
    if (!isListening) {
      setShowHint(false);
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    }
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
      }
    };
  }, [isListening]);

  // Flash the recognized command when lastCommand changes
  useEffect(() => {
    if (!lastCommand) return;
    flashKeyRef.current += 1;
    setFlashCommand({
      word: lastCommand.word,
      color: getCommandColor(lastCommand.word),
      label: getCommandLabel(lastCommand.word),
      key: flashKeyRef.current,
    });
    // Clear flash after animation
    const timer = setTimeout(() => {
      setFlashCommand(null);
    }, 1200);
    return () => clearTimeout(timer);
  }, [lastCommand]);

  // Determine if any effect is active for the pulsing ring
  const anyEffectActive = activeEffects.throttleBoost || activeEffects.brakeAssist || activeEffects.steerLeft || activeEffects.steerRight;

  // Active effect glow color
  const activeGlowColor = activeEffects.throttleBoost
    ? 'rgba(34,197,94,0.4)'
    : activeEffects.brakeAssist
      ? 'rgba(239,68,68,0.4)'
      : activeEffects.steerLeft || activeEffects.steerRight
        ? 'rgba(59,130,246,0.4)'
        : 'transparent';

  return (
    <>
      {/* Voice command toggle button - positioned to the left of the voice boost mic button */}
      <button
        onClick={onToggle}
        className={`absolute bottom-24 right-28 z-10 pointer-events-auto backdrop-blur-sm rounded-lg px-3 py-2 text-sm border transition-all duration-200 ${
          isListening
            ? 'bg-emerald-500/30 border-emerald-400/40 text-emerald-300 hover:text-emerald-200 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
            : 'bg-black/60 border-white/10 text-white/60 hover:text-white'
        }`}
        title={isListening ? 'Disable Voice Commands' : 'Enable Voice Commands (say go, brake, left, right)'}
      >
        <div className="relative">
          {/* Chat/speech icon */}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            {/* Small sound waves inside the speech bubble */}
            {isListening && (
              <>
                <line x1="9" y1="10" x2="9" y2="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="15" y1="10" x2="15" y2="10" />
              </>
            )}
          </svg>
          {/* Pulsing ring when effect is active */}
          {anyEffectActive && (
            <div
              className="absolute -inset-1 rounded-full border-2"
              style={{
                borderColor: activeGlowColor,
                animation: 'voiceCommandPulse 0.6s ease-in-out infinite',
              }}
            />
          )}
        </div>
      </button>

      {/* Bottom-center HUD overlay */}
      {isListening && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[25] pointer-events-none flex flex-col items-center gap-2">

          {/* Command flash text */}
          {flashCommand && (
            <div
              key={flashCommand.key}
              className="text-center"
              style={{ animation: 'voiceCommandFlash 1.2s ease-out forwards' }}
            >
              <span
                className="text-2xl sm:text-3xl font-black tracking-wider uppercase"
                style={{
                  color: flashCommand.color,
                  textShadow: `0 0 20px ${flashCommand.color}, 0 0 40px ${flashCommand.color}80, 0 2px 6px rgba(0,0,0,0.8)`,
                }}
              >
                {flashCommand.label}
              </span>
            </div>
          )}

          {/* Listening indicator + transcript */}
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5 border border-white/10">
            {/* Mic icon with listening pulse */}
            <div className="relative flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={anyEffectActive ? 'text-emerald-400' : 'text-white/60'}
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              {/* Listening dots animation */}
              <div
                className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-emerald-400"
                style={{ animation: 'voiceCommandDot 1.5s ease-in-out infinite' }}
              />
            </div>

            {/* Transcript or hint text */}
            <span className="text-xs font-mono text-white/50 max-w-[200px] truncate">
              {transcript || (showHint ? 'Say: go, brake, left, right' : 'Listening...')}
            </span>
          </div>

          {/* Hint text (auto-dismisses after 5s) */}
          {showHint && !transcript && (
            <div
              className="text-[10px] text-white/30 font-mono tracking-wider"
              style={{ animation: 'voiceCommandHintFade 5s ease-out forwards' }}
            >
              Voice commands: go / brake / left / right / reset / photo
            </div>
          )}
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes voiceCommandFlash {
          0% { opacity: 0; transform: scale(0.5) translateY(10px); }
          12% { opacity: 1; transform: scale(1.15) translateY(0); }
          20% { transform: scale(1.0) translateY(0); }
          65% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.0) translateY(-15px); }
        }
        @keyframes voiceCommandPulse {
          0%, 100% { opacity: 0.5; transform: scale(1.0); }
          50% { opacity: 1.0; transform: scale(1.15); }
        }
        @keyframes voiceCommandDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes voiceCommandHintFade {
          0% { opacity: 0.6; }
          70% { opacity: 0.6; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
