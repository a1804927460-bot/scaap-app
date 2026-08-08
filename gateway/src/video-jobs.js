import crypto from 'node:crypto';
import { quoteUsage } from './usage.js';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const RPC_TIMEOUT_MS = 8_000;
const ACTIVE_PROVIDER_STATES = new Set([
  'created', 'creating', 'pending', 'queued', 'queueing', 'preparing',
  'processing', 'running', 'submitted', 'in_progress'
]);
const SUCCESS_PROVIDER_STATES = new Set(['success', 'succeeded', 'completed']);
const FAILURE_PROVIDER_STATES = new Set(['fail', 'failed', 'cancelled', 'canceled', 'expired']);

function serviceError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function serviceHeaders() {
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) throw serviceError('video-job-service-not-configured', 'The asynchronous video service is not configured.');
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
    for (const key of Object.keys(value).sort()) {
      if (['undefined', 'function', 'symbol'].includes(typeof value[key])) continue;
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  return null;
}

export function canonicalRequestBody(body) {
  return JSON.stringify(canonicalValue(body && typeof body === 'object' ? body : {}));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashVideoTaskToken(taskToken) {
  const token = String(taskToken || '');
  if (token.length < 16 || token.length > 512) {
    throw Object.assign(new Error('The video task token is invalid.'), { code: 'invalid-video-task-token', status: 400 });
  }
  return sha256(token);
}

export function hashVideoRequest(body) {
  return sha256(canonicalRequestBody(body));
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (error) { return null; }
}

async function rpc(name, body, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
  } catch (error) {
    throw serviceError('video-job-service-failed', 'The asynchronous video service is temporarily unavailable.');
  }
  const payload = await responsePayload(response);
  if (!response.ok) {
    const missing = response.status === 404 || ['PGRST202', '42883'].includes(String(payload && payload.code || ''));
    throw serviceError(
      missing ? 'video-job-schema-missing' : 'video-job-service-failed',
      missing ? 'The asynchronous video schema is not installed.' : 'The asynchronous video service rejected the request.'
    );
  }
  return payload;
}

function requireObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw serviceError('video-job-service-failed', 'The asynchronous video service returned an invalid response.');
  }
  return payload;
}

export async function startVideoJob({ userId, operationId, taskToken, body = {}, fetchImpl = fetch }) {
  const quote = quoteUsage('video', body);
  const payload = requireObject(await rpc('start_ai_video_job', {
    p_request_id: operationId,
    p_user_id: userId,
    p_token_hash: hashVideoTaskToken(taskToken),
    p_request_hash: hashVideoRequest(body),
    p_provider_id: quote.providerId,
    p_resolution: quote.resolution,
    p_duration: quote.duration,
    p_aspect_ratio: String(body.aspectRatio || '16:9').slice(0, 16),
    p_expected_credits: quote.credits
  }, fetchImpl));
  return {
    ...payload,
    created: payload.ok === true && payload.reason === 'reserved',
    taskToken: payload.ok === true ? taskToken : undefined,
    credits: Number(payload.credits) || quote.credits,
    status: String(payload.status || (payload.ok === true ? 'starting' : ''))
  };
}

export async function attachVideoTask(requestId, providerTaskId, fetchImpl = fetch) {
  return requireObject(await rpc('attach_ai_video_provider_task', {
    p_request_id: requestId,
    p_provider_task_id: String(providerTaskId || '').trim()
  }, fetchImpl));
}

function normalizedClaim(row) {
  return {
    requestId: String(row.request_id || row.requestId || ''),
    providerId: String(row.provider_id || row.providerId || ''),
    providerTaskId: String(row.provider_task_id || row.providerTaskId || ''),
    status: String(row.status || ''),
    attemptCount: Math.max(0, Number(row.attempt_count ?? row.attemptCount) || 0),
    leaseToken: String(row.lease_token || row.leaseToken || ''),
    deadlineAt: String(row.deadline_at || row.deadlineAt || ''),
    createdAt: String(row.created_at || row.createdAt || '')
  };
}

export async function claimDueVideoJobs(workerId, limit = 4, leaseSeconds = 60, fetchImpl = fetch) {
  const payload = await rpc('claim_due_ai_video_jobs', {
    p_worker_id: String(workerId || '').slice(0, 128),
    p_limit: Math.max(1, Math.min(25, Math.round(Number(limit) || 4))),
    p_lease_seconds: Math.max(10, Math.min(300, Math.round(Number(leaseSeconds) || 60)))
  }, fetchImpl);
  if (!Array.isArray(payload)) throw serviceError('video-job-service-failed', 'The video job claim response is invalid.');
  return payload.map(normalizedClaim);
}

const SECRET_PATTERNS = [
  /\bBearer\s+[^\s]+/gi,
  /\b(?:sk|sb_secret|ghp|github_pat)[-_A-Za-z0-9]{8,}\b/gi,
  /([?&](?:key|token|signature|secret)=)[^&\s]+/gi
];

