import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * POST /api/leaderboard/submit
 *
 * Submit a race result with ghost data to the cloud leaderboard.
 *
 * Body: {
 *   track: string,
 *   laps: number,
 *   time: number,          // total race time in seconds
 *   bestLap: number,       // best single lap time
 *   playerName: string,
 *   difficulty: string,    // AI model/difficulty
 *   ghostData?: string,    // compressed ghost data (base64url encoded)
 * }
 *
 * Returns: { rank, totalEntries, isTop50, id }
 */

interface SubmitBody {
  track: string;
  laps: number;
  time: number;
  bestLap: number;
  playerName: string;
  difficulty: string;
  ghostData?: string;
}

interface LeaderboardMember {
  id: string;
  playerName: string;
  time: number;
  bestLap: number;
  difficulty: string;
  date: string;
  ghostId: string | null;
}

/** Max ghost data size: 100KB base64url encoded */
const MAX_GHOST_SIZE = 100_000;

/** Max entries to keep per track/lap combo */
const MAX_ENTRIES = 200;

/** TTL for ghost data: 90 days */
const GHOST_TTL_SECONDS = 90 * 24 * 60 * 60;

/** TTL for leaderboard entries: 90 days */
const LEADERBOARD_ENTRY_TTL_SECONDS = 90 * 24 * 60 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body as SubmitBody;

    // Validate required fields
    if (!body.track || typeof body.track !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid track' });
    }
    if (!body.laps || typeof body.laps !== 'number' || body.laps < 1 || body.laps > 20) {
      return res.status(400).json({ error: 'Missing or invalid laps' });
    }
    if (!body.time || typeof body.time !== 'number' || body.time <= 0 || body.time > 3600) {
      return res.status(400).json({ error: 'Missing or invalid time' });
    }
    if (!body.bestLap || typeof body.bestLap !== 'number' || body.bestLap <= 0) {
      return res.status(400).json({ error: 'Missing or invalid bestLap' });
    }
    if (!body.difficulty || typeof body.difficulty !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid difficulty' });
    }

    // Sanitize player name
    const playerName = (body.playerName || 'Anonymous').trim().substring(0, 30) || 'Anonymous';

    // Generate unique ID for this entry
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Store ghost data if provided (and within size limit)
    let ghostId: string | null = null;
    if (body.ghostData && typeof body.ghostData === 'string' && body.ghostData.length <= MAX_GHOST_SIZE) {
      ghostId = id;
      await kv.set(`ghost:${ghostId}`, body.ghostData, { ex: GHOST_TTL_SECONDS });
    }

    // Build leaderboard member data
    const member: LeaderboardMember = {
      id,
      playerName,
      time: body.time,
      bestLap: body.bestLap,
      difficulty: body.difficulty,
      date: new Date().toISOString(),
      ghostId,
    };

    // Store the entry metadata (keyed by id for lookup)
    const leaderboardKey = `leaderboard:${body.track}:${body.laps}`;
    const entryKey = `lb_entry:${id}`;
    await kv.set(entryKey, member, { ex: LEADERBOARD_ENTRY_TTL_SECONDS });

    // Add to sorted set (score = time in seconds * 1000 for ms precision)
    const score = Math.round(body.time * 1000);
    await kv.zadd(leaderboardKey, { score, member: id });

    // Trim the sorted set to keep only the top MAX_ENTRIES
    const totalEntries = await kv.zcard(leaderboardKey);
    if (totalEntries > MAX_ENTRIES) {
      // Remove entries beyond MAX_ENTRIES (worst times)
      await kv.zremrangebyrank(leaderboardKey, MAX_ENTRIES, -1);
    }

    // Get the rank of this entry (0-based, so add 1 for display)
    const rank0 = await kv.zrank(leaderboardKey, id);
    const rank = rank0 !== null ? rank0 + 1 : totalEntries;
    const isTop50 = rank <= 50;

    // Get current total after any trimming
    const finalTotal = Math.min(totalEntries, MAX_ENTRIES);

    return res.status(200).json({
      id,
      rank,
      totalEntries: finalTotal,
      isTop50,
      ghostId,
    });
  } catch (e) {
    console.error('[leaderboard/submit] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
