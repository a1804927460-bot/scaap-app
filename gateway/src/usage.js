import crypto from 'node:crypto';
import {
  BUTLER_FIXED_RETAIL_CREDITS,
  TOPAZ_DYNAMIC_PROVIDERS,
  quoteButlerRetailCredits
} from './tool-pricing.js';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');

// Keep this table in lockstep with lib/credit-pricing.js. The gateway sends an
// expected quote to Supabase, while reserve_ai_credits independently recomputes
// it. A version mismatch therefore fails closed instead of undercharging.
export const IMAGE_CREDITS = Object.freeze({
  'atlas-image-gpt2': 15, 'atlas-image-gpt2-edit': 15,
  'image-1': 22, 'image-2': 20, 'image-3': 17, 'image-4': 16,
  'image-5': 16, 'image-6': 20, 'image-7': 16, 'image-8': 16,
  'image-9': 17, 'image-10': 18, 'image-11': 17, 'image-12': 16,
  'image-13': 16, 'image-14': 16, 'image-15': 17, 'image-16': 16,
  'image-17': 16, 'image-18': 16
});

export const IMAGE_QUALITY_CREDITS = Object.freeze({
  'image-6': Object.freeze({ low: 16, medium: 18, high: 28, auto: 20 }),
  'atlas-image-gpt2': Object.freeze({ low: 15, medium: 15, high: 20, auto: 15 })
});

export const IMAGE_RESOLUTION_CREDITS = Object.freeze({
  'image-1': Object.freeze({ '1k': 22, '2k': 22, '4k': 28 }),
  'image-2': Object.freeze({ '1k': 18, '2k': 20, '4k': 22 }),
  'image-3': Object.freeze({ '2k': 17, '4k': 18 }),
  'image-7': Object.freeze({ '720p': 16, '1080p': 18 }),
  'image-8': Object.freeze({ '720p': 16, '1080p': 18 }),
  'image-10': Object.freeze({ '2k': 18, '4k': 21 }),
  'image-11': Object.freeze({ '2k': 17, '4k': 18 }),
  'image-12': Object.freeze({ '1k': 16, '2k': 17, '4k': 18 }),
  'image-15': Object.freeze({ '1k': 17, '2k': 18 }),
  'image-16': Object.freeze({ '512x512': 16, '1024x1024': 16 }),
  'image-17': Object.freeze({ '1k': 16, '2k': 24 }),
  'image-18': Object.freeze({ '1k': 16, '2k': 24 })
});

const IMAGE_DEFAULT_RESOLUTIONS = Object.freeze({
  'image-17': '1k',
  'image-18': '1k'
});

// 302 charges PTC in USD. Keep the conversion in the gateway so the server
// quote remains correct even when a desktop bundle is stale.
export const USD_TO_CNY = 6.8;
const POINTS_PER_CNY = 10;
const PROFIT_PER_REQUEST_CREDITS = 1.4 * POINTS_PER_CNY;
const SEEDANCE_720P_PTC_PER_SECOND = 0.2592;
const SEEDANCE_480P_PTC_PER_SECOND = SEEDANCE_720P_PTC_PER_SECOND * 0.5;
const SEEDANCE_PTC_PER_SECOND = Object.freeze({
  'video-2': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND * (7.884 / 10),
    '720P': SEEDANCE_720P_PTC_PER_SECOND * (7.884 / 10)
  }),
  'video-3': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND,
    '720P': SEEDANCE_720P_PTC_PER_SECOND
  }),
  'video-4': Object.freeze({
    '480P': SEEDANCE_480P_PTC_PER_SECOND * (6.516 / 10),
    '720P': SEEDANCE_720P_PTC_PER_SECOND * (6.516 / 10)
  })
});

const SEEDANCE_VIDEO_RATES = Object.freeze(Object.fromEntries(
  Object.entries(SEEDANCE_PTC_PER_SECOND).map(([providerId, rates]) => [
    providerId,
    Object.freeze(Object.fromEntries(
      Object.entries(rates).map(([resolution, ptcPerSecond]) => [
        resolution,
        ptcPerSecond * USD_TO_CNY * POINTS_PER_CNY
      ])
    ))
  ])
));