export function sanitizeVideoJobError(error, fallbackCode = 'video-generation-failed') {
  const rawCode = String(error && error.code || fallbackCode).trim().toLowerCase();
  const code = (/^[a-z0-9][a-z0-9-]{0,63}$/.test(rawCode) ? rawCode : fallbackCode).slice(0, 64);
  let message = String(error && error.message || 'Video generation failed.')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const pattern of SECRET_PATTERNS) message = message.replace(pattern, '[redacted]');
  if (!message || message.length > 300) message = message.slice(0, 300) || 'Video generation failed.';
  return { code, message };
}

export async function rescheduleVideoJob(requestId, leaseToken, delayMs, error = null, fetchImpl = fetch) {
  const safeError = error ? sanitizeVideoJobError(error, 'video-provider-retry') : { code: null, message: null };
  const payload = requireObject(await rpc('reschedule_ai_video_job', {
    p_request_id: requestId,
    p_lease_token: leaseToken,
    p_delay_seconds: Math.max(3, Math.min(300, Math.ceil((Number(delayMs) || 10_000) / 1000))),
    p_error_code: safeError.code,
    p_error_message: safeError.message
  }, fetchImpl));
  if (payload.ok !== true) throw serviceError('video-job-reschedule-failed', 'The video job lease could not be rescheduled.', 409);
  return payload;
}

export async function finalizeVideoJob({
  requestId,
  leaseToken = null,
  status,
  resultUrl = null,
  contentType = null,
  bytes = null,
  error = null,
  durationMs = 0,
  fetchImpl = fetch
}) {
  const normalizedStatus = status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : '';
  if (!normalizedStatus) {
    throw Object.assign(new Error('The final video job status is invalid.'), { code: 'invalid-video-job-status', status: 400 });
  }
  const safeError = normalizedStatus === 'failed' ? sanitizeVideoJobError(error) : { code: null, message: null };
  const payload = requireObject(await rpc('finalize_ai_video_job', {
    p_request_id: requestId,
    p_lease_token: leaseToken || null,
    p_status: normalizedStatus,
    p_result_url: normalizedStatus === 'succeeded' ? String(resultUrl || '') : null,
    p_result_content_type: normalizedStatus === 'succeeded' ? String(contentType || 'video/mp4').slice(0, 128) : null,
    p_result_bytes: normalizedStatus === 'succeeded' && Number.isFinite(Number(bytes)) ? Math.max(0, Math.round(Number(bytes))) : null,
    p_error_code: safeError.code,
    p_error_message: safeError.message,
    p_duration_ms: Math.max(0, Math.round(Number(durationMs) || 0))
  }, fetchImpl));
  if (payload.ok !== true) {
    throw serviceError('video-job-finalization-failed', 'The video job could not be finalized.');
  }
  if (String(payload.status || '') !== normalizedStatus) {
    throw serviceError('video-job-status-mismatch', 'The video job and credit settlement statuses do not match.', 409);
  }
  return payload;
}

export async function getVideoJob(userId, taskToken, fetchImpl = fetch) {
  return requireObject(await rpc('get_ai_video_job_owner_status', {
    p_user_id: userId,
    p_token_hash: hashVideoTaskToken(taskToken)
  }, fetchImpl));
}

export async function getVideoDownload(userId, taskToken, fetchImpl = fetch) {
  return requireObject(await rpc('get_ai_video_job_download', {
    p_user_id: userId,
    p_token_hash: hashVideoTaskToken(taskToken)
  }, fetchImpl));
}

function providerStatus(result) {
  return String(result && (result.status || result.state || result.task && result.task.status) || '').trim().toLowerCase();
}

function retryDelayMs(attemptCount, errorOrResult = null) {
  const supplied = Number(errorOrResult && (errorOrResult.retryAfterMs ?? errorOrResult.retry_after_ms));
  if (Number.isFinite(supplied) && supplied > 0) return Math.max(3_000, Math.min(300_000, supplied));
  return Math.min(120_000, 10_000 * (2 ** Math.min(4, Math.max(0, attemptCount))));
}

function providerPollDelayMs(result) {
  const supplied = Number(result && (result.retryAfterMs ?? result.retry_after_ms));
  if (Number.isFinite(supplied) && supplied > 0) return Math.max(3_000, Math.min(300_000, supplied));
  return 10_000;
}

function retryableProviderError(error) {
  const status = Number(error && error.status);
  const name = String(error && error.name || '');
  return error && error.retryable === true
    || status === 408
    || status === 425
    || status === 429
    || status >= 500
    || ['AbortError', 'TimeoutError', 'TypeError'].includes(name);
}

