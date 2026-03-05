import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const VASTAI_API_KEY = process.env.VASTAI_API_KEY;
const VAST_API_BASE = 'https://console.vast.ai/api/v0';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { instance_id } = req.body || {};
  if (!instance_id) return res.status(400).json({ error: 'instance_id required' });
  if (!VASTAI_API_KEY) return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });

  try {
    const response = await fetch(`${VAST_API_BASE}/instances/${instance_id}/`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${VASTAI_API_KEY}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'Failed to destroy instance', details: errorText });
    }

    try { await kv.del(`gpu:${instance_id}`); } catch (e) { console.error('KV cleanup error:', e); }

    return res.status(200).json({ status: 'destroyed', instance_id });
  } catch (e) {
    console.error('[v3-stop] Error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' });
  }
}
