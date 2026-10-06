// Only generated server copies expire. Desktop files and user uploads are
// outside these buckets/prefixes and are never touched by this worker.
export const MEDIA_RETENTION_DAYS = 14;
const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
export function expiredGeneratedObject(key, modified, now = Date.now()) {
  return new RegExp(`^(?:image|video)/${UUID}/${UUID}\\.(?:png|jpg|webp|gif|avif|mp4|webm|mov)$`, 'i').test(key)
    && Number.isFinite(Date.parse(modified))
    && Date.parse(modified) < now - MEDIA_RETENTION_DAYS * 86400000;
}

export async function cleanupGeneratedMedia({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  let removed = 0;
  // Supabase is the private fallback store, including older generated files.
  const secret = env.SUPABASE_SECRET_KEY;
  if (!secret) return { removed };
  const base = `${String(env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '')}/storage/v1/object`;
  const headers = { apikey: secret, ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }), 'Content-Type': 'application/json' };
  const request = async (url, method, body) => {
    const response = await fetchImpl(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`media-retention-storage-${response.status}`);
    return response.json();
  };
  for (const kind of ['image', 'video']) {
    const bucket = `messs-ai-${kind}-results`;
    const pending = [''];
    const expired = [];
    while (pending.length) {
      const prefix = pending.shift();
      for (let offset = 0; ; offset += 100) {
        const objects = await request(`${base}/list/${bucket}`, 'POST', { prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
        if (!Array.isArray(objects)) throw new Error('Invalid media retention listing');
        for (const object of objects) {
          if (!prefix && !object.id && new RegExp(`^${UUID}$`, 'i').test(object.name)) pending.push(object.name);
          else if (object.id && expiredGeneratedObject(`${kind}/${prefix}/${object.name}`, object.updated_at || object.created_at, now)) expired.push(`${prefix}/${object.name}`);
        }
        if (objects.length < 100) break;
      }
    }
    // Delete after listing so pagination cannot skip objects when offsets move.
    for (let offset = 0; offset < expired.length; offset += 100) {
      const prefixes = expired.slice(offset, offset + 100);
      await request(`${base}/${bucket}`, 'DELETE', { prefixes });
      removed += prefixes.length;
    }
  }
  return { removed };
}

export function startMediaRetention() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { const result = await cleanupGeneratedMedia(); if (result.removed) console.log(JSON.stringify({event:'media-retention-complete',...result})); }
    catch { console.warn(JSON.stringify({event:'media-retention-retry'})); }
    finally { running = false; }
  };
  const first = setTimeout(run, 60000); first.unref();
  const timer = setInterval(run, 3600000); timer.unref();
  return { stop() { clearTimeout(first); clearInterval(timer); } };
}
