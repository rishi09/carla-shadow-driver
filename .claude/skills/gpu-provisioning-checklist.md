# GPU Provisioning Checklist

## Purpose

Ensure GPU provisioning on Vast.ai works reliably. This checklist captures hard-won lessons from production failures.

## When to Use

- Before deploying GPU-related changes
- When debugging "Starting server..." spinning forever
- When users report GPU connection failures
- During code review of GPU provisioning code

## Pre-Deploy Checklist

### 1. GPU Selection Filters

```javascript
// Required filters - DO NOT REMOVE
const suitable = offers.filter(o =>
  o.gpu_ram >= 16000 &&        // Enough VRAM for model
  o.verified !== false &&       // Exclude deverified hosts (CRITICAL)
  o.reliability >= 0.95 &&      // High reliability only
  o.dph_total < 1.00            // Cost control
);
```

**Why each filter matters:**
| Filter | Prevents |
|--------|----------|
| `gpu_ram >= 16000` | Out of memory errors |
| `verified !== false` | Broken hosts with Docker/NVIDIA issues |
| `reliability >= 0.95` | Flaky hosts that fail intermittently |
| `dph_total < 1.00` | Unexpected high costs |

### 2. Retry Logic

- [ ] Auto-retry on GPU failure (up to 3 attempts)
- [ ] Each retry uses a DIFFERENT GPU (not the same one)
- [ ] User sees "Attempt X of Y" during retries
- [ ] Final error only shown after all retries exhausted

### 3. Failure Detection

- [ ] Detect `status === 'stopped'` (GPU failed to start)
- [ ] Detect `setup_status === 'error'` (setup script failed)
- [ ] Polling timeout (5 minutes max)
- [ ] Frontend shows real status, not fake progress

### 4. Status Reporting

The GPU onstart script should report status at each step:
```bash
report_status "installing" "Installing dependencies"
report_status "tunneling" "Creating secure tunnel"
report_status "starting" "Starting AI server"
report_status "ready" "Ready for connections"
report_status "error" "Failed: $reason"  # On any failure
```

### 5. ID Mapping

Vast.ai has TWO IDs:
- `offer.id` - The ID of the GPU offer (used when creating)
- `new_contract` / instance_id - The ID of the running instance (used for polling)

**Critical:** Store data under BOTH IDs so polling works regardless of which ID is used.

### 6. Script Size Limit

**CRITICAL:** Vast.ai has a 4048 character limit for the `onstart` script (and `args` parameter).

Check script size before deploying:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('vercel-deploy/api/gpu/start.js', 'utf8');
const match = content.match(/const onstart = \\\`([\\s\\S]*?)\\\`;/);
if (match) {
  console.log('Onstart script length:', match[1].length, 'characters');
  console.log('Vast.ai limit: 4048 characters');
  if (match[1].length > 4048) {
    console.log('ERROR: Script is', match[1].length - 4048, 'chars over limit!');
    process.exit(1);
  }
}
"
```

If script is too long:
- Remove verbose echo statements
- Use shorter variable names
- Remove debug output
- Condense error handling

### 7. WebSocket API Contract

The frontend and GPU server must agree on message types:

| Client → Server | Server → Client |
|----------------|-----------------|
| `handshake` | `handshake_ack` |
| `ping` | `pong` |
| `state_update` | `prediction` |
| `switch_model` | `status` |
| `get_status` | `error` |

**Before adding new message types:**
1. Document in both frontend and server
2. Add handler in server before frontend sends
3. Test with real connection

## Testing Checklist

### Manual Testing (Before Major Releases)
- [ ] Actually provision a real GPU (costs ~$0.02 for a quick test)
- [ ] Verify status messages appear in modal
- [ ] Cancel mid-provisioning and verify cleanup
- [ ] Let it complete and verify WebSocket connects

### Failure Scenario Testing
- [ ] Test timeout (wait 5+ minutes without callback)
- [ ] Test retry (requires finding a way to simulate failure)
- [ ] Verify error messages are user-friendly

## Monitoring

### What to Log
```
[GPU] Selected offer: {id}, gpu: {name}, reliability: {score}, price: ${price}/hr
[GPU] Instance created: {instance_id}
[GPU] Status update: {status} - {message}
[GPU] Tunnel URL received: {url}
[GPU] Connection failed: {reason}, retrying...
[GPU] All retries exhausted, showing error
```

### Metrics to Track (Future)
- GPU provisioning success rate
- Average provisioning time
- Most common failure reasons
- Which GPU types/hosts fail most often

## Known Issues & Solutions

### "Starting server..." spins forever
**Causes:**
1. Redis not configured (callback data lost)
2. ID mismatch (polling wrong ID)
3. GPU failed silently (no error status)
4. Tunnel never established

**Debug steps:**
```bash
# Check Redis is working
curl https://carla-shadow-driver.vercel.app/api/gpu/callback | jq .using_redis

# Check callback data exists
curl "https://carla-shadow-driver.vercel.app/api/gpu/callback?instance_id=XXXXX"

# Check Vast.ai instance status
curl "https://carla-shadow-driver.vercel.app/api/gpu/status?instance_id=XXXXX"
```

### OCI Runtime Error / CDI Device Error
**Cause:** Deverified host with broken Docker/NVIDIA config
**Fix:** Filter with `verified !== false`

### Cloudflare Tunnel Not Established
**Cause:** Tunnel URL not captured from logs
**Fix:** Retry loop with ANSI code cleaning before grep

## Files Reference

| File | Purpose |
|------|---------|
| `vercel-deploy/api/gpu/start.js` | GPU selection, onstart script |
| `vercel-deploy/api/gpu/status.js` | Status polling endpoint |
| `vercel-deploy/api/gpu/callback.js` | Receives tunnel URL from GPU |
| `v2/src/hooks/useGPUConnection.ts` | Frontend GPU lifecycle management |
| `v2/src/components/game/GPUConnectionModal.tsx` | User-facing status UI |
