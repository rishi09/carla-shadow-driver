import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

/**
 * /api/activity/ping
 *
 * POST: Record an activity ping for a racing instance. Sets a KV key
 *       with a 60-second TTL so it auto-expires.
 *       Body: { instanceId: string }
 *
 * GET:  Count active pings (non-expired KV entries) and return the
 *       current number of active racers.
 *       Response: { activeRacers: number, lastUpdated: string }
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { instanceId } = req.body || {};
      if (!instanceId) {
        return res.status(400).json({ error: 'instanceId required' });
      }

      // Store a ping with a 60-second TTL -- auto-expires if not refreshed
      const key = `activity:ping:${instanceId}`;
      await kv.set(key, { ts: Date.now() }, { ex: 60 });

      return res.status(200).json({ status: 'ok' });
    } catch (e) {
      console.error('[activity/ping] POST error:', e);
      return res.status(500).json({
        error: e instanceof Error ? e.message : 'Internal server error',
      });
    }
  }

  if (req.method === 'GET') {
    // Cache for 10 seconds to reduce KV reads on high traffic
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

    try {
      // Count active pings by scanning keys with the activity:ping: prefix
      // Only non-expired keys will be returned (TTL handles cleanup)
      let activeRacers = 0;
      try {
        const keys = await kv.keys('activity:ping:*');
        activeRacers = keys.length;
      } catch {
        // KV may not be set up or may not have any keys yet
        activeRacers = 0;
      }

      // Also check session keys from the existing callback-based tracking
      // as a secondary source of truth
      try {
        const sessionKeys = await kv.keys('session:*');
        // Use the higher of the two counts
        activeRacers = Math.max(activeRacers, sessionKeys.length);
      } catch {
        // ignore
      }

      return res.status(200).json({
        activeRacers,
        lastUpdated: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[activity/ping] GET error:', e);
      return res.status(500).json({
        error: e instanceof Error ? e.message : 'Internal server error',
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
