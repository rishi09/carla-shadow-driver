import { useState, useRef, useEffect, useCallback } from 'react';
import type { InputState } from '../../types/game';

/**
 * Props for the MobileControls component
 */
export interface MobileControlsProps {
  onInput: (input: InputState) => void;
  visible: boolean;
}

/**
 * Joystick position in normalized coordinates
 */
interface JoystickPosition {
  x: number; // -1 (left) to 1 (right)
  y: number; // -1 (up) to 1 (down)
}

/**
 * Configuration constants for touch controls
 */
const JOYSTICK_CONFIG = {
  baseSize: 120, // Outer circle diameter in pixels
  knobSize: 44, // Inner knob diameter (minimum touch target)
  deadzone: 0.15, // Ignore input below this threshold
  throttleThreshold: -0.3, // Y value below this triggers throttle
  brakeThreshold: 0.5, // Y value above this triggers brake
} as const;

/**
 * Clamps a value between a minimum and maximum
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Virtual joystick component
 */
function VirtualJoystick({
  onMove,
  onRelease,
}: {
  onMove: (pos: JoystickPosition) => void;
  onRelease: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const activeTouchId = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (activeTouchId.current !== null) return; // Already tracking a touch

    const touch = e.touches[0];
    activeTouchId.current = touch.identifier;
    setIsActive(true);

    handleTouchMove(e);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!baseRef.current || activeTouchId.current === null) return;

    // Find our tracked touch
    let touch: React.Touch | null = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === activeTouchId.current) {
        touch = e.touches[i];
        break;
      }
    }

    if (!touch) return;

    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = JOYSTICK_CONFIG.baseSize / 2 - JOYSTICK_CONFIG.knobSize / 2;

    // Calculate offset from center
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;

    // Calculate distance from center
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Clamp to circle
    if (distance > maxRadius) {
      const scale = maxRadius / distance;
      dx *= scale;
      dy *= scale;
    }

    // Normalize to -1 to 1
    const normalizedX = dx / maxRadius;
    const normalizedY = dy / maxRadius;

    // Apply deadzone
    const applyDeadzone = (value: number): number => {
      if (Math.abs(value) < JOYSTICK_CONFIG.deadzone) return 0;
      const sign = value > 0 ? 1 : -1;
      return sign * ((Math.abs(value) - JOYSTICK_CONFIG.deadzone) / (1 - JOYSTICK_CONFIG.deadzone));
    };

    const processedX = applyDeadzone(normalizedX);
    const processedY = applyDeadzone(normalizedY);

    // Update visual position (in pixels, relative to center)
    setKnobPos({ x: dx, y: dy });

    // Emit normalized values
    onMove({ x: processedX, y: processedY });
  }, [onMove]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Check if our tracked touch ended
    let found = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === activeTouchId.current) {
        found = true;
        break;
      }
    }

    if (!found) {
      activeTouchId.current = null;
      setIsActive(false);
      setKnobPos({ x: 0, y: 0 });
      onRelease();
    }
  }, [onRelease]);

  return (
    <div
      ref={baseRef}
      className={`
        relative rounded-full
        bg-dark-300/40 backdrop-blur-sm
        border-2 transition-all duration-150
        ${isActive
          ? 'border-human/60 shadow-[0_0_20px_rgba(76,175,80,0.3)]'
          : 'border-white/20'
        }
      `}
      style={{
        width: JOYSTICK_CONFIG.baseSize,
        height: JOYSTICK_CONFIG.baseSize,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Direction indicators */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Up arrow (throttle) */}
        <svg
          className={`absolute top-2 w-4 h-4 transition-colors ${
            isActive && knobPos.y < -10 ? 'text-human' : 'text-white/30'
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 4l-8 8h5v8h6v-8h5z" />
        </svg>

        {/* Down arrow (brake) */}
        <svg
          className={`absolute bottom-2 w-4 h-4 transition-colors ${
            isActive && knobPos.y > 10 ? 'text-warning' : 'text-white/30'
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 20l8-8h-5V4h-6v8H4z" />
        </svg>
      </div>

      {/* Joystick knob */}
      <div
        className={`
          absolute rounded-full
          bg-gradient-to-br from-white/20 to-white/5
          border transition-all duration-75
          ${isActive
            ? 'border-human bg-human/20 scale-110'
            : 'border-white/30'
          }
        `}
        style={{
          width: JOYSTICK_CONFIG.knobSize,
          height: JOYSTICK_CONFIG.knobSize,
          left: '50%',
          top: '50%',
          transform: `translate(calc(-50% + ${knobPos.x}px), calc(-50% + ${knobPos.y}px))`,
        }}
      />
    </div>
  );
}

/**
 * Brake button component
 */
function BrakeButton({
  onPress,
  onRelease,
}: {
  onPress: () => void;
  onRelease: () => void;
}) {
  const [isPressed, setIsPressed] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsPressed(true);
    onPress();
  }, [onPress]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsPressed(false);
    onRelease();
  }, [onRelease]);

  return (
    <div
      className={`
        flex items-center justify-center
        rounded-2xl
        backdrop-blur-sm
        border-2 transition-all duration-100
        select-none touch-none
        ${isPressed
          ? 'bg-warning/40 border-warning scale-95 shadow-[0_0_25px_rgba(239,68,68,0.5)]'
          : 'bg-dark-300/40 border-white/20 hover:border-warning/40'
        }
      `}
      style={{
        width: 100,
        height: 100,
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="flex flex-col items-center gap-1">
        {/* Brake icon */}
        <svg
          className={`w-8 h-8 transition-colors ${
            isPressed ? 'text-warning' : 'text-white/60'
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="8" width="18" height="12" rx="2" />
          <line x1="7" y1="12" x2="7" y2="16" />
          <line x1="12" y1="12" x2="12" y2="16" />
          <line x1="17" y1="12" x2="17" y2="16" />
          <line x1="6" y1="8" x2="6" y2="5" />
          <line x1="18" y1="8" x2="18" y2="5" />
        </svg>

        <span
          className={`text-xs font-bold uppercase tracking-wider transition-colors ${
            isPressed ? 'text-warning' : 'text-white/50'
          }`}
        >
          Brake
        </span>
      </div>
    </div>
  );
}

/**
 * MobileControls - Touch controls for mobile devices
 *
 * Features:
 * - Virtual joystick (left side): X-axis for steering, Y-axis for throttle/brake
 * - Dedicated brake button (right side): Quick braking access
 * - Glass-morphism styling consistent with GameHUD
 * - Responsive to touch with visual feedback
 * - Minimum 44px touch targets for accessibility
 *
 * Control mapping:
 * - Joystick up: Throttle (when Y < -0.3)
 * - Joystick down: Brake (when Y > 0.5)
 * - Joystick left/right: Steering (-1 to 1)
 * - Brake button: Immediate brake (overrides joystick)
 */
export function MobileControls({ onInput, visible }: MobileControlsProps) {
  const [joystickPos, setJoystickPos] = useState<JoystickPosition>({ x: 0, y: 0 });
  const [brakePressed, setBrakePressed] = useState(false);
  const lastInputRef = useRef<InputState | null>(null);

  // Convert joystick position + brake button to InputState
  useEffect(() => {
    const throttle = joystickPos.y < JOYSTICK_CONFIG.throttleThreshold;
    const brake = joystickPos.y > JOYSTICK_CONFIG.brakeThreshold || brakePressed;
    const steer = clamp(joystickPos.x, -1, 1);

    const newInput: InputState = { throttle, brake, steer };

    // Only emit if input changed
    const lastInput = lastInputRef.current;
    if (
      !lastInput ||
      lastInput.throttle !== newInput.throttle ||
      lastInput.brake !== newInput.brake ||
      Math.abs(lastInput.steer - newInput.steer) > 0.01
    ) {
      lastInputRef.current = newInput;
      onInput(newInput);
    }
  }, [joystickPos, brakePressed, onInput]);

  // Reset input when controls become hidden
  useEffect(() => {
    if (!visible) {
      const resetInput: InputState = { throttle: false, brake: false, steer: 0 };
      lastInputRef.current = resetInput;
      onInput(resetInput);
    }
  }, [visible, onInput]);

  const handleJoystickMove = useCallback((pos: JoystickPosition) => {
    setJoystickPos(pos);
  }, []);

  const handleJoystickRelease = useCallback(() => {
    setJoystickPos({ x: 0, y: 0 });
  }, []);

  const handleBrakePress = useCallback(() => {
    setBrakePressed(true);
  }, []);

  const handleBrakeRelease = useCallback(() => {
    setBrakePressed(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 pointer-events-auto select-none"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 20px)',
        touchAction: 'none',
      }}
    >
      {/* Control instruction hint (fades after first interaction) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-2">
        <div className="text-xs text-white/40 text-center whitespace-nowrap">
          Joystick: steer + throttle | Right: brake
        </div>
      </div>

      {/* Controls container */}
      <div className="flex justify-between items-end px-6 pb-6">
        {/* Left side: Joystick */}
        <div className="flex flex-col items-center gap-2">
          <VirtualJoystick
            onMove={handleJoystickMove}
            onRelease={handleJoystickRelease}
          />
          <span className="text-xs text-white/40 uppercase tracking-wider">
            Move
          </span>
        </div>

        {/* Right side: Brake button */}
        <div className="flex flex-col items-center gap-2">
          <BrakeButton
            onPress={handleBrakePress}
            onRelease={handleBrakeRelease}
          />
        </div>
      </div>

      {/* Debug overlay (uncomment for testing) */}
      {/* <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-white/60 font-mono bg-dark-400/80 px-2 py-1 rounded">
        X: {joystickPos.x.toFixed(2)} | Y: {joystickPos.y.toFixed(2)} | Brake: {brakePressed ? 'ON' : 'OFF'}
      </div> */}
    </div>
  );
}

export default MobileControls;
