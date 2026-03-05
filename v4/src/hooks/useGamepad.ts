/**
 * useGamepad.ts - Gamepad API support for Shadow Driver v3
 *
 * Polls navigator.getGamepads() in a requestAnimationFrame loop and maps
 * a standard gamepad layout to racing controls with analog precision.
 *
 * Mapping (Standard Gamepad):
 *   Left stick X (axes[0])  -> steering (-1 to 1, with deadzone)
 *   Right trigger (buttons[7]) -> throttle (0 to 1, analog)
 *   Left trigger (buttons[6])  -> brake (0 to 1, analog)
 *   A button (buttons[0])      -> handbrake (on/off)
 *   Y button (buttons[3])      -> respawn (rising edge)
 *   B button (buttons[1])      -> camera toggle (rising edge)
 *   Start button (buttons[9])  -> pause/menu (rising edge)
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const STICK_DEADZONE = 0.08;

export interface GamepadState {
  /** Whether a gamepad is connected */
  connected: boolean;
  /** Analog steering: -1 (full left) to 1 (full right), 0 = center */
  steering: number;
  /** Analog throttle: 0 (none) to 1 (full) */
  throttle: number;
  /** Analog brake: 0 (none) to 1 (full) */
  brake: number;
  /** Handbrake (A button) */
  handbrake: boolean;
  /** Respawn pressed this frame (Y button, rising edge) */
  respawn: boolean;
  /** Camera toggle pressed this frame (B button, rising edge) */
  cameraToggle: boolean;
  /** Start/pause pressed this frame (Start button, rising edge) */
  startButton: boolean;
  /** Name of the connected gamepad (for display) */
  gamepadName: string | null;
}

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  // Remap the remaining range so movement starts at 0 after deadzone
  const sign = value > 0 ? 1 : -1;
  return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
}

export function useGamepad(): GamepadState {
  const [connected, setConnected] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);

  // Store current analog values in a ref for rAF reads (avoids per-frame re-renders)
  const stateRef = useRef<GamepadState>({
    connected: false,
    steering: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    respawn: false,
    cameraToggle: false,
    startButton: false,
    gamepadName: null,
  });

  // Track previous button states for rising-edge detection
  const prevButtonsRef = useRef<{ respawn: boolean; cameraToggle: boolean; start: boolean }>({
    respawn: false,
    cameraToggle: false,
    start: false,
  });

  // Exposed state (updated at ~60Hz via rAF, but React state updated less often)
  const [state, setState] = useState<GamepadState>(stateRef.current);

  // Throttle React state updates to avoid excessive re-renders
  const lastUpdateRef = useRef(0);
  const UPDATE_INTERVAL = 16; // ~60Hz max for React state

  const rafRef = useRef<number | null>(null);

  const pollGamepad = useCallback(() => {
    const gamepads = navigator.getGamepads();
    let gp: Gamepad | null = null;

    // Find first connected standard gamepad
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i]!.connected) {
        gp = gamepads[i];
        break;
      }
    }

    if (!gp) {
      if (stateRef.current.connected) {
        stateRef.current = {
          connected: false,
          steering: 0,
          throttle: 0,
          brake: 0,
          handbrake: false,
          respawn: false,
          cameraToggle: false,
          startButton: false,
          gamepadName: null,
        };
        setState(stateRef.current);
        setConnected(false);
        setGamepadName(null);
      }
      rafRef.current = requestAnimationFrame(pollGamepad);
      return;
    }

    // Gamepad connected
    if (!stateRef.current.connected) {
      setConnected(true);
      setGamepadName(gp.id);
    }

    // Read axes
    const rawSteering = gp.axes[0] ?? 0;
    const steering = applyDeadzone(rawSteering, STICK_DEADZONE);

    // Read triggers (analog)
    const brake = gp.buttons[6]?.value ?? 0;
    const throttle = gp.buttons[7]?.value ?? 0;

    // Read buttons
    const handbrake = gp.buttons[0]?.pressed ?? false;
    const respawnRaw = gp.buttons[3]?.pressed ?? false;
    const cameraToggleRaw = gp.buttons[1]?.pressed ?? false;
    const startRaw = gp.buttons[9]?.pressed ?? false;

    // Rising-edge detection for one-shot actions
    const respawn = respawnRaw && !prevButtonsRef.current.respawn;
    const cameraToggle = cameraToggleRaw && !prevButtonsRef.current.cameraToggle;
    const startButton = startRaw && !prevButtonsRef.current.start;

    // Update previous button states
    prevButtonsRef.current = {
      respawn: respawnRaw,
      cameraToggle: cameraToggleRaw,
      start: startRaw,
    };

    stateRef.current = {
      connected: true,
      steering,
      throttle,
      brake,
      handbrake,
      respawn,
      cameraToggle,
      startButton,
      gamepadName: gp.id,
    };

    // Throttle React state updates
    const now = performance.now();
    if (now - lastUpdateRef.current >= UPDATE_INTERVAL) {
      lastUpdateRef.current = now;
      setState(stateRef.current);
    }

    rafRef.current = requestAnimationFrame(pollGamepad);
  }, []);

  useEffect(() => {
    // Listen for connect/disconnect events
    const handleConnected = (e: GamepadEvent) => {
      console.log(`[Gamepad] Connected: ${e.gamepad.id}`);
      setConnected(true);
      setGamepadName(e.gamepad.id);
    };

    const handleDisconnected = (e: GamepadEvent) => {
      console.log(`[Gamepad] Disconnected: ${e.gamepad.id}`);
      setConnected(false);
      setGamepadName(null);
      stateRef.current = {
        connected: false,
        steering: 0,
        throttle: 0,
        brake: 0,
        handbrake: false,
        respawn: false,
        cameraToggle: false,
        startButton: false,
        gamepadName: null,
      };
      setState(stateRef.current);
    };

    window.addEventListener('gamepadconnected', handleConnected);
    window.addEventListener('gamepaddisconnected', handleDisconnected);

    // Start polling loop
    rafRef.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnected);
      window.removeEventListener('gamepaddisconnected', handleDisconnected);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [pollGamepad]);

  return {
    ...state,
    connected,
    gamepadName,
  };
}

export default useGamepad;
