/**
 * useImpactReplay.ts - Slow-motion replay effect on big collisions
 *
 * When a collision is detected, triggers a brief slow-motion effect:
 * - CSS scale zoom (1.0 -> 1.05 -> 1.0)
 * - CSS filter: contrast boost + slight desaturation
 * - Time dilation text overlay ("IMPACT!" with dramatic font)
 * - Duration: 800ms total (200ms zoom in, 400ms hold, 200ms zoom out)
 *
 * Wild Idea #39 from TODO.md
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';

// Animation timing constants (ms)
const PHASE_1_DURATION = 200;  // Zoom in
const PHASE_2_DURATION = 400;  // Hold with pulse
const PHASE_3_DURATION = 200;  // Zoom out
const TOTAL_DURATION = PHASE_1_DURATION + PHASE_2_DURATION + PHASE_3_DURATION;

// Impact text pools keyed by intensity bracket
const TEXT_LOW = ['BUMP!', 'OUCH!', 'BONK!'];
const TEXT_MID = ['IMPACT!', 'CRUNCH!', 'WHAM!'];
const TEXT_HIGH = ['WRECKED!', 'DESTROYED!', 'OBLITERATED!'];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickImpactText(intensity: number): string {
  if (intensity >= 0.9) return pickRandom(TEXT_HIGH);
  if (intensity >= 0.7) return pickRandom(TEXT_MID);
  return pickRandom(TEXT_LOW);
}

/** Ease-out cubic: decelerates toward end */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease-in cubic: accelerates from start */
function easeInCubic(t: number): number {
  return t * t * t;
}

interface UseImpactReplayOptions {
  enabled: boolean;
  cooldownMs?: number;
}

interface UseImpactReplayReturn {
  triggerImpact: (intensity: number) => void;
  isReplaying: boolean;
  replayStyle: CSSProperties;
  impactText: string | null;
  impactTextStyle: CSSProperties;
}

export function useImpactReplay(options: UseImpactReplayOptions): UseImpactReplayReturn {
  const { enabled, cooldownMs = 3000 } = options;

  const [isReplaying, setIsReplaying] = useState(false);
  const [replayStyle, setReplayStyle] = useState<CSSProperties>({});
  const [impactText, setImpactText] = useState<string | null>(null);
  const [impactTextStyle, setImpactTextStyle] = useState<CSSProperties>({});

  const rafRef = useRef<number | null>(null);
  const lastTriggerRef = useRef(0);
  const replayingRef = useRef(false);

  // Reset all visual state to defaults
  const resetState = useCallback(() => {
    setIsReplaying(false);
    setReplayStyle({});
    setImpactText(null);
    setImpactTextStyle({});
    replayingRef.current = false;
  }, []);

  const triggerImpact = useCallback((intensity: number) => {
    if (!enabled) return;
    if (intensity < 0.5) return;
    if (replayingRef.current) return;

    const now = performance.now();
    if (now - lastTriggerRef.current < cooldownMs) return;
    lastTriggerRef.current = now;

    replayingRef.current = true;
    setIsReplaying(true);

    const text = pickImpactText(intensity);
    setImpactText(text);

    const startTime = now;

    const animate = (timestamp: number) => {
      const elapsed = timestamp - startTime;

      if (elapsed >= TOTAL_DURATION) {
        resetState();
        return;
      }

      // --- Container style (scale + filter) ---
      let scale: number;
      let filterContrast: number;
      let filterSaturate: number;
      let filterBrightness: number;

      if (elapsed < PHASE_1_DURATION) {
        // Phase 1: zoom in
        const t = easeOutCubic(elapsed / PHASE_1_DURATION);
        scale = 1.0 + 0.05 * t;
        filterContrast = 1.0 + 0.3 * t;
        filterSaturate = 1.0 - 0.3 * t;
        filterBrightness = 1.0 + 0.1 * t;
      } else if (elapsed < PHASE_1_DURATION + PHASE_2_DURATION) {
        // Phase 2: hold with slight pulse
        const phaseElapsed = elapsed - PHASE_1_DURATION;
        const pulse = Math.sin((phaseElapsed / PHASE_2_DURATION) * Math.PI * 2) * 0.005;
        scale = 1.05 + pulse;
        filterContrast = 1.3;
        filterSaturate = 0.7;
        filterBrightness = 1.1;
      } else {
        // Phase 3: zoom out
        const phaseElapsed = elapsed - PHASE_1_DURATION - PHASE_2_DURATION;
        const t = easeInCubic(phaseElapsed / PHASE_3_DURATION);
        scale = 1.05 - 0.05 * t;
        filterContrast = 1.3 - 0.3 * t;
        filterSaturate = 0.7 + 0.3 * t;
        filterBrightness = 1.1 - 0.1 * t;
      }

      setReplayStyle({
        transform: `scale(${scale.toFixed(4)})`,
        filter: `contrast(${filterContrast.toFixed(2)}) saturate(${filterSaturate.toFixed(2)}) brightness(${filterBrightness.toFixed(2)})`,
        transformOrigin: 'center center',
        transition: 'none',
        willChange: 'transform, filter',
      });

      // --- Text style (scale + opacity animation) ---
      const textProgress = elapsed / TOTAL_DURATION;

      // Text scale: 2.0 -> 1.0 over first 30% of animation, then hold
      const textScaleProgress = Math.min(1, textProgress / 0.3);
      const textScale = 2.0 - 1.0 * easeOutCubic(textScaleProgress);

      // Text opacity: 0 -> 1 over first 15%, hold, then 1 -> 0 over last 25%
      let textOpacity: number;
      if (textProgress < 0.15) {
        textOpacity = textProgress / 0.15;
      } else if (textProgress > 0.75) {
        textOpacity = 1 - (textProgress - 0.75) / 0.25;
      } else {
        textOpacity = 1;
      }

      setImpactTextStyle({
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) scale(${textScale.toFixed(3)})`,
        fontSize: '3rem',
        fontWeight: 900,
        fontFamily: "'Impact', 'Arial Black', sans-serif",
        color: 'white',
        textShadow: '0 0 20px rgba(255, 50, 50, 0.8), 0 0 40px rgba(255, 0, 0, 0.5), 2px 2px 4px rgba(0, 0, 0, 0.9)',
        opacity: Math.max(0, Math.min(1, textOpacity)),
        letterSpacing: '0.1em',
        userSelect: 'none',
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'none',
        willChange: 'transform, opacity',
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [enabled, cooldownMs, resetState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return {
    triggerImpact,
    isReplaying,
    replayStyle,
    impactText,
    impactTextStyle,
  };
}

export default useImpactReplay;
