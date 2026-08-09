import crypto from 'node:crypto';
import { BUTLER_FIXED_RETAIL_CREDITS, quoteButlerRetailCredits } from './tool-pricing.js';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');

// Keep this table in lockstep with lib/credit-pricing.js. The gateway sends an
// expected quote to Supabase, while reserve_ai_credits independently recomputes
// it. A version mismatch therefore fails closed instead of undercharging.
export const IMAGE_CREDITS = Object.freeze({
  'image-1': 16,
  'image-2': 7,
  'image-3': 5,
  'image-4': 4,
  'image-5': 8,
  'image-6': 12,
  'image-7': 4,
  'image-8': 4
});

export const IMAGE_QUALITY_CREDITS = Object.freeze({
  'image-6': Object.freeze({ low: 3, medium: 8, high: 28, auto: 12 })
});

export const IMAGE_RESOLUTION_CREDITS = Object.freeze({
  'image-7': Object.freeze({ '720p': 4, '1080p': 8 }),
  'image-8': Object.freeze({ '720p': 4, '1080p': 8 })
});

export const VIDEO_CREDITS_PER_SECOND = Object.freeze({
  'video-1': Object.freeze({ '768P': 10, '2K': 16 }),
  'video-2': Object.freeze({ '480P': 3, '720P': 5 }),
  'video-3': Object.freeze({ '480P': 4, '720P': 6 })
});

export const VIDEO_DEFAULT_RESOLUTIONS = Object.freeze({
  'video-1': '768P',
  'video-2': '720P',
  'video-3': '720P'
});

const DURABLE_TIMEOUT_MS = 5_000;
const VALID_RESERVE_REASONS = new Set([
  'reserved',
  // Only accepted as a fail-closed response from the legacy credit RPC. The
  // gateway makes one scoped migration attempt before exposing this denial.
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
  // Kept as a compatibility export for older desktop clients. Redemption
  // codes now add credits only; model access is never activation-gated.
  void kind;
  void providerId;
  return false;
}

export function accountAllowsOverseas(account) {
  // The legacy account field may remain in persisted responses, but it no
  // longer controls provider visibility or access.
  void account;
  return true;
}

export function filterProviderConfigForAccount(config, account) {
  const source = config && Array.isArray(config.providers) ? config.providers : [];
  void account;
  return { ...config, providers: source.slice() };
}

export function quoteUsage(kind, request = {}) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (normalizedKind === 'chat') {
    const providerId = String(request.providerId || 'chat-1').trim().toLowerCase() || 'chat-1';
    return { kind: 'chat', providerId, credits: 0, resolution: null, duration: null, requiresActivation: false };
  }
  if (normalizedKind === 'image') {
    const providerId = String(request.providerId || 'image-1').trim().toLowerCase() || 'image-1';
    if (!Object.hasOwn(IMAGE_CREDITS, providerId)) {
      throw Object.assign(new Error('The selected image provider is not allowed.'), { code: 'provider-not-allowed', status: 400 });
    }
    const qualityRates = IMAGE_QUALITY_CREDITS[providerId];
    const resolutionRates = IMAGE_RESOLUTION_CREDITS[providerId];
    const requestedQuality = String(request.quality || 'auto').trim().toLowerCase();
    const quality = qualityRates && Object.hasOwn(qualityRates, requestedQuality) ? requestedQuality : 'auto';
    const requestedResolution = String(request.resolution || request.size || '720p').trim().toLowerCase();
    const resolution = resolutionRates && Object.hasOwn(resolutionRates, requestedResolution) ? requestedResolution : '720p';
    return {
      kind: 'image',
      providerId,
      credits: qualityRates ? qualityRates[quality] : resolutionRates ? resolutionRates[resolution] : IMAGE_CREDITS[providerId],
      resolution: qualityRates ? quality : resolutionRates ? resolution : null,
      ...(qualityRates ? { quality } : {}),
      ...(resolutionRates ? { imageResolution: resolution } : {}),
      duration: null,
      requiresActivation: false
    };
  }
  if (normalizedKind === 'video') {
    const providerId = String(request.providerId || 'video-1').trim().toLowerCase() || 'video-1';
    const rates = VIDEO_CREDITS_PER_SECOND[providerId];
    if (!rates) {
      throw Object.assign(new Error('The selected video provider is not allowed.'), { code: 'provider-not-allowed', status: 400 });
    }
    const requestedResolution = String(request.resolution || '').trim().toUpperCase();
    const defaultResolution = VIDEO_DEFAULT_RESOLUTIONS[providerId];
    const resolution = Object.hasOwn(rates, requestedResolution) ? requestedResolution : defaultResolution;
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

async function reserveCredits(headers, requestBody, fetchImpl, rpcName = 'reserve_ai_credits') {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers,
    body: requestBody,
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  return { response, payload: await responsePayload(response) };
}

async function openLegacyModelAccess(headers, userId, fetchImpl) {
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(normalizedUserId)) return false;
  const accountUrl = new URL(`${supabaseUrl}/rest/v1/ai_credit_accounts`);
  accountUrl.searchParams.set('user_id', `eq.${normalizedUserId}`);
  accountUrl.searchParams.set('select', 'user_id,overseas_unlocked');
  try {
    const response = await fetchImpl(accountUrl.toString(), {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ overseas_unlocked: true }),
      signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
    });
    const payload = await responsePayload(response);
    return response.ok
      && Array.isArray(payload)
      && payload.length === 1
      && String(payload[0] && payload[0].user_id || '') === normalizedUserId
      && payload[0].overseas_unlocked === true;
  } catch {
    return false;
  }
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

  const requestBody = JSON.stringify({
    p_user_id: userId,
    p_kind: quote.kind,
    p_provider_id: quote.providerId,
    p_request_id: requestId,
    p_resolution: quote.resolution,
    p_duration: quote.duration,
    p_expected_credits: quote.credits
  });
  const reserveRpc = ['image-7', 'image-8'].includes(quote.providerId)
    ? 'reserve_higgsfield_credits'
    : 'reserve_ai_credits';
  let { response, payload } = await reserveCredits(headers, requestBody, fetchImpl, reserveRpc);
  if (!response.ok) {
    if (isMissingCreditRpc(response, payload) && !durableRequired()) {
      return legacyReserve(headers, userId, quote.kind, requestId, fetchImpl);
    }
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
    throw serviceError(code, 'Could not reserve AI credits.');
  }

  // Databases that have not received the open-access migration can still
  // reject an otherwise valid quote with the retired activation gate. Update
  // only this account and replay the identical server-authoritative request
  // once; every response after that follows the normal fail-closed path.
  if (payload && !Array.isArray(payload) && payload.ok === false && payload.reason === 'activation-required') {
    const accessOpened = await openLegacyModelAccess(headers, userId, fetchImpl);
    if (accessOpened) {
      ({ response, payload } = await reserveCredits(headers, requestBody, fetchImpl, reserveRpc));
      if (!response.ok) {
        const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
        throw serviceError(code, 'Could not reserve AI credits.');
      }
    }
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
    ...(quote.quality ? { quality: quote.quality } : {}),
    ...(quote.imageResolution ? { imageResolution: quote.imageResolution } : {}),
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
  if (String(payload.status || '') !== normalizedStatus) {
    throw serviceError(
      'credit-settlement-conflict',
      'The AI request was already settled with a different result.',
      409
    );
  }
  return payload;
}

