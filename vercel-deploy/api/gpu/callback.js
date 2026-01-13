// Callback endpoint for GPU to report its tunnel URL and status
// Uses Vercel KV for persistent storage across cold starts

import { kv } from '@vercel/kv';

// Fallback to in-memory if KV not configured
const useKV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

// In-memory fallback
if (!global.tunnelUrls) {
  global.tunnelUrls = {};
}

// Helper to get data
async function getData(instanceId) {
  if (useKV) {
    try {
      const data = await kv.get(`gpu:${instanceId}`);
      return data || null;
    } catch (e) {
      console.error('KV get error:', e);
      return global.tunnelUrls[instanceId] || null;
    }
  }
  return global.tunnelUrls[instanceId] || null;
}

// Helper to set data
async function setData(instanceId, data) {
  if (useKV) {
    try {
      // Store with 1 hour TTL (instances shouldn't last longer)
      await kv.set(`gpu:${instanceId}`, data, { ex: 3600 });
      console.log(`[KV] Stored data for ${instanceId}`);
    } catch (e) {
      console.error('KV set error:', e);
      global.tunnelUrls[instanceId] = data;
    }
  } else {
    global.tunnelUrls[instanceId] = data;
  }
}

// Helper to get all keys (for debugging)
async function getAllData() {
  if (useKV) {
    try {
      const keys = await kv.keys('gpu:*');
      const result = {};
      for (const key of keys) {
        const data = await kv.get(key);
        result[key.replace('gpu:', '')] = data;
      }
      return result;
    } catch (e) {
      console.error('KV keys error:', e);
      return global.tunnelUrls;
    }
  }
  return global.tunnelUrls;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST: GPU reports its tunnel URL or status
  if (req.method === 'POST') {
    const { instance_id, tunnel_url, ngrok_url, status, message } = req.body || {};

    if (!instance_id) {
      return res.status(400).json({ error: 'instance_id is required' });
    }

    // Get existing data or create new
    let data = await getData(instance_id) || {};

    // Update with tunnel URL if provided
    const url = tunnel_url || ngrok_url;
    if (url) {
      data.tunnel_url = url;
      data.ready = true;
      console.log(`Storing tunnel URL for ${instance_id}: ${url} (KV: ${useKV})`);
    }

    // Update status if provided
    if (status) {
      data.status = status;
      data.message = message || '';
      data.last_update = Date.now();
      console.log(`Status update for ${instance_id}: ${status} - ${message} (KV: ${useKV})`);
    }

    // Save the data
    await setData(instance_id, data);

    return res.status(200).json({
      status: 'ok',
      instance_id,
      using_kv: useKV,
      data
    });
  }

  // GET: Browser checks for tunnel URL and status
  if (req.method === 'GET') {
    const { instance_id } = req.query;

    if (!instance_id) {
      // Return all entries for debugging
      const allData = await getAllData();
      return res.status(200).json({
        using_kv: useKV,
        entries: Object.keys(allData).length,
        data: allData
      });
    }

    const data = await getData(instance_id);

    if (data && typeof data === 'object') {
      return res.status(200).json({
        instance_id,
        tunnel_url: data.tunnel_url || null,
        status: data.status || null,
        message: data.message || null,
        ready: data.ready || false,
        found: true,
        using_kv: useKV
      });
    }

    // Legacy format: data is just the URL string
    if (typeof data === 'string') {
      return res.status(200).json({
        instance_id,
        tunnel_url: data,
        found: true,
        using_kv: useKV
      });
    }

    return res.status(200).json({
      instance_id,
      tunnel_url: null,
      found: false,
      using_kv: useKV
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
