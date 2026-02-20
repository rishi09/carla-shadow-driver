/**
 * useSpeedrunInternet.ts - Race to load websites faster
 *
 * Checkpoints on the map represent websites. Reaching a checkpoint
 * triggers a real fetch() to that website. Your "load time" is
 * driving time + actual network latency. Absurd racing meets internet speed test.
 *
 * Wild Idea #48 from TODO.md
 */
import { useState, useCallback, useRef, useEffect } from 'react';

// --- Types ---

export interface WebCheckpoint {
  id: string;
  url: string;
  label: string;
  position: { x: number; y: number };
  reached: boolean;
  driveTimeMs: number | null;
  fetchTimeMs: number | null;
  totalTimeMs: number | null;
  status: 'pending' | 'driving' | 'loading' | 'loaded' | 'error';
}

export interface UseSpeedrunInternetOptions {
  enabled: boolean;
  playerPosition: { x: number; y: number } | null;
  isRacing: boolean;
}

export interface UseSpeedrunInternetReturn {
  checkpoints: WebCheckpoint[];
  activeCheckpoint: WebCheckpoint | null;
  completedCount: number;
  totalTime: number;
  isLoading: boolean;
  loadingUrl: string | null;
  networkSpeed: 'fast' | 'medium' | 'slow';
  isComplete: boolean;
}

// --- Constants ---

const CHECKPOINT_REACH_DISTANCE = 20;
const FETCH_TIMEOUT_MS = 10_000;
const ERROR_PENALTY_MS = 5_000;

const DEFAULT_CHECKPOINTS: Omit<WebCheckpoint, 'reached' | 'driveTimeMs' | 'fetchTimeMs' | 'totalTimeMs' | 'status'>[] = [
  { id: 'google',         label: 'Google',         url: 'https://www.google.com/generate_204', position: { x: 50, y: 0 } },
  { id: 'github',         label: 'GitHub',         url: 'https://github.com',                  position: { x: -60, y: 80 } },
  { id: 'wikipedia',      label: 'Wikipedia',      url: 'https://en.wikipedia.org/wiki/Main_Page', position: { x: 100, y: -50 } },
  { id: 'reddit',         label: 'Reddit',         url: 'https://www.reddit.com',              position: { x: -100, y: -80 } },
  { id: 'stackoverflow',  label: 'Stack Overflow', url: 'https://stackoverflow.com',           position: { x: 0, y: 120 } },
];

// --- Helpers ---

function createInitialCheckpoints(): WebCheckpoint[] {
  return DEFAULT_CHECKPOINTS.map((cp) => ({
    ...cp,
    reached: false,
    driveTimeMs: null,
    fetchTimeMs: null,
    totalTimeMs: null,
    status: 'pending' as const,
  }));
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function classifyNetworkSpeed(avgFetchMs: number): 'fast' | 'medium' | 'slow' {
  if (avgFetchMs < 200) return 'fast';
  if (avgFetchMs < 500) return 'medium';
  return 'slow';
}

// --- Hook ---

export function useSpeedrunInternet(options: UseSpeedrunInternetOptions): UseSpeedrunInternetReturn {
  const { enabled, playerPosition, isRacing } = options;

  const [checkpoints, setCheckpoints] = useState<WebCheckpoint[]>(createInitialCheckpoints);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  // Refs for timing and cleanup
  const driveStartRef = useRef<number>(performance.now());
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Reset state when enabled transitions to true or racing starts
  useEffect(() => {
    if (enabled && isRacing) {
      setCheckpoints(createInitialCheckpoints());
      setActiveIndex(0);
      setIsLoading(false);
      setLoadingUrl(null);
      driveStartRef.current = performance.now();
    }
  }, [enabled, isRacing]);

  // Track mount status for safe async state updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight fetch on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Mark the current checkpoint as "driving" when activeIndex advances
  useEffect(() => {
    if (!enabled || !isRacing) return;
    setCheckpoints((prev) => {
      if (activeIndex >= prev.length) return prev;
      if (prev[activeIndex].status !== 'pending') return prev;
      const next = [...prev];
      next[activeIndex] = { ...next[activeIndex], status: 'driving' };
      return next;
    });
    driveStartRef.current = performance.now();
  }, [activeIndex, enabled, isRacing]);

  // Fetch a website and measure round-trip time
  const fetchCheckpoint = useCallback(async (checkpoint: WebCheckpoint, driveTimeMs: number, index: number) => {
    if (!isMountedRef.current) return;

    // Abort any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    setIsLoading(true);
    setLoadingUrl(checkpoint.url);

    // Update checkpoint status to loading
    setCheckpoints((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], status: 'loading', driveTimeMs };
      return next;
    });

    const fetchStart = performance.now();
    let fetchTimeMs: number;
    let status: 'loaded' | 'error';

    try {
      await fetch(checkpoint.url, {
        mode: 'no-cors',
        signal: controller.signal,
      });
      fetchTimeMs = performance.now() - fetchStart;
      status = 'loaded';
    } catch {
      // Fetch failed or was aborted -- apply penalty
      fetchTimeMs = ERROR_PENALTY_MS;
      status = 'error';
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
    }

    if (!isMountedRef.current) return;

    const totalTimeMs = driveTimeMs + fetchTimeMs;

    // Update checkpoint with results
    setCheckpoints((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        reached: true,
        driveTimeMs,
        fetchTimeMs,
        totalTimeMs,
        status,
      };
      return next;
    });

    setIsLoading(false);
    setLoadingUrl(null);

    // Advance to next checkpoint
    setActiveIndex((prev) => prev + 1);
  }, []);

  // Check proximity to current checkpoint each time playerPosition changes
  useEffect(() => {
    if (!enabled || !isRacing || !playerPosition || isLoading) return;
    if (activeIndex >= checkpoints.length) return;

    const current = checkpoints[activeIndex];
    if (current.reached || current.status === 'loading') return;

    const dist = distanceBetween(playerPosition, current.position);
    if (dist <= CHECKPOINT_REACH_DISTANCE) {
      const driveTimeMs = performance.now() - driveStartRef.current;
      void fetchCheckpoint(current, driveTimeMs, activeIndex);
    }
  }, [enabled, isRacing, playerPosition, isLoading, activeIndex, checkpoints, fetchCheckpoint]);

  // --- Derived values ---

  const activeCheckpoint = activeIndex < checkpoints.length ? checkpoints[activeIndex] : null;
  const completedCount = checkpoints.filter((cp) => cp.reached).length;
  const isComplete = completedCount === checkpoints.length;

  const totalTime = checkpoints.reduce((sum, cp) => sum + (cp.totalTimeMs ?? 0), 0);

  // Compute network speed from average fetch time of completed checkpoints
  const completedFetches = checkpoints.filter((cp) => cp.fetchTimeMs !== null && cp.status === 'loaded');
  const avgFetchMs = completedFetches.length > 0
    ? completedFetches.reduce((sum, cp) => sum + (cp.fetchTimeMs ?? 0), 0) / completedFetches.length
    : 0;
  const networkSpeed = completedFetches.length > 0 ? classifyNetworkSpeed(avgFetchMs) : 'medium';

  return {
    checkpoints,
    activeCheckpoint,
    completedCount,
    totalTime,
    isLoading,
    loadingUrl,
    networkSpeed,
    isComplete,
  };
}

export default useSpeedrunInternet;
