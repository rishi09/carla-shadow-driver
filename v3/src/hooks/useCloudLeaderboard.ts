/**
 * useCloudLeaderboard.ts - Cloud leaderboard using Vercel KV
 *
 * Submits race results to the cloud leaderboard and fetches rankings.
 * Falls back gracefully when the API is unavailable (e.g., KV not configured).
 */
import { useState, useCallback, useRef } from 'react';
import type { GhostFrame } from './useGhostRecorder.ts';

/** A single entry on the cloud leaderboard */
export interface CloudLeaderboardEntry {
  rank: number;
  id: string;
  playerName: string;
  time: number;
  bestLap: number;
  difficulty: string;
  date: string;
  ghostId: string | null;
}

/** Result from submitting to the cloud leaderboard */
export interface CloudSubmitResult {
  id: string;
  rank: number;
  totalEntries: number;
  isTop50: boolean;
  ghostId: string | null;
}

/** Cached leaderboard data */
interface CachedLeaderboard {
  entries: CloudLeaderboardEntry[];
  total: number;
  fetchedAt: number;
}

/** Submit payload */
interface SubmitPayload {
  track: string;
  laps: number;
  time: number;
  bestLap: number;
  playerName: string;
  difficulty: string;
  ghostData?: string;
}

/** Cache TTL: 60 seconds */
const CACHE_TTL_MS = 60_000;

/** API base path */
const API_BASE = '/api/leaderboard';

export interface UseCloudLeaderboardReturn {
  /** Submit a race result to the cloud leaderboard */
  submitResult: (
    payload: {
      track: string;
      laps: number;
      time: number;
      bestLap: number;
      playerName: string;
      difficulty: string;
    },
    ghostFrames?: GhostFrame[],
  ) => Promise<CloudSubmitResult | null>;

  /** Fetch the leaderboard for a track/lap combo */
  getLeaderboard: (track: string, laps: number, forceRefresh?: boolean) => Promise<{
    entries: CloudLeaderboardEntry[];
    total: number;
  } | null>;

  /** Fetch ghost data by ID for replay */
  getGhostData: (ghostId: string) => Promise<string | null>;

  /** Last submit result (for displaying rank after a race) */
  lastSubmitResult: CloudSubmitResult | null;

  /** Whether a submission is in progress */
  submitting: boolean;

  /** Whether a leaderboard fetch is in progress */
  loading: boolean;

  /** Last error message (null if no error) */
  error: string | null;
}

export function useCloudLeaderboard(): UseCloudLeaderboardReturn {
  const [lastSubmitResult, setLastSubmitResult] = useState<CloudSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-memory cache for leaderboard data (keyed by "track:laps")
  const cacheRef = useRef<Map<string, CachedLeaderboard>>(new Map());

  // In-memory cache for ghost data (keyed by ghost ID)
  const ghostCacheRef = useRef<Map<string, string>>(new Map());

  const submitResult = useCallback(async (
    payload: SubmitPayload,
    ghostFrames?: GhostFrame[],
  ): Promise<CloudSubmitResult | null> => {
    setSubmitting(true);
    setError(null);

    try {
      // Encode ghost data if frames are provided
      let ghostData: string | undefined;
      if (ghostFrames && ghostFrames.length > 0) {
        // Use the existing ghost encoding utility (dynamic import to avoid circular deps)
        const { encodeGhostForUrl } = await import('../utils/ghostUrl.ts');
        const encoded = await encodeGhostForUrl(ghostFrames);
        if (encoded) {
          ghostData = encoded;
        }
      }

      const response = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track: payload.track,
          laps: payload.laps,
          time: payload.time,
          bestLap: payload.bestLap,
          playerName: payload.playerName,
          difficulty: payload.difficulty,
          ghostData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json() as CloudSubmitResult;
      setLastSubmitResult(result);

      // Invalidate cache for this track/laps combo
      const cacheKey = `${payload.track}:${payload.laps}`;
      cacheRef.current.delete(cacheKey);

      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to submit result';
      setError(message);
      console.warn('[CloudLeaderboard] Submit failed:', message);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const getLeaderboard = useCallback(async (
    track: string,
    laps: number,
    forceRefresh = false,
  ): Promise<{ entries: CloudLeaderboardEntry[]; total: number } | null> => {
    const cacheKey = `${track}:${laps}`;

    // Check cache
    if (!forceRefresh) {
      const cached = cacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { entries: cached.entries, total: cached.total };
      }
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        laps: String(laps),
        limit: '50',
      });
      const response = await fetch(`${API_BASE}/${encodeURIComponent(track)}?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as {
        entries: CloudLeaderboardEntry[];
        total: number;
      };

      // Update cache
      cacheRef.current.set(cacheKey, {
        entries: data.entries,
        total: data.total,
        fetchedAt: Date.now(),
      });

      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch leaderboard';
      setError(message);
      console.warn('[CloudLeaderboard] Fetch failed:', message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getGhostData = useCallback(async (ghostId: string): Promise<string | null> => {
    // Check cache
    const cached = ghostCacheRef.current.get(ghostId);
    if (cached) return cached;

    try {
      const response = await fetch(`${API_BASE}/ghost/${encodeURIComponent(ghostId)}`);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { ghostData: string };

      // Cache the ghost data
      ghostCacheRef.current.set(ghostId, data.ghostData);

      return data.ghostData;
    } catch (e) {
      console.warn('[CloudLeaderboard] Ghost fetch failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }, []);

  return {
    submitResult,
    getLeaderboard,
    getGhostData,
    lastSubmitResult,
    submitting,
    loading,
    error,
  };
}
