// Check GPU instance status on Vast.ai
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

  const { instance_id } = req.query;

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

    // Check if we have a stored ngrok URL for this instance
    let ngrok_url = null;
    if (global.ngrokUrls && global.ngrokUrls[instance_id]) {
      ngrok_url = global.ngrokUrls[instance_id];
    }

    return res.status(200).json({
      instance_id: instance_id,
      status: instance.cur_state || instance.actual_status || instance.status_msg || 'unknown',
      ngrok_url: ngrok_url,
      gpu_name: instance.gpu_name || instance.machine_id,
      cost_so_far: instance.total_cost || 0,
      uptime_seconds: instance.duration || 0,
      ssh_host: instance.ssh_host,
      ssh_port: instance.ssh_port
    });

  } catch (error) {
    console.error('Error getting GPU status:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
