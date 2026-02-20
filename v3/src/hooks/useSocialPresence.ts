import { useState, useEffect, useCallback } from 'react';

interface RaceResult {
  name: string;
  track: string;
  time: number;
  beat_ai: boolean;
  gap: number;
  difficulty: string;
  timestamp: number;
}

interface SocialPresence {
  activePlayers: number;
  totalRaces: number;
  recentRaces: RaceResult[];
  loading: boolean;
  error: string | null;
}

const API_BASE = import.meta.env.DEV ? '' : '';

/**
 * Fetches social presence data (active players, total races, recent results)
 * from the /api/gpu/active endpoint. Polls every 30 seconds.
 */
export function useSocialPresence(): SocialPresence {
  const [data, setData] = useState<SocialPresence>({
    activePlayers: 0,
    totalRaces: 0,
    recentRaces: [],
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/gpu/active`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData({
        activePlayers: json.active_players ?? 0,
        totalRaces: json.total_races ?? 0,
        recentRaces: json.recent_races ?? [],
        loading: false,
        error: null,
      });
    } catch (e) {
      // On error, keep existing data but clear loading state
      setData((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to fetch',
      }));
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Poll every 30 seconds
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return data;
}
