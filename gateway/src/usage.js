const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');

function serviceHeaders() {
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) return null;
  return {
    apikey: secret,
    // New sb_secret keys are not JWTs and must not be sent as Bearer tokens.
    // Keep Authorization only for a legacy service_role JWT during migration.
    ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }),
    'Content-Type': 'application/json'
  };
}

export async function reserveUsage(userId, kind, requestId) {
  const headers = serviceHeaders();
  if (!headers) {
    if (process.env.REQUIRE_DURABLE_QUOTA === 'true') {
      throw Object.assign(new Error('Durable quota enforcement is not configured.'), { code: 'quota-not-configured' });
    }
    return true;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_ai_request`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_request_id: requestId }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw Object.assign(new Error('Could not reserve AI quota.'), { code: 'quota-service-failed' });
  return (await response.json()) === true;
}

export async function settleUsage(requestId, status, durationMs) {
  const headers = serviceHeaders();
  if (!headers) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/ai_usage?request_id=eq.${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ status, duration_ms: Math.max(0, Math.round(durationMs)), completed_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {}
}