export const VIDEO_CREDITS_PER_SECOND = Object.freeze({
  'atlas-video-seedance20-i2v': Object.freeze({
    '480P': 3.808, '720P': 7.616, '720P-SR': 8.378, '1080P': 11.424,
    '1080P-SR': 12.947, '1440P-SR': 15.232, '4K': 19.04
  }),
  'atlas-video-seedance20-ref': Object.freeze({
    '480P': 3.808, '720P': 7.616, '720P-SR': 8.378, '1080P': 11.424,
    '1080P-SR': 12.947, '1440P-SR': 15.232, '4K': 19.04
  }),
  'atlas-video-seedance25-i2v': Object.freeze({
    '480P': 4.556, '720P': 9.112, '720P-SR': 10.023, '720P-ESR': 10.023,
    '1080P': 13.668, '1080P-SR': 15.490, '1080P-ESR': 15.490,
    '1080P-ESR & 60FPS': 18.228, '1440P-SR': 18.224, '1440P-ESR': 18.224, '4K-ESR': 22.780
  }),
  'atlas-video-seedance25-ref': Object.freeze({
    '480P': 4.556, '720P': 9.112, '720P-SR': 10.023, '720P-ESR': 10.023,
    '1080P': 13.668, '1080P-SR': 15.490, '1080P-ESR': 15.490,
    '1080P-ESR & 60FPS': 18.228, '1440P-SR': 18.224, '1440P-ESR': 18.224, '4K-ESR': 22.780
  }),
  'video-1': Object.freeze({ '768P': 5, '2K': 8 }),
  // Logical Seedance billing uses the higher of the Atlas primary price and
  // the USD/PTC 302 fallback for every resolution the fallback supports.
  'video-2': Object.freeze({
    '480P': 6.94801152, '720P': 13.89602304, '720P-SR': 8.378,
    '1080P': 11.424, '1080P-SR': 12.947, '1440P-SR': 15.232, '4K': 19.04
  }),
  'video-3': Object.freeze({
    '480P': 8.8128, '720P': 17.6256, '720P-SR': 10.023, '720P-ESR': 10.023,
    '1080P': 13.668, '1080P-SR': 15.49, '1080P-ESR': 15.49,
    '1080P-ESR & 60FPS': 18.228, '1440P-SR': 18.224,
    '1440P-ESR': 18.224, '4K-ESR': 22.78
  }),
  'video-4': SEEDANCE_VIDEO_RATES['video-4'],
  'video-5': Object.freeze({ '480P': 2, '720P': 3 }),
  'video-6': Object.freeze({ '480P': 2, '720P': 3, '1080P': 4 }),
  'video-7': Object.freeze({ '480P': 1.5, '720P': 2.5 }),
  'video-8': Object.freeze({ '720P': 0.5, '1080P': 1 }),
  'video-9': Object.freeze({ '1080P': 2 }),
  'video-10': Object.freeze({ '720P': 18.4 }),
  'video-11': Object.freeze({ '1080P': 24.6 }),
  'video-12': Object.freeze({ '720P': 21.9 }),
  'video-13': Object.freeze({ '1080P': 26.3 })
});

export const VIDEO_DEFAULT_RESOLUTIONS = Object.freeze({
  'atlas-video-seedance20-i2v': '720P',
  'atlas-video-seedance20-ref': '720P',
  'atlas-video-seedance25-i2v': '720P',
  'atlas-video-seedance25-ref': '720P',
  'video-1': '768P',
  'video-2': '720P',
  'video-3': '720P',
  'video-4': '720P',
  'video-5': '720P',
  'video-6': '1080P',
  'video-7': '720P',
  'video-8': '720P',
  'video-9': '1080P',
  'video-10': '720P',
  'video-11': '1080P',
  'video-12': '720P',
  'video-13': '1080P'
});

export const VIDEO_DURATION_LIMITS = Object.freeze({
  'atlas-video-seedance20-i2v': Object.freeze({ minimum: 4, maximum: 15 }),
  'atlas-video-seedance20-ref': Object.freeze({ minimum: 4, maximum: 15 }),
  'atlas-video-seedance25-i2v': Object.freeze({ minimum: 4, maximum: 30 }),
  'atlas-video-seedance25-ref': Object.freeze({ minimum: 4, maximum: 30 }),
  'video-1': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-2': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-3': Object.freeze({ minimum: 4, maximum: 30 }),
  'video-4': Object.freeze({ minimum: 4, maximum: 15 }),
  'video-5': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-6': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-7': Object.freeze({ minimum: 2, maximum: 12 }),
  'video-8': Object.freeze({ minimum: 5, maximum: 10 }),
  'video-9': Object.freeze({ minimum: 5, maximum: 10 }),
  'video-10': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-11': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-12': Object.freeze({ minimum: 3, maximum: 15 }),
  'video-13': Object.freeze({ minimum: 3, maximum: 15 })
});

