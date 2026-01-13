import { useState, useEffect } from 'react';
import { Button } from '../common/Button';

interface ControlsHintProps {
  /** Whether to show the controls hint overlay */
  visible: boolean;
  /** Callback when user dismisses the hint */
  onDismiss: () => void;
  /** Auto-hide after this many seconds (0 = never auto-hide) */
  autoHideSeconds?: number;
  /** Whether this is the first race for the user */
  isFirstRace?: boolean;
}

/**
 * ControlsHint - Shows keyboard/touch controls overlay
 *
 * Designed for accessibility:
 * - Large, clear icons for keys
 * - Simple language for non-native English speakers
 * - High contrast colors
 * - Fades out gradually after countdown
 * - "Got it" button to dismiss early
 *
 * Shows during countdown and first 10 seconds of race.
 */
export function ControlsHint({
  visible,
  onDismiss,
  autoHideSeconds = 10,
  isFirstRace = true,
}: ControlsHintProps) {
  const [opacity, setOpacity] = useState(1);
  const [shouldRender, setShouldRender] = useState(visible);

  // Handle visibility changes
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setOpacity(1);
    }
  }, [visible]);

  // Auto-hide timer
  useEffect(() => {
    if (!visible || autoHideSeconds === 0) return;

    const startFadeAt = (autoHideSeconds - 2) * 1000; // Start fading 2 seconds before
    const hideAt = autoHideSeconds * 1000;

    const fadeTimer = setTimeout(() => {
      setOpacity(0);
    }, startFadeAt);

    const hideTimer = setTimeout(() => {
      setShouldRender(false);
      onDismiss();
    }, hideAt);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [visible, autoHideSeconds, onDismiss]);

  if (!shouldRender) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-40 flex items-end justify-center pb-32"
      style={{
        opacity,
        transition: 'opacity 2s ease-out',
      }}
    >
      <div className="pointer-events-auto bg-dark-300/95 backdrop-blur-md border border-white/20 rounded-xl p-6 max-w-lg mx-4 shadow-xl">
        {/* Header */}
        <div className="text-center mb-4">
          <h3 className="text-xl font-bold text-white mb-1">
            {isFirstRace ? 'How to Drive' : 'Controls Reminder'}
          </h3>
          <p className="text-base text-white/60">
            Use these keys to control your car
          </p>
        </div>

        {/* Keyboard Controls */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* WASD / Arrow Keys Section */}
          <div className="flex flex-col items-center">
            <div className="text-sm text-white/50 mb-3 uppercase tracking-wide">
              Movement
            </div>

            {/* W / Up Key */}
            <div className="flex flex-col items-center gap-2 mb-2">
              <KeyDisplay keys={['W', '(Up Arrow)']} />
              <span className="text-base text-human font-medium">Go Forward</span>
            </div>

            {/* A/D or Left/Right */}
            <div className="flex items-center gap-4 mb-2">
              <div className="flex flex-col items-center gap-1">
                <KeyDisplay keys={['A', '(Left Arrow)']} />
                <span className="text-sm text-white/70">Turn Left</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <KeyDisplay keys={['D', '(Right Arrow)']} />
                <span className="text-sm text-white/70">Turn Right</span>
              </div>
            </div>

            {/* S / Down Key */}
            <div className="flex flex-col items-center gap-2">
              <KeyDisplay keys={['S', '(Down Arrow)']} />
              <span className="text-base text-warning font-medium">Slow Down / Reverse</span>
            </div>
          </div>

          {/* Tips Section */}
          <div className="flex flex-col">
            <div className="text-sm text-white/50 mb-3 uppercase tracking-wide text-center">
              Tips
            </div>
            <ul className="space-y-3 text-base">
              <li className="flex items-start gap-2">
                <span className="text-human text-lg">*</span>
                <span className="text-white/80">
                  <strong className="text-white">Hold W</strong> to go fast
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent text-lg">*</span>
                <span className="text-white/80">
                  <strong className="text-white">Slow down</strong> before turns
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-warning text-lg">*</span>
                <span className="text-white/80">
                  <strong className="text-white">Stay on track</strong> - going off road slows you down!
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-ai text-lg">*</span>
                <span className="text-white/80">
                  Complete <strong className="text-white">3 laps</strong> to finish
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Dismiss Button */}
        <div className="flex justify-center">
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setOpacity(0);
              setTimeout(() => {
                setShouldRender(false);
                onDismiss();
              }, 300);
            }}
            className="min-w-[150px]"
          >
            Got It!
          </Button>
        </div>

        {/* Auto-hide hint */}
        {autoHideSeconds > 0 && (
          <p className="text-center text-sm text-white/40 mt-3">
            This message will fade away automatically
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Individual key display component
 */
function KeyDisplay({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 && <span className="text-white/30 mx-1">or</span>}
          <kbd
            className={`
              inline-flex items-center justify-center
              min-w-[40px] h-10 px-3
              bg-dark-400 border-2 border-white/30
              rounded-lg text-white font-bold text-base
              shadow-[0_2px_0_0_rgba(255,255,255,0.2)]
              ${key.includes('Arrow') ? 'text-sm' : ''}
            `}
          >
            {key}
          </kbd>
        </span>
      ))}
    </div>
  );
}

export default ControlsHint;
