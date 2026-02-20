import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * GET /api/leaderboard/[track]
 *
 * Get leaderboard entries for a specific track.
 *
 * Query params:
 *   laps: number (required) - number of laps
 *   limit: number (optional, default 50, max 100) - number of entries to return
 *   offset: number (optional, default 0) - for pagination
 *
 * Returns: {
 *   entries: [{ rank, id, playerName, time, bestLap, difficulty, date, ghostId }],
 *   total: number,
 *   track: string,
 *   laps: number,
 * }
 */

interface LeaderboardMember {
  id: string;
  playerName: string;
  time: number;
  bestLap: number;
  difficulty: string;
  date: string;
  ghostId: string | null;
}

interface LeaderboardResponse {
  rank: number;
  id: string;
  playerName: string;
  time: number;
  bestLap: number;
  difficulty: string;
  date: string;
  ghostId: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache for 60 seconds to reduce KV reads
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { track } = req.query;
    const trackName = Array.isArray(track) ? track[0] : track;

    if (!trackName) {
      return res.status(400).json({ error: 'Missing track parameter' });
    }

    const lapsParam = Array.isArray(req.query.laps) ? req.query.laps[0] : req.query.laps;
    const laps = parseInt(lapsParam || '3', 10);
    if (isNaN(laps) || laps < 1 || laps > 20) {
      return res.status(400).json({ error: 'Invalid laps parameter' });
    }

    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '50', 10)));

    const offsetParam = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const offset = Math.max(0, parseInt(offsetParam || '0', 10));

    const leaderboardKey = `leaderboard:${trackName}:${laps}`;

    // Get total count
    const total = await kv.zcard(leaderboardKey);

    if (total === 0) {
      return res.status(200).json({
        entries: [],
        total: 0,
        track: trackName,
        laps,
      });
    }

    // Get member IDs sorted by score (time), ascending (fastest first)
    const memberIds = await kv.zrange(leaderboardKey, offset, offset + limit - 1) as string[];

    if (memberIds.length === 0) {
      return res.status(200).json({
        entries: [],
        total,
        track: trackName,
        laps,
      });
    }

    // Fetch all entry metadata in parallel
    const entryKeys = memberIds.map(id => `lb_entry:${id}`);
    const entriesRaw = await kv.mget<(LeaderboardMember | null)[]>(...entryKeys);

    // Build response entries with ranks
    const entries: LeaderboardResponse[] = [];
    for (let i = 0; i < memberIds.length; i++) {
      const entry = entriesRaw[i];
      if (entry) {
        entries.push({
          rank: offset + i + 1,
          id: entry.id,
          playerName: entry.playerName,
          time: entry.time,
          bestLap: entry.bestLap,
          difficulty: entry.difficulty,
          date: entry.date,
          ghostId: entry.ghostId,
        });
      } else {
        // Entry metadata expired but sorted set still has the ID.
        // Create a placeholder entry from the ID.
        entries.push({
          rank: offset + i + 1,
          id: memberIds[i],
          playerName: 'Unknown',
          time: 0,
          bestLap: 0,
          difficulty: 'unknown',
          date: '',
          ghostId: null,
        });
      }
    }

    return res.status(200).json({
      entries,
      total,
      track: trackName,
      laps,
    });
  } catch (e) {
    console.error('[leaderboard/track] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
