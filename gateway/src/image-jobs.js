import crypto from 'node:crypto';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const RPC_TIMEOUT_MS = 8_000;

function serviceError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function schemaMissingError() {
  return serviceError(
    'image-job-schema-missing',
    'Durable image task recovery has not been installed on the gateway.'
  );
}

function serviceHeaders() {
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) throw serviceError('image-job-service-not-configured', 'The image recovery service is not configured.');
  return {
    apikey: secret,
    ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }),
    'Content-Type': 'application/json'
  };
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key]);
    return result;
  }
  return null;
}

export function hashImageRequest(body) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalValue(body && typeof body === 'object' ? body : {})), 'utf8')
    .digest('hex');
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function rpc(name, body, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    let payload;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: serviceHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
      });
      payload = await responsePayload(response);
    } catch (error) {
      if (error && error.code === 'image-job-service-not-configured') throw error;
      if (attempt === 2) {
        throw serviceError('image-job-service-failed', 'The image recovery service is temporarily unavailable.');
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      continue;
    }
    const missing = response.status === 404 || ['PGRST202', '42883'].includes(String(payload && payload.code || ''));
    if (missing) return { ok: false, reason: 'schema-missing' };
    const retryable = response.status === 429 || response.status >= 500;
    if (!response.ok && retryable && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw serviceError('image-job-service-failed', 'The image recovery service rejected the request.');
    return payload;
  }
  throw serviceError('image-job-service-failed', 'The image recovery service is temporarily unavailable.');
}

function normalizeJob(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return {
    ok: row.ok !== false,
    reason: String(row.reason || ''),
    requestId: String(row.requestId || row.request_id || ''),
    userId: String(row.userId || row.user_id || ''),
    requestHash: String(row.requestHash || row.request_hash || ''),
    providerId: String(row.providerId || row.provider_id || ''),
    providerTaskId: String(row.providerTaskId || row.provider_task_id || ''),
    pollUrl: String(row.pollUrl || row.poll_url || ''),
    resultUrl: String(row.resultUrl || row.result_url || ''),
    status: String(row.status || ''),
    creditsReserved: Math.max(0, Number(row.creditsReserved ?? row.credits_reserved) || 0),
    deadlineAt: String(row.deadlineAt || row.deadline_at || ''),
    errorCode: String(row.errorCode || row.error_code || ''),
    errorMessage: String(row.errorMessage || row.error_message || '')
  };
}

function safeResultReference(value) {
  const reference = String(value || '').trim();
  if (/^https:\/\/[^\s]{1,2000}$/i.test(reference)) return reference;
  if (/^storage:\/\/messs-ai-image-results\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|avif)$/i.test(reference)) {
    return reference.toLowerCase();
  }
  return '';
}

export async function getImageJob(userId, requestId, fetchImpl = fetch) {
  const payload = await rpc('get_ai_image_job', {
    p_user_id: userId,
    p_request_id: requestId
  }, fetchImpl);
  if (!payload || payload.ok === false && String(payload.reason || '') === 'not-found') return null;
  if (payload && payload.ok === false && String(payload.reason || '') === 'schema-missing') {
    throw schemaMissingError();
  }
  return normalizeJob(payload);
}

export async function claimImageJob({
  userId,
  requestId,
  requestHash,
  providerId,
  deadlineAt
}, fetchImpl = fetch) {
  const payload = await rpc('claim_ai_image_job', {
    p_user_id: userId,
    p_request_id: requestId,
    p_request_hash: String(requestHash || '').slice(0, 128),
    p_provider_id: String(providerId || '').trim().toLowerCase().slice(0, 64),
    p_deadline_at: deadlineAt || null
  }, fetchImpl);
  if (!payload || payload.ok !== true) {
    if (payload && payload.reason === 'schema-missing') throw schemaMissingError();
    throw serviceError('image-job-record-failed', 'The image task could not be claimed safely.');
  }
  return normalizeJob(payload);
}

export async function recordImageProviderTask({
  userId,
  requestId,
  requestHash,
  providerId,
  providerTaskId,
  pollUrl,
  deadlineAt
}, fetchImpl = fetch) {
  const payload = await rpc('record_ai_image_provider_task', {
    p_user_id: userId,
    p_request_id: requestId,
    p_request_hash: String(requestHash || '').slice(0, 128),
    p_provider_id: String(providerId || '').trim().toLowerCase().slice(0, 64),
    p_provider_task_id: String(providerTaskId || '').trim().slice(0, 512),
    p_poll_url: /^https:\/\/[^\s]{1,2000}$/i.test(String(pollUrl || '').trim())
      ? String(pollUrl).trim()
      : '',
    p_deadline_at: deadlineAt || null
  }, fetchImpl);
  if (!payload || payload.ok !== true) {
    if (payload && payload.reason === 'schema-missing') throw schemaMissingError();
    throw serviceError('image-job-record-failed', 'The accepted image task could not be recorded safely.');
  }
  return normalizeJob(payload);
}

export async function recordImageProviderResult(userId, requestId, resultUrl, fetchImpl = fetch) {
  const resultReference = safeResultReference(resultUrl);
  if (!resultReference) {
    throw serviceError('image-job-record-failed', 'The image result reference is invalid.');
  }
  const payload = await rpc('record_ai_image_provider_result', {
    p_user_id: userId,
    p_request_id: requestId,
    p_result_url: resultReference
  }, fetchImpl);
  if (!payload || payload.ok !== true) {
    if (payload && payload.reason === 'schema-missing') throw schemaMissingError();
    throw serviceError('image-job-record-failed', 'The image result could not be recorded safely.');
  }
  return normalizeJob(payload);
}

export async function failImageJob(userId, requestId, error, fetchImpl = fetch) {
  const rawCode = String(error && error.code || 'image-generation-failed').trim().toLowerCase();
  const code = /^[a-z0-9][a-z0-9-]{0,63}$/.test(rawCode) ? rawCode : 'image-generation-failed';
  const message = String(error && error.message || 'Image generation failed.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const payload = await rpc('fail_ai_image_job', {
    p_user_id: userId,
    p_request_id: requestId,
    p_error_code: code,
    p_error_message: message || 'Image generation failed.'
  }, fetchImpl);
  if (!payload || payload.ok !== true) {
    if (payload && payload.reason === 'schema-missing') throw schemaMissingError();
    throw serviceError('image-job-record-failed', 'The image task failure could not be recorded safely.');
  }
  return normalizeJob(payload);
}