export const MINIMUM_VIDEO_CREDITS = 30;

export const VIDEO_SERVICE_TIER_PROVIDERS = Object.freeze({
  'video-10': Object.freeze({ standard: 'video-10', pro: 'video-11' }),
  'video-12': Object.freeze({ standard: 'video-12', pro: 'video-13' })
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

export function videoBillingProviderId(providerId, request = {}) {
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const tierProviders = VIDEO_SERVICE_TIER_PROVIDERS[normalizedProviderId];
  if (!tierProviders) return normalizedProviderId;

  const requestedTier = String(request.serviceTier || '').trim().toLowerCase();
  if (Object.hasOwn(tierProviders, requestedTier)) return tierProviders[requestedTier];

  const requestedResolution = String(request.resolution || '').trim().toUpperCase();
  const resolutionProvider = Object.values(tierProviders).find((candidateId) => (
    Object.hasOwn(VIDEO_CREDITS_PER_SECOND[candidateId] || {}, requestedResolution)
  ));
  return resolutionProvider || tierProviders.standard;
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
    const defaultResolution = resolutionRates
      ? (IMAGE_DEFAULT_RESOLUTIONS[providerId] || (Object.hasOwn(resolutionRates, '2k') ? '2k' : Object.keys(resolutionRates)[0]))
      : '720p';
    const requestedResolution = String(request.resolution || request.size || defaultResolution).trim().toLowerCase();
    const resolution = resolutionRates && Object.hasOwn(resolutionRates, requestedResolution)
      ? requestedResolution
      : defaultResolution;
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
    const requestedProviderId = String(request.providerId || 'video-1').trim().toLowerCase() || 'video-1';
    const providerId = videoBillingProviderId(requestedProviderId, request);
    const rates = VIDEO_CREDITS_PER_SECOND[providerId];
    if (!rates) {
      throw Object.assign(new Error('The selected video provider is not allowed.'), { code: 'provider-not-allowed', status: 400 });
    }
    const requestedResolution = String(request.resolution || '').trim().toUpperCase();
    const defaultResolution = VIDEO_DEFAULT_RESOLUTIONS[providerId];
    const resolution = Object.hasOwn(rates, requestedResolution) ? requestedResolution : defaultResolution;
    const durationLimits = VIDEO_DURATION_LIMITS[providerId] || VIDEO_DURATION_LIMITS['video-1'];
    const requestedDuration = Number(request.duration);
    // Atlas edit/extend and auto-duration tasks do not reveal their final
    // length before submission. Reserve against the maximum supported length
    // so a completed job can never exceed the customer's reservation.
    const duration = requestedDuration === -1
      ? durationLimits.maximum
      : boundedInteger(request.duration, 6, durationLimits.minimum, durationLimits.maximum);
    return {
      kind: 'video',
      providerId,
      credits: Math.max(MINIMUM_VIDEO_CREDITS, Math.ceil(rates[resolution] * duration + PROFIT_PER_REQUEST_CREDITS)),
      unitCredits: rates[resolution],
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

export async function quoteUsageForUser(userId, kind, request = {}, fetchImpl = fetch) {
  void userId;
  void fetchImpl;
  return quoteUsage(kind, request);
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
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) {
      throw serviceError('credit-service-not-configured', 'Durable credit enforcement is not configured.');
    }
    return { ok: true, reason: 'development-bypass', ...quoteUsage(kind, request), developmentBypass: true };
  }
  // Every account uses the same quote. Supabase independently recomputes the
  // total and a mismatch fails closed during rolling deployments.
  const quote = quoteUsage(kind, request);

  let requestBody = JSON.stringify({
    p_user_id: userId,
    p_kind: quote.kind,
    p_provider_id: quote.providerId,
    p_request_id: requestId,
    p_resolution: quote.resolution,
    p_duration: quote.duration,
    p_expected_credits: quote.credits
  });
  const reserveRpc = (quote.providerId.startsWith('atlas-') || ['image-6', 'video-2', 'video-3'].includes(quote.providerId))
    ? 'reserve_atlas_catalog_credits'
    : ['video-10', 'video-11', 'video-12', 'video-13'].includes(quote.providerId)
    ? 'reserve_kling_video_credits'
    : (['image-1', 'image-2', 'image-5', 'image-9'].includes(quote.providerId)
    ? 'reserve_nano_banana_credits'
    : (['image-7', 'image-8'].includes(quote.providerId)
      ? 'reserve_higgsfield_credits'
      : (['image-17', 'image-18'].includes(quote.providerId)
        ? 'reserve_legnext_credits'
        : (['image-3', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16',
          'video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9',
          'video-10', 'video-11', 'video-12', 'video-13'].includes(quote.providerId)
          ? 'reserve_302_catalog_credits'
          : 'reserve_ai_credits'))));
  let { response, payload } = await reserveCredits(headers, requestBody, fetchImpl, reserveRpc);
  if (response.ok && payload && payload.ok === false && payload.reason === 'pricing-mismatch'
      && Number.isInteger(Number(payload.credits)) && Number(payload.credits) >= 0) {
    requestBody = JSON.stringify({
      p_user_id: userId, p_kind: quote.kind, p_provider_id: quote.providerId,
      p_request_id: requestId, p_resolution: quote.resolution, p_duration: quote.duration,
      p_expected_credits: Number(payload.credits)
    });
    ({ response, payload } = await reserveCredits(headers, requestBody, fetchImpl, reserveRpc));
  }
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
  const isTopaz = TOPAZ_DYNAMIC_PROVIDERS.has(providerId);
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
  let requestOptions = {
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
      const rpcName = isTopaz && providerId !== 'topaz-video-upscale'
        ? 'reserve_topaz_image_credits'
        : 'reserve_ai_tool_credits';
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
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
  if (response.ok && payload && payload.ok === false && payload.reason === 'pricing-mismatch'
      && Number.isInteger(Number(payload.credits)) && Number(payload.credits) >= 0) {
    requestOptions = {
      ...requestOptions,
      body: JSON.stringify({
        p_user_id: userId, p_request_id: requestId, p_provider_id: providerId,
        p_credits: Number(payload.credits), p_provider_cost: providerCost,
        p_resolution: resolution, p_duration: duration
      })
    };
    const rpcName = isTopaz && providerId !== 'topaz-video-upscale'
      ? 'reserve_topaz_image_credits' : 'reserve_ai_tool_credits';
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      ...requestOptions, signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
    });
    payload = await responsePayload(response);
  }
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
    credits: Number.isFinite(Number(result.credits)) ? Number(result.credits) : credits,
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
  return publicCreditAccount(payload);
}

function publicCreditAccount(account = {}) {
  const balance = nonnegativeNumber(account.balance);
  const reserved = nonnegativeNumber(account.reserved);
  return {
    balance,
    reserved,
    availableCredits: nonnegativeNumber(account.availableCredits ?? Math.max(0, balance - reserved)),
    overseasUnlocked: account.overseasUnlocked === true,
    membershipTier: String(account.membershipTier || 'free').trim().slice(0, 40) || 'free',
    updatedAt: String(account.updatedAt || '').slice(0, 40)
  };
}

function normalizeUsageRange(value) {
  const normalized = String(value || '7d').trim().toLowerCase();
  if (normalized === '7' || normalized === '7d') return '7d';
  if (normalized === '30' || normalized === '30d') return '30d';
  if (normalized === 'all') return 'all';
  throw Object.assign(new Error('The usage range is invalid.'), { code: 'invalid-usage-range', status: 400 });
}

function normalizeUsageDateRange(value = {}) {
  const from = String(value && value.from || '').slice(0, 10);
  const to = String(value && value.to || '').slice(0, 10);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (!datePattern.test(from) || !datePattern.test(to) || from > to
      || !Number.isFinite(fromTime) || !Number.isFinite(toTime)
      || new Date(fromTime).toISOString().slice(0, 10) !== from
      || new Date(toTime).toISOString().slice(0, 10) !== to
      || (toTime - fromTime) / 86_400_000 > 3660) {
    throw Object.assign(new Error('The custom usage date range is invalid.'), { code: 'invalid-usage-range', status: 400 });
  }
  const timeZoneOffset = Math.max(-840, Math.min(840, Math.round(Number(value.timeZoneOffset) || 0)));
  return { from, to, timeZoneOffset };
}

function normalizeCanvasId(value) {
  const canvasId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(canvasId)) {
    throw Object.assign(new Error('The canvas identity is invalid.'), { code: 'invalid-canvas-id', status: 400 });
  }
  return canvasId;
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
    range: payload.range === 'custom' || fallbackRange && typeof fallbackRange === 'object'
      ? 'custom'
      : normalizeUsageRange(payload.range || fallbackRange),
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
  const customRange = range && typeof range === 'object' && !Array.isArray(range)
    ? normalizeUsageDateRange(range)
    : null;
  const normalizedRange = customRange || normalizeUsageRange(range);
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) throw serviceError('credit-service-not-configured', 'Durable usage reporting is not configured.');
    return null;
  }
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${customRange ? 'get_ai_usage_summary_between' : 'get_ai_usage_summary'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(customRange
      ? {
          p_user_id: userId,
          p_from: customRange.from,
          p_to: customRange.to,
          p_tz_offset: customRange.timeZoneOffset
        }
      : { p_user_id: userId, p_range: normalizedRange }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'usage-service-failed';
    throw serviceError(code, 'Could not load AI usage.');
  }
  return publicUsageSummary(payload, normalizedRange);
}

