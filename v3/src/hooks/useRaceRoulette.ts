/**
 * useRaceRoulette.ts - Random race configuration generator
 *
 * Spin the wheel for a completely random race setup.
 *
 * Wild Idea #12 from TODO.md
 */
import { useState, useCallback, useRef } from 'react';

interface RouletteResult {
  track: string;
  weather: string;
  laps: number;
  difficulty: string;
  modifier: string;
  seed: number;
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_TRACKS = ['Town01', 'Town02', 'Town03', 'Town04', 'Town05', 'Town06', 'Town07', 'Town10HD'];
const DEFAULT_WEATHERS = ['Clear', 'Cloudy', 'Rain', 'Heavy Rain', 'Fog', 'Night', 'Sunset', 'Storm'];
const DEFAULT_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const MODIFIERS = [
  'No modifier', 'No modifier', 'No modifier', 'No modifier',
  'Drunk AI', 'Blindfold Mode', 'Reverse Track', 'Floor is Lava',
  'Shrinking Track', 'Cargo Mode', 'Tag Mode', 'Musical Chairs',
];

interface UseRaceRouletteOptions {
  availableTracks?: string[];
  availableWeathers?: string[];
  availableDifficulties?: string[];
}

export function useRaceRoulette(options: UseRaceRouletteOptions = {}) {
  const tracks = options.availableTracks ?? DEFAULT_TRACKS;
  const weathers = options.availableWeathers ?? DEFAULT_WEATHERS;
  const difficulties = options.availableDifficulties ?? DEFAULT_DIFFICULTIES;

  const [lastResult, setLastResult] = useState<RouletteResult | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [history, setHistory] = useState<RouletteResult[]>([]);
  const spinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spin = useCallback(() => {
    if (isSpinning) return;
    setIsSpinning(true);

    const seed = Date.now();
    const rng = mulberry32(seed);

    const result: RouletteResult = {
      track: tracks[Math.floor(rng() * tracks.length)],
      weather: weathers[Math.floor(rng() * weathers.length)],
      laps: Math.floor(rng() * 5) + 1,
      difficulty: difficulties[Math.floor(rng() * difficulties.length)],
      modifier: MODIFIERS[Math.floor(rng() * MODIFIERS.length)],
      seed,
    };

    spinTimeout.current = setTimeout(() => {
      setLastResult(result);
      setHistory(prev => [result, ...prev].slice(0, 5));
      setIsSpinning(false);
    }, 2000);
  }, [isSpinning, tracks, weathers, difficulties]);

  const shareCode = lastResult ? btoa(String(lastResult.seed)) : null;

  return { spin, lastResult, isSpinning, history, shareCode };
}

export default useRaceRoulette;
