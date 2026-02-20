/**
 * useBatteryDifficulty.ts - "Battery-Powered Difficulty"
 *
 * Fourth-wall breaking feature: reads the Battery Status API to display
 * battery-aware quips and a small HUD indicator.
 *
 * - Chrome/Edge only (Battery API not available on Firefox/Safari)
 * - Silently skips if API is unavailable
 * - Shows battery level indicator on HUD
 * - Generates quips during countdown
 * - Low battery (< 10%) sends difficulty reduction to server (future)
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export interface BatteryState {
  /** Battery level 0-1 (null if API unavailable) */
  level: number | null;
  /** Whether device is charging */
  charging: boolean;
  /** Whether the Battery API is available */
  isAvailable: boolean;
  /** Battery percentage as integer 0-100 (null if unavailable) */
  percent: number | null;
}

export interface UseBatteryDifficultyReturn {
  /** Current battery state */
  battery: BatteryState;
  /** Status message for HUD display (empty string if no message) */
  statusMessage: string;
}

// Extend Navigator to include getBattery() (Chrome/Edge specific)
interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  onchargingchange: (() => void) | null;
  onchargingtimechange: (() => void) | null;
  ondischargingtimechange: (() => void) | null;
  onlevelchange: (() => void) | null;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManager>;
}

export function useBatteryDifficulty(): UseBatteryDifficultyReturn {
  const [battery, setBattery] = useState<BatteryState>({
    level: null,
    charging: false,
    isAvailable: false,
    percent: null,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const batteryManagerRef = useRef<BatteryManager | null>(null);

  const updateBatteryState = useCallback((bm: BatteryManager) => {
    const level = bm.level;
    const charging = bm.charging;
    const percent = Math.round(level * 100);

    setBattery({
      level,
      charging,
      isAvailable: true,
      percent,
    });

    // Generate status message based on state
    if (level < 0.1 && !charging) {
      setStatusMessage('Low battery -- AI going easy');
    } else if (level < 0.2 && !charging) {
      setStatusMessage('Battery low');
    } else if (charging && level >= 0.95) {
      setStatusMessage('Full charge');
    } else if (charging) {
      setStatusMessage('Charging');
    } else {
      setStatusMessage('');
    }
  }, []);

  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) {
      // Battery API not available (Firefox, Safari, etc.) -- silently skip
      return;
    }

    let mounted = true;

    nav.getBattery().then((bm) => {
      if (!mounted) return;
      batteryManagerRef.current = bm;
      updateBatteryState(bm);

      // Listen for battery changes
      const handleChange = () => {
        if (mounted && batteryManagerRef.current) {
          updateBatteryState(batteryManagerRef.current);
        }
      };

      bm.addEventListener('chargingchange', handleChange);
      bm.addEventListener('levelchange', handleChange);

      // Store cleanup references
      bm.onchargingchange = handleChange;
      bm.onlevelchange = handleChange;
    }).catch(() => {
      // API rejected (e.g., permissions) -- silently skip
    });

    return () => {
      mounted = false;
      const bm = batteryManagerRef.current;
      if (bm) {
        bm.onchargingchange = null;
        bm.onlevelchange = null;
      }
    };
  }, [updateBatteryState]);

  return {
    battery,
    statusMessage,
  };
}
