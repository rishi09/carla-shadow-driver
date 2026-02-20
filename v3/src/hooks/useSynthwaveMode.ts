/**
 * useSynthwaveMode.ts - Synthwave / Outrun aesthetic toggle
 *
 * Simple on/off toggle that controls the synthwave aesthetic mode.
 * When enabled:
 * - Adds CSS class "synthwave" to the racing container
 * - Injects global style overrides for neon HUD text
 * - Returns a CSS filter string for the video feed (boosted contrast, saturation, hue shift)
 * - SynthwaveOverlay component renders CRT scanlines, grid floor, neon border, VHS glitch
 *
 * State persists in localStorage across sessions.
 */
import { useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'shadow_driver_synthwave_mode';

export interface UseSynthwaveModeReturn {
  /** Whether synthwave mode is currently active */
  enabled: boolean;
  /** Toggle synthwave mode on/off */
  toggle: () => void;
  /** CSS class name to add to the game container when synthwave mode is active */
  containerClass: string;
  /** CSS filter string to apply to the video container */
  videoFilter: string;
}

export function useSynthwaveMode(): UseSynthwaveModeReturn {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Inject global neon HUD styles when enabled
  useEffect(() => {
    if (!enabled) {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
      return;
    }

    const style = document.createElement('style');
    style.setAttribute('data-synthwave', 'true');
    style.textContent = `
      /* Synthwave neon HUD text overrides */
      .synthwave .font-mono {
        color: #ff00ff !important;
        text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ffaa !important;
        font-family: 'Courier New', 'Consolas', monospace !important;
      }

      .synthwave [data-hud] {
        text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #00ffff !important;
      }

      /* Speed text: neon magenta glow */
      .synthwave [data-hud-speed] {
        color: #ff00ff !important;
        text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ffaa !important;
        font-family: 'Courier New', 'Consolas', monospace !important;
      }

      /* Gap timer: cyan glow */
      .synthwave [data-hud-gap] {
        color: #00ffff !important;
        text-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff !important;
        font-family: 'Courier New', 'Consolas', monospace !important;
      }

      /* General HUD text: subtle magenta glow */
      .synthwave .text-white,
      .synthwave .text-white\\/60,
      .synthwave .text-white\\/80 {
        text-shadow: 0 0 6px rgba(255, 0, 255, 0.3);
      }

      /* Green accent -> cyan neon */
      .synthwave .text-green-400,
      .synthwave .text-accent {
        color: #00ffff !important;
        text-shadow: 0 0 8px #00ffff, 0 0 16px #00ffffaa !important;
      }

      /* Red/amber accent -> hot pink neon */
      .synthwave .text-red-400,
      .synthwave .text-amber-400 {
        color: #ff1493 !important;
        text-shadow: 0 0 8px #ff1493, 0 0 16px #ff149388 !important;
      }

      /* Border glow: faint magenta */
      .synthwave .border-white\\/10,
      .synthwave .border-white\\/20 {
        border-color: rgba(255, 0, 255, 0.15) !important;
      }

      /* Dark purple tint on background panels */
      .synthwave .bg-black\\/60 {
        background-color: rgba(20, 0, 40, 0.7) !important;
      }
    `;
    document.head.appendChild(style);
    styleRef.current = style;

    return () => {
      style.remove();
      styleRef.current = null;
    };
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  return {
    enabled,
    toggle,
    containerClass: enabled ? 'synthwave' : '',
    videoFilter: enabled ? 'contrast(1.3) saturate(1.5) hue-rotate(-10deg)' : '',
  };
}
