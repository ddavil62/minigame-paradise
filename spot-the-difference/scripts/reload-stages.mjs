const endpoint = process.env.SPOT_RELOAD_URL
  || 'http://127.0.0.1:3000/spot-the-difference/admin/reload-stages';

const response = await fetch(endpoint, { method: 'POST' });
const payload = await response.json().catch(() => ({}));
if (!response.ok || payload.ok !== true) {
  throw new Error(payload.error || `stage reload failed: HTTP ${response.status}`);
}

console.log(`Reloaded ${payload.count} stages (default: ${payload.defaultStageId}).`);
