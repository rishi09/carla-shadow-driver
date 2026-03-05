import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * POST /api/gpu/race-complete
 *
 * Called by the race server when a race finishes. Records the result and
 * increments the global race counter.
 *
 * Body: {
 *   name: string,          - Player display name
 *   track: string,         - Track ID (e.g. "Town05")
 *   time: number,          - Player finish time in seconds
 *   beat_ai: boolean,      - Whether player beat the AI
 *   gap: number,           - Time gap in seconds (positive = player faster)
 *   difficulty: string,    - AI difficulty ("Easy", "Medium", "Hard")
 *   instance_id?: string   - Vast.ai instance ID (optional, for validation)
 * }
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, track, time, beat_ai, gap, difficulty } = req.body || {};

  // Validate required fields
  if (!track || time === undefined || beat_ai === undefined) {
    return res.status(400).json({ error: 'Missing required fields: track, time, beat_ai' });
  }

  try {
    const result: RaceResult = {
      name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 20) : 'Anonymous',
      track: String(track),
      time: Number(time),
      beat_ai: Boolean(beat_ai),
      gap: Number(gap) || 0,
      difficulty: String(difficulty || 'Easy'),
      timestamp: Date.now(),
    };

    // Increment total race counter
    await kv.incr('stats:total_races');

    // Push to recent races list (prepend so newest is first)
    await kv.lpush('stats:recent_races', result);

    // Trim to keep only last 50 results (we display 20 but keep extras)
    await kv.ltrim('stats:recent_races', 0, 49);

    return res.status(200).json({ status: 'ok', result });
  } catch (e) {
    console.error('[race-complete] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
