import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const VASTAI_API_KEY = process.env.VASTAI_API_KEY;
const VAST_API_BASE = 'https://console.vast.ai/api/v0';

interface CallbackData {
  tunnel_url?: string;
  status?: string;
  message?: string;
  ready?: boolean;
}

interface VastInstance {
  id: number;
  cur_state?: string;
  actual_status?: string;
  status_msg?: string;
  gpu_name?: string;
  machine_id?: string;
  total_cost?: number;
  duration?: number;
  public_ipaddr?: string;
  ssh_host?: string;
  ssh_port?: number;
  dph_total?: number;
  start_date?: number;
  [key: string]: unknown;
}

async function getData(instanceId: string): Promise<CallbackData | null> {
  try {
    return await kv.get<CallbackData>(`gpu:${instanceId}`);
  } catch (e) {
    console.error('KV get error:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const instance_id = req.query.instance_id as string | undefined;
  const offer_id = req.query.offer_id as string | undefined;

  if (!instance_id) {
    return res.status(400).json({ error: 'instance_id query parameter is required' });
  }

  if (!VASTAI_API_KEY) {
    return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });
  }

  try {
    // Get all instances and find the one we want
    const response = await fetch(`${VAST_API_BASE}/instances/`, {
      headers: { Authorization: `Bearer ${VASTAI_API_KEY}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'Failed to get instances', details: errorText });
    }

    const data = await response.json();
    const instances: VastInstance[] = data.instances || [];
    const instance = instances.find((i) => String(i.id) === String(instance_id));

    if (!instance) {
      return res.status(404).json({
        error: 'Instance not found',
        instance_id,
        hint: 'Instance may have been destroyed or not yet created',
      });
    }

    // Check for tunnel URL and status from KV
    // VAST_CONTAINERLABEL uses "C." prefix, so try multiple key formats
    let callbackData = await getData(instance_id);
    if (!callbackData) {
      callbackData = await getData(`C.${instance_id}`);
    }
    if (!callbackData && offer_id) {
      callbackData = await getData(offer_id);
    }
    if (!callbackData && offer_id) {
      callbackData = await getData(`offer_${offer_id}`);
    }

    const tunnel_url = callbackData?.tunnel_url || null;
    const setup_status = callbackData?.status || null;
    const setup_message = callbackData?.message || null;

    return res.status(200).json({
      instance_id,
      status: instance.cur_state || instance.actual_status || instance.status_msg || 'unknown',
      tunnel_url,
      setup_status,
      setup_message,
      gpu_name: instance.gpu_name || instance.machine_id,
      cost_so_far: instance.total_cost || 0,
      uptime_seconds: instance.duration || 0,
      public_ip: instance.public_ipaddr,
      ssh_host: instance.ssh_host,
      ssh_port: instance.ssh_port,
    });
  } catch (e) {
    console.error('[status] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
