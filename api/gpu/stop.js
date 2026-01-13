// Destroys a GPU instance on Vast.ai
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { instance_id } = req.body || {};

  if (!instance_id) {
    return res.status(400).json({ error: 'instance_id is required' });
  }

  const VASTAI_API_KEY = process.env.VASTAI_API_KEY;

  if (!VASTAI_API_KEY) {
    return res.status(500).json({ error: 'VASTAI_API_KEY not configured' });
  }

  try {
    const response = await fetch(`https://console.vast.ai/api/v0/instances/${instance_id}/`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${VASTAI_API_KEY}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'Failed to destroy instance', details: errorText });
    }

    return res.status(200).json({ status: 'destroyed', instance_id });

  } catch (error) {
    console.error('Error destroying GPU:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