export async function tagUsageCanvas(userId, requestId, canvasId, fetchImpl = fetch) {
  let normalizedCanvasId;
  try { normalizedCanvasId = normalizeCanvasId(canvasId); }
  catch (error) { return { ok: false, reason: error.code || 'invalid-canvas-id' }; }
  const headers = serviceHeaders();
  if (!headers) return { ok: !durableRequired(), reason: 'not-configured' };
  try {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/set_ai_usage_canvas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_user_id: userId, p_request_id: requestId, p_canvas_id: normalizedCanvasId }),
      signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      return { ok: false, reason: isMissingCreditRpc(response, payload) ? 'schema-missing' : 'usage-service-failed' };
    }
    return { ok: payload === true || payload && payload.ok === true, reason: 'tagged' };
  } catch (error) {
    return { ok: false, reason: 'usage-service-failed' };
  }
}

export async function getCanvasUsage(userId, canvasId, fetchImpl = fetch) {
  const normalizedCanvasId = normalizeCanvasId(canvasId);
  const headers = serviceHeaders();
  if (!headers) {
    if (durableRequired()) throw serviceError('credit-service-not-configured', 'Durable usage reporting is not configured.');
    return null;
  }
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_canvas_ai_usage_summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId, p_canvas_id: normalizedCanvasId }),
    signal: AbortSignal.timeout(DURABLE_TIMEOUT_MS)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const code = isMissingCreditRpc(response, payload) ? 'credit-schema-missing' : 'usage-service-failed';
    throw serviceError(code, 'Could not load canvas usage.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('usage-service-failed', 'The canvas usage service returned an invalid response.');
  }
  return {
    canvasId: normalizedCanvasId,
    totals: {
      credits: nonnegativeNumber(payload.totals && payload.totals.credits),
      generations: nonnegativeNumber(payload.totals && payload.totals.generations)
    },
    // The database has already materialized this authenticated user's canvas
    // history. Do not truncate it here: the desktop merges these request IDs
    // with its append-only ledger to calculate a lifetime, de-duplicated total.
    details: (Array.isArray(payload.details) ? payload.details : []).map((row = {}) => ({
      requestId: String(row.requestId || '').trim().slice(0, 80),
      kind: ['image', 'video', '3d'].includes(row.kind) ? row.kind : 'image',
      providerId: String(row.providerId || '').trim().toLowerCase().slice(0, 64),
      modelName: String(row.modelName || '').trim().slice(0, 160),
      name: String(row.name || '').trim().slice(0, 240),
      credits: nonnegativeNumber(row.credits),
      resolution: String(row.resolution || '').trim().slice(0, 32) || null,
      duration: nonnegativeNumber(row.duration),
      createdAt: String(row.createdAt || '').slice(0, 40)
    })).filter((row) => row.requestId)
  };
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
  return {
    ok: payload.ok === true,
    reason: String(payload.reason || '').slice(0, 40),
    creditsAdded: nonnegativeNumber(payload.creditsAdded),
    ...(payload.account && typeof payload.account === 'object' && !Array.isArray(payload.account)
      ? { account: publicCreditAccount(payload.account) }
      : {})
  };
}
