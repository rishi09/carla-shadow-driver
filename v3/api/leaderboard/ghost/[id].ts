import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * GET /api/leaderboard/ghost/[id]
 *
 * Get compressed ghost data by ID.
 *
 * Returns: { ghostData: string } (base64url encoded compressed ghost)
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache ghost data aggressively (immutable once written)
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id } = req.query;
    const ghostId = Array.isArray(id) ? id[0] : id;

    if (!ghostId) {
      return res.status(400).json({ error: 'Missing ghost ID' });
    }

    const ghostData = await kv.get<string>(`ghost:${ghostId}`);

    if (!ghostData) {
      return res.status(404).json({ error: 'Ghost not found or expired' });
    }

    return res.status(200).json({ ghostData });
  } catch (e) {
    console.error('[leaderboard/ghost] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
