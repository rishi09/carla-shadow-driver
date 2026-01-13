// Callback endpoint for GPU to report its tunnel URL and status
// Uses Upstash Redis for persistent storage across cold starts

import { Redis } from '@upstash/redis';

// Lazy initialization for Redis client
let redis = null;
let useRedis = false;
let initialized = false;

function initRedis() {
  if (initialized) return;
  initialized = true;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    useRedis = true;
    console.log('[Redis] Upstash Redis initialized');
  } else {
    console.warn('[Redis] No Upstash credentials found, using in-memory fallback');
  }
}

// In-memory fallback
if (!global.tunnelUrls) {
  global.tunnelUrls = {};
}

// Helper to get data
async function getData(instanceId) {
  initRedis();
  if (useRedis) {
    try {
      const data = await redis.get(`gpu:${instanceId}`);
      return data || null;
    } catch (e) {
      console.error('Redis get error:', e);
      return global.tunnelUrls[instanceId] || null;
    }
  }
  return global.tunnelUrls[instanceId] || null;
}

// Helper to set data
async function setData(instanceId, data) {
  initRedis();
  if (useRedis) {
    try {
      // Store with 1 hour TTL (instances shouldn't last longer)
      await redis.set(`gpu:${instanceId}`, JSON.stringify(data), { ex: 3600 });
      console.log(`[Redis] Stored data for ${instanceId}`);
    } catch (e) {
      console.error('Redis set error:', e);
      global.tunnelUrls[instanceId] = data;
    }
  } else {
    global.tunnelUrls[instanceId] = data;
  }
}

// Helper to get all keys (for debugging)
async function getAllData() {
  initRedis();
  if (useRedis) {
    try {
      const keys = await redis.keys('gpu:*');
      const result = {};
      for (const key of keys) {
        const data = await redis.get(key);
        result[key.replace('gpu:', '')] = data;
      }
      return result;
    } catch (e) {
      console.error('Redis keys error:', e);
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

  // Initialize Redis on first request
  initRedis();

  // POST: GPU reports its tunnel URL or status
  if (req.method === 'POST') {
    const { instance_id, tunnel_url, ngrok_url, status, message } = req.body || {};

    if (!instance_id) {
      return res.status(400).json({ error: 'instance_id is required' });
    }

    // Get existing data or create new
    let existingData = await getData(instance_id);
    let data = existingData ? (typeof existingData === 'string' ? JSON.parse(existingData) : existingData) : {};

    // Update with tunnel URL if provided
    const url = tunnel_url || ngrok_url;
    if (url) {
      data.tunnel_url = url;
      data.ready = true;
      console.log(`Storing tunnel URL for ${instance_id}: ${url} (Redis: ${useRedis})`);
    }

    // Update status if provided
    if (status) {
      data.status = status;
      data.message = message || '';
      data.last_update = Date.now();
      console.log(`Status update for ${instance_id}: ${status} - ${message} (Redis: ${useRedis})`);
    }

    // Save the data
    await setData(instance_id, data);

    return res.status(200).json({
      status: 'ok',
      instance_id,
      using_redis: useRedis,
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
        using_redis: useRedis,
        entries: Object.keys(allData).length,
        data: allData
      });
    }

    let data = await getData(instance_id);

    // Parse if string
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        // Legacy format: data is just the URL string
        return res.status(200).json({
          instance_id,
          tunnel_url: data,
          found: true,
          using_redis: useRedis
        });
      }
    }

    if (data && typeof data === 'object') {
      return res.status(200).json({
        instance_id,
        tunnel_url: data.tunnel_url || null,
        status: data.status || null,
        message: data.message || null,
        ready: data.ready || false,
        found: true,
        using_redis: useRedis
      });
    }

    return res.status(200).json({
      instance_id,
      tunnel_url: null,
      found: false,
      using_redis: useRedis
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
