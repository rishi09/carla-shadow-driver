// Check GPU instance status on Vast.ai
// Also checks for tunnel URL and setup status from callback store
// Uses Upstash Redis for persistent storage across cold starts

import { Redis } from '@upstash/redis';

// Lazy initialization for Redis client
let redis = null;
let useRedis = false;
let initialized = false;

function initRedis() {
  if (initialized) return;
  initialized = true;

  // Check for Upstash env vars (both naming conventions)
  // When installed via Vercel Marketplace, Upstash uses KV_* naming for compatibility
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    redis = new Redis({ url, token });
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

// Helper to get data from Redis or memory
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

export default async function handler(req, res) {
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

  // Initialize Redis on first request
  initRedis();

  const { instance_id, offer_id } = req.query;

  if (!instance_id) {
    return res.status(400).json({ error: 'instance_id query parameter is required' });
  }

  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  if (!VASTAI_API_KEY) {
    return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });
  }

  try {
    // Get all instances and find the one we want
    const response = await fetch('https://console.vast.ai/api/v0/instances/', {
      headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'Failed to get instances', details: errorText });
    }

    const data = await response.json();
    const instances = data.instances || [];
    const instance = instances.find(i => String(i.id) === String(instance_id));

    if (!instance) {
      return res.status(404).json({
        error: 'Instance not found',
        instance_id: instance_id,
        hint: 'Instance may have been destroyed or not yet created'
      });
    }

    // Check for tunnel URL and status from Redis or memory store
    // Try instance_id first, then offer_id
    let callbackData = await getData(instance_id);

    // Also try with offer_id if provided and no data found
    if (!callbackData && offer_id) {
      callbackData = await getData(offer_id);
    }

    // Parse if string (legacy format or double-serialized)
    if (typeof callbackData === 'string') {
      try {
        callbackData = JSON.parse(callbackData);
      } catch (e) {
        // If parse fails, it's just a URL string
        callbackData = { tunnel_url: callbackData };
      }
    }

    // Extract tunnel info
    let tunnel_url = null;
    let setup_status = null;
    let setup_message = null;

    if (callbackData && typeof callbackData === 'object') {
      tunnel_url = callbackData.tunnel_url || null;
      setup_status = callbackData.status || null;
      setup_message = callbackData.message || null;
    }

    return res.status(200).json({
      instance_id: instance_id,
      status: instance.cur_state || instance.actual_status || instance.status_msg || 'unknown',
      tunnel_url: tunnel_url,
      setup_status: setup_status,
      setup_message: setup_message,
      public_ip: instance.public_ipaddr,
      gpu_name: instance.gpu_name || instance.machine_id,
      cost_so_far: instance.total_cost || 0,
      uptime_seconds: instance.duration || 0,
      ssh_host: instance.ssh_host,
      ssh_port: instance.ssh_port,
      using_redis: useRedis
    });

  } catch (error) {
    console.error('Error getting GPU status:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