export async function reserveToolUsage(userId, requestId, request = {}, fetchImpl = fetch) {
  const providerId = String(request.providerId || '').trim().toLowerCase();
  const hasRequestedCredits = request.credits !== null && request.credits !== undefined;
  const requestedCredits = hasRequestedCredits ? Number(request.credits) : null;
  const isTopaz = providerId === 'topaz-video-upscale';
  const hasProviderCost = request.providerCost !== null && request.providerCost !== undefined;
  const providerCost = isTopaz && hasProviderCost ? Number(request.providerCost) : null;
  const resolution = String(request.resolution || '').trim().slice(0, 32) || null;
  const duration = request.duration === null || request.duration === undefined
    ? null
    : boundedInteger(request.duration, 1, 1, 21_600);
  let credits;
  try {
    credits = quoteButlerRetailCredits(providerId, providerCost);
  } catch (error) {
    throw serviceError('provider-not-allowed', 'The requested Butler tool usage is invalid.', 400);
  }
  if (
    (hasRequestedCredits && (!Number.isInteger(requestedCredits) || requestedCredits !== credits))
    || (isTopaz && !hasProviderCost)
    || (!isTopaz && hasProviderCost)
    || (!isTopaz && !Object.hasOwn(BUTLER_FIXED_RETAIL_CREDITS, providerId))
  ) {
    throw serviceError('provider-not-allowed', 'The requested Butler tool usage is invalid.', 400);
  }
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) {
      throw serviceError('credit-service-not-configured', 'Durable credit enforcement is not configured.');
    }
    return {
      ok: true,
      reason: 'development-bypass',
      providerId,
      credits,
      providerCost,
      resolution,
      duration,
      developmentBypass: true
    };
  }
  const requestOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_user_id: userId,
      p_request_id: requestId,
      p_provider_id: providerId,
      p_credits: credits,
      p_provider_cost: providerCost,
      p_resolution: resolution,
      p_duration: duration
    })
  };
  let response;
  let payload;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/reserve_ai_tool_credits`, {
        ...requestOptions,
        signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
      });
      payload = await responsePayload(response);
      if (response.ok || response.status < 500 || attempt === 1) break;
    } catch (error) {
      if (attempt === 1) {
        throw serviceError('credit-service-failed', 'Could not reserve Butler tool credits.');
      }
    }
  }
  if (!response) throw serviceError('credit-service-failed', 'Could not reserve Butler tool credits.');
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
    throw serviceError(code, 'Could not reserve Butler tool credits.');
  }
  const result = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const reason = String(result.reason || '');
  if (!['reserved', 'already-reserved', 'insufficient-credits', 'account-suspended', 'request-id-conflict'].includes(reason)) {
    throw serviceError('credit-service-failed', 'The credit service returned an invalid Butler reservation.');
  }
  return {
    ...result,
    ok: result.ok === true,
    reason,
    providerId,
    credits,
    providerCost,
    resolution,
    duration
  };
}

export async function touchToolUsage(userId, requestId, fetchImpl = fetch) {
  const headers = serviceHeaders();
  if (!headers) return { ok: !durableRequired(), reason: 'not-configured' };
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/touch_ai_tool_credits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_request_id: requestId, p_user_id: userId }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-service-failed';
    throw serviceError(code, 'Could not refresh Butler tool accounting.');
  }
  if (!payload || payload.ok !== true) {
    throw serviceError('credit-service-failed', 'The credit service rejected the Butler task.');
  }
  return payload;
}

export async function settleToolUsage(userId, requestId, status, durationMs, fetchImpl = fetch) {
  const headers = serviceHeaders();
  if (!headers) return { ok: !durableRequired(), reason: 'not-configured', status };
  const normalizedStatus = status === 'succeeded' ? 'succeeded' : 'failed';
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/settle_ai_tool_credits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_request_id: requestId,
      p_user_id: userId,
      p_status: normalizedStatus,
      p_duration_ms: Math.max(0, Math.round(Number(durationMs) || 0))
    }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'credit-settlement-failed';
    throw serviceError(code, 'Could not settle Butler tool credits.');
  }
  if (!payload || payload.ok !== true || String(payload.status || '') !== normalizedStatus) {
    throw serviceError('credit-settlement-failed', 'The credit service rejected Butler settlement.');
  }
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

function normalizeUsageRange(value) {
  const normalized = String(value || '7d').trim().toLowerCase();
  if (normalized === '7' || normalized === '7d') return '7d';
  if (normalized === '30' || normalized === '30d') return '30d';
  if (normalized === 'all') return 'all';
  throw Object.assign(new Error('The usage range is invalid.'), { code: 'invalid-usage-range', status: 400 });
}

function nonnegativeNumber(value, integer = true) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return integer ? Math.round(parsed) : Math.round(parsed * 100) / 100;
}

function usageRows(value, maximum, rowMapper) {
  return Array.isArray(value) ? value.slice(0, maximum).map(rowMapper) : [];
}

function publicUsageSummary(payload, fallbackRange) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('usage-service-failed', 'The usage service returned an invalid response.');
  }
  const period = payload.period && typeof payload.period === 'object' ? payload.period : {};
  const account = payload.account && typeof payload.account === 'object' ? payload.account : {};
  const totals = payload.totals && typeof payload.totals === 'object' ? payload.totals : {};
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
  const usageCountRow = (row = {}) => ({
    credits: nonnegativeNumber(row.credits),
    generations: nonnegativeNumber(row.generations),
    requests: nonnegativeNumber(row.requests)
  });
  return {
    range: normalizeUsageRange(payload.range || fallbackRange),
    timeZone: 'UTC',
    period: {
      from: validDate(period.from),
      to: validDate(period.to),
      days: Math.max(1, nonnegativeNumber(period.days))
    },
    account: {
      balance: nonnegativeNumber(account.balance),
      reserved: nonnegativeNumber(account.reserved),
      availableCredits: nonnegativeNumber(account.availableCredits),
      membershipTier: String(account.membershipTier || 'free').trim().slice(0, 40) || 'free'
    },
    totals: {
      ...usageCountRow(totals),
      averagePerDay: nonnegativeNumber(totals.averagePerDay, false)
    },
    byType: usageRows(payload.byType, 8, (row = {}) => ({
      kind: String(row.kind || 'other').trim().toLowerCase().slice(0, 32) || 'other',
      ...usageCountRow(row)
    })),
    daily: usageRows(payload.daily, 3660, (row = {}) => ({
      date: validDate(row.date),
      ...usageCountRow(row)
    })).filter((row) => row.date),
    byModel: usageRows(payload.byModel, 20, (row = {}) => ({
      providerId: String(row.providerId || 'unknown').trim().toLowerCase().slice(0, 64) || 'unknown',
      kind: String(row.kind || 'other').trim().toLowerCase().slice(0, 32) || 'other',
      ...usageCountRow(row)
    })),
    updatedAt: String(payload.updatedAt || '').slice(0, 40)
  };
}

export async function getUsageSummary(userId, range = '7d', fetchImpl = fetch) {
  const normalizedRange = normalizeUsageRange(range);
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) throw serviceError('credit-service-not-configured', 'Durable usage reporting is not configured.');
    return null;
  }
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_ai_usage_summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId, p_range: normalizedRange }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'usage-service-failed';
    throw serviceError(code, 'Could not load AI usage.');
  }
  return publicUsageSummary(payload, normalizedRange);
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
