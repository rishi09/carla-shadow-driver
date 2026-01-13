// Callback endpoint for GPU to report its tunnel URL and status
// Note: In production, use Vercel KV for persistent storage
// For now, we use an in-memory store (works within same instance only)

// Simple in-memory store (will be lost on cold start)
// For production, set up Vercel KV: https://vercel.com/docs/storage/vercel-kv
if (!global.tunnelUrls) {
  global.tunnelUrls = {};
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

    // Get or create the entry for this instance
    if (!global.tunnelUrls[instance_id]) {
      global.tunnelUrls[instance_id] = {};
    }

    // Update with tunnel URL if provided
    const url = tunnel_url || ngrok_url;
    if (url) {
      global.tunnelUrls[instance_id].tunnel_url = url;
      global.tunnelUrls[instance_id].ready = true;
      console.log(`Stored tunnel URL for ${instance_id}: ${url}`);
    }

    // Update status if provided
    if (status) {
      global.tunnelUrls[instance_id].status = status;
      global.tunnelUrls[instance_id].message = message || '';
      global.tunnelUrls[instance_id].last_update = Date.now();
      console.log(`Status update for ${instance_id}: ${status} - ${message}`);
    }

    return res.status(200).json({
      status: 'ok',
      instance_id,
      data: global.tunnelUrls[instance_id]
    });
  }

  // GET: Browser checks for tunnel URL and status
  if (req.method === 'GET') {
    const { instance_id } = req.query;

    if (!instance_id) {
      // Return all entries for debugging
      return res.status(200).json({
        entries: Object.keys(global.tunnelUrls).length,
        data: global.tunnelUrls
      });
    }

    const data = global.tunnelUrls[instance_id] || null;

    if (data && typeof data === 'object') {
      return res.status(200).json({
        instance_id,
        tunnel_url: data.tunnel_url || null,
        status: data.status || null,
        message: data.message || null,
        ready: data.ready || false,
        found: true
      });
    }

    // Legacy format: data is just the URL string
    if (typeof data === 'string') {
      return res.status(200).json({
        instance_id,
        tunnel_url: data,
        found: true
      });
    }

    return res.status(200).json({
      instance_id,
      tunnel_url: null,
      found: false
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
