// Callback endpoint for GPU to report its ngrok URL
// Note: In production, use Vercel KV for persistent storage
// For now, we use an in-memory store (works within same instance only)

// Simple in-memory store (will be lost on cold start)
// For production, set up Vercel KV: https://vercel.com/docs/storage/vercel-kv
if (!global.ngrokUrls) {
  global.ngrokUrls = {};
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST: GPU reports its ngrok URL
  if (req.method === 'POST') {
    const { instance_id, ngrok_url } = req.body || {};

    if (!instance_id || !ngrok_url) {
      return res.status(400).json({ error: 'instance_id and ngrok_url are required' });
    }

    // Store the ngrok URL
    global.ngrokUrls[instance_id] = ngrok_url;

    console.log(`Stored ngrok URL for ${instance_id}: ${ngrok_url}`);

    return res.status(200).json({ status: 'ok', instance_id, ngrok_url });
  }

  // GET: Browser checks for ngrok URL
  if (req.method === 'GET') {
    const { instance_id } = req.query;

    if (!instance_id) {
      return res.status(400).json({ error: 'instance_id query parameter is required' });
    }

    const ngrok_url = global.ngrokUrls[instance_id] || null;

    return res.status(200).json({
      instance_id,
      ngrok_url,
      found: !!ngrok_url
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
