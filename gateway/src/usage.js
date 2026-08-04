import crypto from 'node:crypto';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');

// Keep this table in lockstep with lib/credit-pricing.js. The gateway sends an
// expected quote to Supabase, while reserve_ai_credits independently recomputes
// it. A version mismatch therefore fails closed instead of undercharging.
export const IMAGE_CREDITS = Object.freeze({
  'image-1': 16,
  'image-2': 7,
  'image-3': 5,
  'image-4': 4,
  'image-5': 8
});

export const VIDEO_CREDITS_PER_SECOND = Object.freeze({
  'video-1': Object.freeze({ '768P': 10, '2K': 16 })
});

const DURABLE_TIMEOUT_MS = 5_000;
const VALID_RESERVE_REASONS = new Set([
  'reserved',
  'activation-required',
  'insufficient-credits',
  'account-suspended',
  'provider-not-allowed',
  'pricing-mismatch',
  'request-id-conflict'
]);

function durableRequired() {
  return String(process.env.REQUIRE_DURABLE_QUOTA || '').toLowerCase() === 'true';
}

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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function providerRequiresActivation(kind, providerId) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const normalizedProvider = String(providerId || '').trim().toLowerCase();
  // MiniMax H3 is the only currently supported mainland provider. New and
  // unknown providers default to locked until explicitly classified.
  return !(normalizedKind === 'video' && (normalizedProvider || 'video-1') === 'video-1');
}

export function accountAllowsOverseas(account) {
  // null exists only in explicitly non-durable migration/development mode.
  return account === null || Boolean(account && (account.overseasUnlocked === true || account.overseas_unlocked === true));
}

export function filterProviderConfigForAccount(config, account) {
  const source = config && Array.isArray(config.providers) ? config.providers : [];
  if (accountAllowsOverseas(account)) return { ...config, providers: source.slice() };
  return {
    ...config,
    providers: source.filter((provider) => !providerRequiresActivation(provider && provider.kind, provider && provider.id))
  };
}

export function quoteUsage(kind, request = {}) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (normalizedKind === 'chat') {
    const providerId = String(request.providerId || 'chat-1').trim().toLowerCase() || 'chat-1';
    return { kind: 'chat', providerId, credits: 0, resolution: null, duration: null, requiresActivation: true };
  }
  if (normalizedKind === 'image') {
    const providerId = String(request.providerId || 'image-1').trim().toLowerCase() || 'image-1';
    if (!Object.hasOwn(IMAGE_CREDITS, providerId)) {
      throw Object.assign(new Error('The selected image provider is not allowed.'), { code: 'provider-not-allowed', status: 400 });
    }
    return {
      kind: 'image',
      providerId,
      credits: IMAGE_CREDITS[providerId],
      resolution: null,
      duration: null,
      requiresActivation: true
    };
  }
  if (normalizedKind === 'video') {
    const providerId = String(request.providerId || 'video-1').trim().toLowerCase() || 'video-1';
    const rates = VIDEO_CREDITS_PER_SECOND[providerId];
    if (!rates) {
      throw Object.assign(new Error('The selected video provider is not allowed.'), { code: 'provider-not-allowed', status: 400 });
    }
    const resolution = String(request.resolution || '768P').trim().toUpperCase() === '2K' ? '2K' : '768P';
    const duration = boundedInteger(request.duration, 6, 4, 15);
    return {
      kind: 'video',
      providerId,
      credits: rates[resolution] * duration,
      resolution,
      duration,
      requiresActivation: providerRequiresActivation('video', providerId)
    };
  }
  throw Object.assign(new Error('The requested AI usage kind is not allowed.'), { code: 'provider-not-allowed', status: 400 });
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (error) { return null; }
}

function isMissingCreditRpc(response, payload) {
  return response.status === 404 || ['PGRST202', '42883'].includes(String(payload && payload.code || ''));
}

function serviceError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

