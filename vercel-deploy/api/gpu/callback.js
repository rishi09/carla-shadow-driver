// Callback endpoint for GPU to report its tunnel URL (Cloudflare)
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

  // POST: GPU reports its tunnel URL
  if (req.method === 'POST') {
    const { instance_id, tunnel_url, ngrok_url } = req.body || {};

    // Accept either tunnel_url (cloudflared) or ngrok_url (legacy)
    const url = tunnel_url || ngrok_url;

    if (!instance_id || !url) {
      return res.status(400).json({ error: 'instance_id and tunnel_url are required' });
    }

    // Store the tunnel URL
    global.tunnelUrls[instance_id] = url;

    console.log(`Stored tunnel URL for ${instance_id}: ${url}`);

    return res.status(200).json({ status: 'ok', instance_id, tunnel_url: url });
  }

  // GET: Browser checks for tunnel URL
  if (req.method === 'GET') {
    const { instance_id } = req.query;

    if (!instance_id) {
      return res.status(400).json({ error: 'instance_id query parameter is required' });
    }

    const tunnel_url = global.tunnelUrls[instance_id] || null;

    return res.status(200).json({
      instance_id,
      tunnel_url,
      found: !!tunnel_url
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