async function processClaimedJob(job, pollVideoTask, fetchImpl, now) {
  const jobStartedAt = new Date(job.createdAt).getTime();
  const elapsedMs = () => Math.max(0, Date.now() - (Number.isFinite(jobStartedAt) ? jobStartedAt : Date.now()));
  if (!job.deadlineAt || new Date(job.deadlineAt).getTime() <= now()) {
    await finalizeVideoJob({
      requestId: job.requestId,
      leaseToken: job.leaseToken,
      status: 'failed',
      error: { code: 'video-generation-timeout', message: 'Video generation timed out.' },
      durationMs: elapsedMs(),
      fetchImpl
    });
    return 'failed';
  }
  try {
    const result = await pollVideoTask(job);
    const status = providerStatus(result);
    if (SUCCESS_PROVIDER_STATES.has(status)) {
      const resultUrl = String(result && (
        result.url || result.resultUrl || result.result_url
        || result.task && result.task.content && result.task.content.url
      ) || '');
      if (!/^https:\/\//i.test(resultUrl)) {
        await finalizeVideoJob({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          status: 'failed',
          error: { code: 'video-provider-result-invalid', message: 'The video provider did not return a usable result.' },
          durationMs: elapsedMs(),
          fetchImpl
        });
        return 'failed';
      }
      await finalizeVideoJob({
        requestId: job.requestId,
        leaseToken: job.leaseToken,
        status: 'succeeded',
        resultUrl,
        contentType: result && (result.contentType || result.content_type),
        bytes: result && result.bytes,
        durationMs: elapsedMs(),
        fetchImpl
      });
      return 'succeeded';
    }
    if (FAILURE_PROVIDER_STATES.has(status)) {
      await finalizeVideoJob({
        requestId: job.requestId,
        leaseToken: job.leaseToken,
        status: 'failed',
        error: result && (
          result.error || result.task && result.task.error
          || { code: result.errorCode, message: result.errorMessage }
        ),
        durationMs: elapsedMs(),
        fetchImpl
      });
      return 'failed';
    }
    if (!status || ACTIVE_PROVIDER_STATES.has(status)) {
      await rescheduleVideoJob(job.requestId, job.leaseToken, providerPollDelayMs(result), null, fetchImpl);
      return 'pending';
    }
    await finalizeVideoJob({
      requestId: job.requestId,
      leaseToken: job.leaseToken,
      status: 'failed',
      error: { code: 'video-provider-status-invalid', message: 'The video provider returned an unsupported task status.' },
      durationMs: elapsedMs(),
      fetchImpl
    });
    return 'failed';
  } catch (error) {
    if (retryableProviderError(error)) {
      await rescheduleVideoJob(job.requestId, job.leaseToken, retryDelayMs(job.attemptCount, error), error, fetchImpl);
      return 'pending';
    }
    await finalizeVideoJob({
      requestId: job.requestId,
      leaseToken: job.leaseToken,
      status: 'failed',
      error,
      durationMs: elapsedMs(),
      fetchImpl
    });
    return 'failed';
  }
}

export async function runVideoJobWorkerCycle({
  pollVideoTask,
  fetchImpl = fetch,
  workerId = `gateway-${process.pid}`,
  concurrency = 4,
  leaseSeconds = 60,
  now = Date.now
} = {}) {
  if (typeof pollVideoTask !== 'function') throw new TypeError('pollVideoTask must be a function.');
  const jobs = await claimDueVideoJobs(workerId, concurrency, leaseSeconds, fetchImpl);
  const results = await Promise.allSettled(jobs.map((job) => processClaimedJob(job, pollVideoTask, fetchImpl, now)));
  return {
    claimed: jobs.length,
    succeeded: results.filter((result) => result.status === 'fulfilled' && result.value === 'succeeded').length,
    failed: results.filter((result) => result.status === 'fulfilled' && result.value === 'failed').length,
    pending: results.filter((result) => result.status === 'fulfilled' && result.value === 'pending').length,
    errors: results.filter((result) => result.status === 'rejected').length
  };
}

export function startVideoJobWorker(options = {}) {
  const intervalMs = Math.max(3_000, Math.min(60_000, Math.round(Number(options.intervalMs) || 5_000)));
  let stopped = false;
  let schemaUnavailable = false;
  let running = null;
  const runNow = () => {
    if (stopped || schemaUnavailable) return Promise.resolve(null);
    if (running) return running;
    running = runVideoJobWorkerCycle(options).finally(() => { running = null; });
    return running;
  };
  const reportError = (error) => {
    if (error && error.code === 'video-job-schema-missing') {
      schemaUnavailable = true;
      clearInterval(timer);
    }
    if (typeof options.onError === 'function') options.onError(error);
  };
  const timer = setInterval(() => { void runNow().catch(reportError); }, intervalMs);
  timer.unref();
  void runNow().catch(reportError);
  return {
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
