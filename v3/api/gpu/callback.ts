import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

interface CallbackData {
  tunnel_url?: string;
  status?: string;
  message?: string;
  ready?: boolean;
  last_update?: number;
}

async function getData(instanceId: string): Promise<CallbackData | null> {
  try {
    return await kv.get<CallbackData>(`gpu:${instanceId}`);
  } catch (e) {
    console.error('KV get error:', e);
    return null;
  }
}

async function setData(instanceId: string, data: CallbackData): Promise<void> {
  try {
    await kv.set(`gpu:${instanceId}`, data, { ex: 3600 });
  } catch (e) {
    console.error('KV set error:', e);
  }
}

async function getAllData(): Promise<Record<string, CallbackData | null>> {
  try {
    const keys = await kv.keys('gpu:*');
    const result: Record<string, CallbackData | null> = {};
    for (const key of keys) {
      result[key.replace('gpu:', '')] = await kv.get<CallbackData>(key);
    }
    return result;
  } catch (e) {
    console.error('KV keys error:', e);
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { instance_id, tunnel_url, status, message } = req.body || {};
    if (!instance_id) return res.status(400).json({ error: 'instance_id required' });

    let data: CallbackData = (await getData(instance_id)) || {};
    if (tunnel_url) { data.tunnel_url = tunnel_url; data.ready = true; }
    if (status) { data.status = status; data.message = message || ''; data.last_update = Date.now(); }

    await setData(instance_id, data);
    return res.status(200).json({ status: 'ok', instance_id, data });
  }

  if (req.method === 'GET') {
    const instance_id = req.query.instance_id as string | undefined;
    if (!instance_id) {
      const allData = await getAllData();
      return res.status(200).json({ entries: Object.keys(allData).length, data: allData });
    }
    const data = await getData(instance_id);
    if (data && typeof data === 'object') {
      return res.status(200).json({
        instance_id, tunnel_url: data.tunnel_url || null,
        status: data.status || null, message: data.message || null,
        ready: data.ready || false, found: true,
      });
    }
    return res.status(200).json({ instance_id, tunnel_url: null, found: false });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
