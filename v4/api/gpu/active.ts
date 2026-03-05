import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * GET /api/gpu/active
 *
 * Returns social presence data:
 *   - active_players: number of players currently connected (sessions with TTL)
 *   - total_races: all-time race completions
 *   - recent_races: array of last 20 race results
 */

interface RaceResult {
  name: string;
  track: string;
  time: number;
  beat_ai: boolean;
  gap: number;
  difficulty: string;
  timestamp: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache for 15 seconds to reduce KV reads
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Count active sessions: each session key has a 5-minute TTL
    // Keys are stored as "session:<instance_id>:<connection_id>"
    let activePlayers = 0;
    try {
      const sessionKeys = await kv.keys('session:*');
      activePlayers = sessionKeys.length;
    } catch {
      // KV may not have any session keys yet
      activePlayers = 0;
    }

    // Get total race count
    let totalRaces = 0;
    try {
      const count = await kv.get<number>('stats:total_races');
      totalRaces = count ?? 0;
    } catch {
      totalRaces = 0;
    }

    // Get recent race results (stored as a list)
    let recentRaces: RaceResult[] = [];
    try {
      const results = await kv.lrange<RaceResult>('stats:recent_races', 0, 19);
      recentRaces = results ?? [];
    } catch {
      recentRaces = [];
    }

    return res.status(200).json({
      active_players: activePlayers,
      total_races: totalRaces,
      recent_races: recentRaces,
    });
  } catch (e) {
    console.error('[active] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