async function legacyReserve(headers, userId, kind, requestId, fetchImpl) {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/reserve_ai_request`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_request_id: requestId }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  if (!response.ok) throw serviceError('credit-service-failed', 'Could not reserve AI usage.');
  const accepted = (await responsePayload(response)) === true;
  return {
    ok: accepted,
    reason: accepted ? 'legacy-reserved' : 'quota-exceeded',
    credits: 0,
    legacy: true
  };
}

export async function reserveUsage(userId, kind, requestId, request = {}, fetchImpl = fetch) {
  const quote = quoteUsage(kind, request);
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) {
      throw serviceError('credit-service-not-configured', 'Durable credit enforcement is not configured.');
    }
    return { ok: true, reason: 'development-bypass', ...quote, developmentBypass: true };
  }

  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/reserve_ai_credits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_user_id: userId,
      p_kind: quote.kind,
      p_provider_id: quote.providerId,
      p_request_id: requestId,
      p_resolution: quote.resolution,
      p_duration: quote.duration,
      p_expected_credits: quote.credits
    }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    if (isMissingCreditRpc(response, payload) && !durableRequired()) {
      return legacyReserve(headers, userId, quote.kind, requestId, fetchImpl);
    }
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
    throw serviceError(code, 'Could not reserve AI credits.');
  }

  const result = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const reason = VALID_RESERVE_REASONS.has(String(result.reason || ''))
    ? String(result.reason)
    : (result.ok === true ? 'reserved' : 'credit-service-failed');
  if (reason === 'credit-service-failed') throw serviceError(reason, 'The credit service returned an invalid response.');
  return {
    ...result,
    ok: result.ok === true,
    reason,
    credits: Number.isFinite(Number(result.credits)) ? Number(result.credits) : quote.credits,
    providerId: quote.providerId,
    resolution: quote.resolution,
    duration: quote.duration
  };
}

async function legacySettle(headers, requestId, status, durationMs, fetchImpl) {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/ai_usage?request_id=eq.${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status, duration_ms: Math.max(0, Math.round(durationMs)), completed_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  if (!response.ok) throw serviceError('credit-settlement-failed', 'Could not settle AI usage.');
  return { ok: true, reason: 'legacy-settled', legacy: true };
}

export async function settleUsage(requestId, status, durationMs, fetchImpl = fetch) {
  const headers = serviceHeaders();
  if (!headers) return { ok: !durableRequired(), reason: 'not-configured' };
  const normalizedStatus = status === 'succeeded' ? 'succeeded' : 'failed';
  const requestOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_request_id: requestId,
      p_status: normalizedStatus,
      p_duration_ms: Math.max(0, Math.round(Number(durationMs) || 0))
    })
  };
  let response;
  let payload;
  let transportError;
  // Settlement is idempotent in SQL. One immediate retry covers a dropped
  // response after commit as well as a transient 5xx, which is particularly
  // important for releasing failed-generation reservations.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/settle_ai_credits`, {
        ...requestOptions,
        signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
      });
      payload = await responsePayload(response);
      if (response.ok || response.status < 500 || attempt === 1) break;
    } catch (error) {
      transportError = error;
      if (attempt === 1) throw serviceError('credit-settlement-failed', 'Could not settle AI credits.');
    }
  }
  if (!response) throw serviceError('credit-settlement-failed', transportError && transportError.message || 'Could not settle AI credits.');
  if (!response.ok) {
    if (isMissingCreditRpc(response, payload) && !durableRequired()) {
      return legacySettle(headers, requestId, normalizedStatus, durationMs, fetchImpl);
    }
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-settlement-failed';
    throw serviceError(code, 'Could not settle AI credits.');
  }
  if (!payload || payload.ok !== true) throw serviceError('credit-settlement-failed', 'The credit service rejected settlement.');
  return payload;
}

export async function getUsageAccount(userId, fetchImpl = fetch) {
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) throw serviceError('credit-service-not-configured', 'Durable credit enforcement is not configured.');
    return null;
  }
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_ai_credit_account`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_user_id: userId }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    if (isMissingCreditRpc(response, payload) && !durableRequired()) return null;
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
    throw serviceError(code, 'Could not load the AI credit account.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('credit-service-failed', 'The credit service returned an invalid account.');
  }
  return payload;
}

export async function redeemUsageCode(userId, code, fetchImpl = fetch) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode || normalizedCode.length > 256) {
    throw Object.assign(new Error('Enter a valid redemption code.'), { code: 'invalid-redemption-code', status: 400 });
  }
  const headers = serviceHeaders();
  if (!headers) throw serviceError('credit-service-not-configured', 'Redemption is temporarily unavailable.');
  const codeHash = crypto.createHash('sha256').update(normalizedCode, 'utf8').digest('hex');
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/redeem_ai_credit_code`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_user_id: userId, p_code_hash: codeHash }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const errorCode = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'redemption-service-failed';
    throw serviceError(errorCode, 'Could not redeem the code.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('redemption-service-failed', 'The redemption service returned an invalid response.');
  }
  return payload;
}
