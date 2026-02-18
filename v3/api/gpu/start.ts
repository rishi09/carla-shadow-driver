import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

const VASTAI_API_KEY = process.env.VASTAI_API_KEY;
const VAST_API_BASE = 'https://console.vast.ai/api/v0';

// v3 callback URL - this project's domain
const CALLBACK_URL = 'https://shadow-driver-v3.vercel.app/api/gpu/callback';

interface VastOffer {
  id: number;
  gpu_name: string;
  dph_total: number;
  num_gpus: number;
  gpu_ram: number;
  inet_down: number;
  reliability: number;
  cuda_max_good: number;
  [key: string]: unknown;
}

// v3 onstart: report starting status only. Docker ENTRYPOINT handles everything.
const ONSTART_SCRIPT = `#!/bin/bash
INST_ID="\${VAST_CONTAINERLABEL:-\${INSTANCE_ID}}"
CB="${CALLBACK_URL}"
curl -s -X POST "\$CB" -H "Content-Type: application/json" -d "{\\"instance_id\\":\\"\$INST_ID\\",\\"status\\":\\"starting\\",\\"message\\":\\"Container started\\"}" || true
`;

async function setData(key: string, data: unknown): Promise<void> {
  try {
    await kv.set(`gpu:${key}`, data, { ex: 3600 });
  } catch (e) {
    console.error('KV set error:', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!VASTAI_API_KEY) return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });

  try {
    const searchResponse = await fetch(`${VAST_API_BASE}/bundles/`, {
      headers: { Authorization: `Bearer ${VASTAI_API_KEY}` },
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      return res.status(502).json({ error: 'Failed to search Vast.ai offers', details: errorText });
    }

    const offers = await searchResponse.json();

    // v3: Filter for 24GB+ VRAM GPUs (needed for Alpamayo model)
    // Price up to $1.50/hr for larger GPUs
    const suitable = ((offers.offers || []) as VastOffer[])
      .filter(
        (o) =>
          o.gpu_ram >= 24000 &&
          o.reliability >= 0.9 &&
          o.cuda_max_good >= 12.1 &&
          o.dph_total > 0 &&
          o.dph_total < 1.50
      )
      .sort((a, b) => a.dph_total - b.dph_total);

    if (suitable.length === 0) {
      return res.status(503).json({
        error: 'No suitable GPUs available (need 24GB+ VRAM)',
        hint: 'Try again in a few minutes',
      });
    }

    const maxRetries = Math.min(5, suitable.length);
    let lastError: string | null = null;

    for (let i = 0; i < maxRetries; i++) {
      const offer = suitable[i];
      try {
        console.log(`[v3-start] Trying offer ${offer.id}: ${offer.gpu_name} @ $${offer.dph_total}/hr`);

        const createResponse = await fetch(`${VAST_API_BASE}/asks/${offer.id}/`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${VASTAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: 'shadow-driver-v3',
            image: 'rkshah09/shadow-driver-v3:latest',
            disk: 50,
            onstart: ONSTART_SCRIPT,
            env: {
              INSTANCE_ID: String(offer.id),
              CALLBACK_URL: CALLBACK_URL,
            },
          }),
        });

        if (createResponse.ok) {
          const instance = await createResponse.json();
          const instanceId = instance.new_contract;
          await setData(`offer_${offer.id}`, { pending: true, instance_id: instanceId });

          console.log(`[v3-start] Instance created: ${instanceId} (offer: ${offer.id})`);

          return res.status(200).json({
            instance_id: String(instanceId),
            offer_id: String(offer.id),
            gpu_name: offer.gpu_name,
            price_per_hour: offer.dph_total,
            status: 'starting',
          });
        }

        lastError = await createResponse.text();
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    return res.status(502).json({
      error: 'Failed to create instance after multiple attempts',
      details: lastError,
    });
  } catch (e) {
    console.error('[v3-start] Error:', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
