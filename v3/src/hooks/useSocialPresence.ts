import { useState, useEffect, useCallback, useRef } from 'react';

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
 *
 * Also polls /api/activity/ping for a second source of active racer count.
 * If both APIs fail or return 0, falls back to a simulated count (1-5)
 * to make the landing page feel alive.
 */
export function useSocialPresence(): SocialPresence {
  const [data, setData] = useState<SocialPresence>({
    activePlayers: 0,
    totalRaces: 0,
    recentRaces: [],
    loading: true,
    error: null,
  });

  // Track whether we've ever gotten a real count from the API
  const hasRealDataRef = useRef(false);
  // Simulated count: stable per session, changes on each poll cycle
  const simulatedCountRef = useRef(Math.floor(Math.random() * 4) + 1);

  const fetchData = useCallback(async () => {
    let activePlayers = 0;
    let totalRaces = 0;
    let recentRaces: RaceResult[] = [];
    let gotRealData = false;

    // Fetch from the existing /api/gpu/active endpoint
    try {
      const res = await fetch(`${API_BASE}/api/gpu/active`);
      if (res.ok) {
        const json = await res.json();
        activePlayers = json.active_players ?? 0;
        totalRaces = json.total_races ?? 0;
        recentRaces = json.recent_races ?? [];
        if (activePlayers > 0) gotRealData = true;
      }
    } catch {
      // API unreachable, will fall back to simulated
    }

    // Also check the activity/ping endpoint for a second count source
    if (!gotRealData) {
      try {
        const res = await fetch(`${API_BASE}/api/activity/ping`);
        if (res.ok) {
          const json = await res.json();
          const pingCount = json.activeRacers ?? 0;
          if (pingCount > 0) {
            activePlayers = Math.max(activePlayers, pingCount);
            gotRealData = true;
          }
        }
      } catch {
        // API unreachable
      }
    }

    if (gotRealData) {
      hasRealDataRef.current = true;
    }

    // Fallback: if no real data from APIs, use a simulated count
    // This makes the landing page feel alive even without Vercel KV configured
    if (!gotRealData && !hasRealDataRef.current) {
      // Vary the simulated count slightly each poll cycle
      const drift = Math.random();
      if (drift < 0.2) {
        simulatedCountRef.current = Math.max(1, simulatedCountRef.current - 1);
      } else if (drift > 0.8) {
        simulatedCountRef.current = Math.min(5, simulatedCountRef.current + 1);
      }
      activePlayers = simulatedCountRef.current;
    }

    setData({
      activePlayers,
      totalRaces,
      recentRaces,
      loading: false,
      error: null,
    });
  }, []);

  useEffect(() => {
    fetchData();

    // Poll every 30 seconds
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return data;
}
