import crypto from 'node:crypto';
import {
  deleteAi302RelayAsset,
  parseImageDataUrl,
  storeAi302RelayAsset,
  stripImageMetadata,
  validateAssetUrl,
  validatePng
} from './ai302-tools.js';
import {
  AI302_PRIMARY_ROUTE_ID,
  ai302RouteUrl,
  getAi302Routes,
  hasSafeFallbackStatus
} from './tool-routes.js';

const API_ORIGIN = 'https://api.302.ai';
const QWEN_EDIT_PATH = '/302/submit/qwen-image-edit-plus';
const QWEN_LAYERED_PATH = '/302/submit/qwen-image-layered';
const SUPER_UPSCALE_PATH = '/302/submit/super-upscale-v2';
const ERASE_PATH = '/302/submit/erase';
const SEED_EDIT_PATH = '/doubao/drawing/seededit_v30';
const SEED_EDIT_RESULT_PATH = '/doubao/drawing/seededit_v30_result';
const KLING_EXPAND_PATH = '/klingai/v1/images/editing/expand';
const CLIPDROP_UNCROP_PATH = '/clipdrop/uncrop/v1';
const CLEANUP_PATH = '/clipdrop/cleanup/v1';
const CLIPDROP_UPSCALE_PATH = '/clipdrop/image-upscaling/v1/upscale';
const TOPAZ_IMAGE_PATHS = Object.freeze({
  'topaz-image-sharpen': '/topazlabs/image/v1/sharpen/async',
  'topaz-image-sharpen-gen': '/topazlabs/image/v1/sharpen-gen/async',
  'topaz-image-enhance': '/topazlabs/image/v1/enhance/async',
  'topaz-image-enhance-gen': '/topazlabs/image/v1/enhance-gen/async',
  'topaz-image-denoise': '/topazlabs/image/v1/denoise/async',
  'topaz-image-restore': '/topazlabs/image/v1/restore-gen/async',
  'topaz-image-lighting': '/topazlabs/image/v1/lighting/async'
});
const TOPAZ_STATUS_PATH = '/topazlabs/image/v1/status';
const TOPAZ_DOWNLOAD_PATH = '/topazlabs/image/v1/download';
// Documented image responses can consume up to six Topaz credits. Reserve the
// complete ceiling before contacting the provider and retain it on success.
export const TOPAZ_IMAGE_PROVIDER_CREDIT_RESERVE = 6;
const REQUEST_TIMEOUT_MS = 2 * 60_000;
const LONG_RUNNING_REQUEST_TIMEOUT_MS = 10 * 60_000;
const STATUS_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;
const MAX_INPUT_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_EDIT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_EDIT_IMAGES = 4;
const MAX_RESULT_IMAGES = 8;
const TASK_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
const TASK_TOKEN_AAD = Buffer.from('messs:ai302-image-task:v1', 'utf8');
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
const ASYNC_PROVIDERS = new Set([
  'seededit-v3',
  'kling-image-expand',
  'qwen-image-edit-plus',
  'qwen-image-layered',
  ...Object.keys(TOPAZ_IMAGE_PATHS)
]);
const QUEUED_STATES = new Set(['CREATED', 'IN_QUEUE', 'PENDING', 'QUEUED', 'QUEUEING', 'WAIT', 'WAITING', 'SUBMITTED']);
const PROCESSING_STATES = new Set(['PROCESSING', 'RUNNING', 'RUN', 'IN_PROGRESS', 'GENERATING']);
const SUCCESS_STATES = new Set(['DONE', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'FINISHED']);
const FAILURE_STATES = new Set(['FAIL', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED']);
const PRIVATE_INPUT_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk[-_][A-Za-z0-9_-]{8,}\b/i,
  /\b(?:ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i,
  /\b(?:postgres|postgresql|mysql):\/\/[^\s:/]+:[^\s@]+@/i
];

function imageToolError(code, message, status = 500) {
  return Object.assign(new Error(message), { code, status });
}

function configuredApiKey(explicitKey) {
  const key = String(explicitKey ?? process.env.AI302_KEY ?? process.env.AI_302_API_KEY ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '');
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) {
    throw imageToolError('ai302-not-configured', 'The 302 tool gateway is not configured.', 503);
  }
  return key;
}

function configuredTaskSecret(apiKey, explicitSecret) {
  const secret = String(explicitSecret ?? process.env.AI302_TASK_SECRET ?? apiKey).trim();
  if (!secret || secret.length > 8192 || /[\r\n]/.test(secret)) {
    throw imageToolError('ai302-not-configured', 'The 302 task-token secret is invalid.', 503);
  }
  return crypto
    .createHash('sha256')
    .update('messs:ai302-image-task-secret:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function composedSignal(timeoutMs, signal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function limitedBuffer(response, maximum) {
  const contentLength = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw imageToolError('tool-result-too-large', 'The tool result exceeds the supported size.', 502);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (total > maximum) {
      await response.body.cancel().catch(() => {});
      throw imageToolError('tool-result-too-large', 'The tool result exceeds the supported size.', 502);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
}

async function readUpstreamErrorHint(response) {
  try {
    const bytes = await limitedBuffer(response, MAX_UPSTREAM_ERROR_BYTES);
    return bytes.toString('utf8').slice(0, MAX_UPSTREAM_ERROR_BYTES);
  } catch {
    return '';
  }
}

function classifyUpstreamFailure(status, body) {
  const text = String(body || '');
  if (/copyright|copyrighted|restricted|sensitive|safety|moderation|content\s+filter|prohibited|policy/i.test(text)) {
    return { code: 'reference-policy-rejected', status: 400, safeToFallback: false };
  }
  if (status === 401 || status === 403 || /invalid\s+(?:api\s*)?key|unauthorized|forbidden|authentication/i.test(text)) {
    return { code: 'ai302-unauthorized', status: 503, safeToFallback: false };
  }
  if (status === 402 || /insufficient\s+(?:balance|credit)|balance\s+(?:is\s+)?(?:insufficient|exhausted)|payment\s+required|quota\s+exhausted/i.test(text)) {
    return { code: 'ai302-balance-exhausted', status: 402, safeToFallback: true };
  }
  if (status === 429 || /rate.?limit|too\s+many\s+(?:requests|users)|capacity|overloaded|queue\s+full|saturated/i.test(text)) {
    return { code: 'ai302-rate-limited', status: 429, safeToFallback: true };
  }
  if (/channel|route|service|model/.test(text.toLowerCase())
      && /unavailable|not\s+available|configuration|disabled|temporarily\s+busy|no\s+available/i.test(text)) {
    return { code: 'provider-channel-unavailable', status: 503, safeToFallback: true };
  }
  return { code: 'ai302-upstream-error', status: 502, safeToFallback: false };
}

async function upstreamFailure(response) {
  const classification = classifyUpstreamFailure(response.status, await readUpstreamErrorHint(response));
  const error = imageToolError(classification.code, classification.code === 'reference-policy-rejected'
    ? 'The reference media may contain copyrighted or restricted content.'
    : classification.code === 'ai302-rate-limited'
      ? 'The generation service is busy. Try again shortly.'
      : classification.code === 'provider-channel-unavailable'
        ? 'The generation channel is temporarily unavailable.'
        : classification.code === 'ai302-balance-exhausted'
          ? 'The generation service is temporarily unavailable.'
          : classification.code === 'ai302-unauthorized'
            ? 'The generation service credential was rejected.'
            : 'The generation service rejected the request.', classification.status);
  error.upstreamStatus = response.status;
  error.safeToFallback = hasSafeFallbackStatus(response.status) || classification.safeToFallback;
  return error;
}

function providerTransportFailure(error) {
  const timedOut = error && (
    error.name === 'TimeoutError'
    || error.code === 'ABORT_ERR'
    || error.cause && error.cause.name === 'TimeoutError'
  );
  return timedOut
    ? imageToolError(
      'ai302-timeout',
      'The 302 tool is still processing or did not respond in time. The same request will not be submitted again automatically.',
      504
    )
    : imageToolError('ai302-unavailable', 'The 302 tool service is temporarily unavailable.', 503);
}

function markSubmissionAmbiguous(error, dependencies) {
  if (dependencies && dependencies.submission === true && error && typeof error === 'object') {
    error.submissionAmbiguous = true;
  }
  return error;
}

async function fetch302Json(path, init, dependencies) {
  const routes = Array.isArray(dependencies.routes) && dependencies.routes.length
    ? dependencies.routes
    : getAi302Routes({ apiKey: dependencies.apiKey, routeId: dependencies.routeId });
  let lastError;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    let response;
    try {
      response = await dependencies.fetchImpl(ai302RouteUrl(route, path), {
        ...init,
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          Accept: 'application/json',
          ...(dependencies.submission === true && dependencies.requestId
            ? {
                'Idempotency-Key': dependencies.requestId,
                'X-Request-Id': dependencies.requestId
              }
            : {}),
          ...(init.headers || {})
        },
        redirect: 'error',
        signal: composedSignal(dependencies.timeoutMs || REQUEST_TIMEOUT_MS, dependencies.signal)
      });
    } catch (error) {
      throw markSubmissionAmbiguous(providerTransportFailure(error), dependencies);
    }
    if (!response.ok) {
      const error = await upstreamFailure(response);
      if (dependencies.submission === true && error.safeToFallback === true && index < routes.length - 1) {
        lastError = error;
        continue;
      }
      if (dependencies.submission === true && Number(response.status) >= 500) error.submissionAmbiguous = true;
      throw error;
    }
    let bytes;
    try {
      bytes = await limitedBuffer(response, MAX_JSON_BYTES);
    } catch (error) {
      throw markSubmissionAmbiguous(error, dependencies);
    }
    try {
      const payload = JSON.parse(bytes.toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid object');
      dependencies.routeId = route.id;
      return payload;
    } catch (error) {
      throw markSubmissionAmbiguous(
        imageToolError('ai302-invalid-response', 'The 302 tool service returned an invalid response.', 502),
        dependencies
      );
    }
  }
  throw lastError || imageToolError('ai302-unavailable', 'The 302 tool service is temporarily unavailable.', 503);
}

function normalizeText(value, name, { required = false, maximum = 4000 } = {}) {
  const text = String(value || '').trim();
  if (
    (required && !text) || text.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    || PRIVATE_INPUT_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    throw imageToolError(`invalid-${name}`, `The ${name} is invalid.`, 400);
  }
  return text;
}

function boundedNumber(value, fallback, minimum, maximum, name, { integer = false } = {}) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    throw imageToolError('invalid-image-tool-options', `The ${name} option is invalid.`, 400);
  }
  return parsed;
}

function parseSanitizedImage(imageDataUrl) {
  return stripImageMetadata(parseImageDataUrl(imageDataUrl, { maxBytes: MAX_INPUT_IMAGE_BYTES }));
}

function taskTokenKey(apiKey, explicitSecret) {
  return configuredTaskSecret(apiKey, explicitSecret);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function createTaskToken(
  providerId,
  requestId,
  accountingRequestId,
  userId,
  key,
  now = Date.now(),
  routeId = AI302_PRIMARY_ROUTE_ID
) {
  const issuedAt = Math.floor(Number(now) / 1000);
  const payload = Buffer.from(JSON.stringify({
    p: providerId,
    j: requestId,
    r: accountingRequestId,
    u: String(userId || ''),
    ...(routeId && routeId !== AI302_PRIMARY_ROUTE_ID ? { h: routeId } : {}),
    i: issuedAt,
    e: issuedAt + Math.floor(TASK_TOKEN_TTL_MS / 1000)
  }), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(TASK_TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function invalidTaskToken() {
  return imageToolError('image-tool-task-not-found', 'Image tool task not found.', 404);
}

function readTaskToken(taskToken, userId, key, now = Date.now()) {
  const parts = String(taskToken || '').split('.');
  if (
    parts.length !== 4 || parts[0] !== 'v1'
    || parts.some((part) => !part || part.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw invalidTaskToken();
  }
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 2048) {
      throw invalidTaskToken();
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(TASK_TOKEN_AAD);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    const currentTime = Math.floor(Number(now) / 1000);
    const providerId = String(payload && payload.p || '');
    const requestId = String(payload && payload.j || '');
    const accountingRequestId = String(payload && payload.r || '');
    const ownerId = String(payload && payload.u || '');
    const routeId = String(payload && payload.h || AI302_PRIMARY_ROUTE_ID).trim().toLowerCase();
    const issuedAt = Number(payload && payload.i);
    const expiresAt = Number(payload && payload.e);
    if (
      !ASYNC_PROVIDERS.has(providerId)
      || !requestId || requestId.length > 512 || /[\u0000-\u001f\u007f]/.test(requestId)
      || !validUuid(accountingRequestId)
      || !ROUTE_ID_PATTERN.test(routeId)
      || !ownerId || ownerId !== String(userId || '')
      || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || issuedAt > currentTime + 300 || expiresAt <= currentTime
      || expiresAt - issuedAt !== Math.floor(TASK_TOKEN_TTL_MS / 1000)
    ) {
      throw invalidTaskToken();
    }
    return { providerId, requestId, accountingRequestId, routeId, issuedAt };
  } catch (error) {
    if (error && error.code === 'image-tool-task-not-found') throw error;
    throw invalidTaskToken();
  }
}

function normalizedStatus(payload) {
  const images = Array.isArray(payload && payload.images) ? payload.images : [];
  if (images.length) return 'succeeded';
  const raw = String(payload && payload.status || '').trim().toUpperCase().replace(/[ -]+/g, '_');
  if (QUEUED_STATES.has(raw)) return 'queued';
  if (PROCESSING_STATES.has(raw)) return 'processing';
  if (FAILURE_STATES.has(raw)) return 'failed';
  if (SUCCESS_STATES.has(raw)) {
    throw imageToolError('ai302-invalid-response', 'The image tool completed without an image result.', 502);
  }
  throw imageToolError('ai302-invalid-response', 'The image tool returned an unsupported task status.', 502);
}

function safeResultUrls(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_RESULT_IMAGES) {
    throw imageToolError('ai302-invalid-response', 'The image tool returned an invalid image list.', 502);
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw imageToolError('ai302-invalid-response', 'The image tool returned an invalid image result.', 502);
    }
    return validateAssetUrl(item.url).toString();
  });
}

function synchronousResult(payload) {
  const image = imageToolResponseObject(payload).image;
  return {
    status: 'succeeded',
    retryAfterMs: 0,
    urls: safeResultUrls([image])
  };
}

function dependencies(options = {}, { status = false, longRunning = false, submission = false } = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw imageToolError('ai302-unavailable', 'The 302 tool service is unavailable.', 503);
  }
  return {
    apiKey,
    fetchImpl,
    signal: options.signal,
    submission,
    routeId: String(options.routeId || '').trim().toLowerCase(),
    routes: getAi302Routes({ apiKey, routeId: options.routeId }),
    requestId: validUuid(options.accountingRequestId)
      ? String(options.accountingRequestId).trim().toLowerCase()
      : '',
    timeoutMs: status
      ? STATUS_TIMEOUT_MS
      : longRunning
        ? LONG_RUNNING_REQUEST_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS
  };
}

function bindTaskRoute(requestDependencies, routeId) {
  const routes = getAi302Routes({ apiKey: requestDependencies.apiKey, routeId });
  requestDependencies.routes = routes;
  requestDependencies.routeId = routes[0].id;
}

function validateRequestId(value) {
  const requestId = String(value || '').trim();
  if (!requestId || requestId.length > 512 || /[\u0000-\u001f\u007f]/.test(requestId)) {
    throw imageToolError('ai302-invalid-response', 'The 302 tool service did not return a valid task.', 502);
  }
  return requestId;
}

function hasImageToolPayloadFields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && [
    'request_id', 'requestId', 'task_id', 'taskId', 'status', 'images', 'image'
  ].some((key) => Object.hasOwn(value, key));
}

function imageToolResponseObject(payload) {
  let value = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    if (hasImageToolPayloadFields(value)) return value;
    const nested = ['data', 'result', 'response']
      .map((key) => value[key])
      .find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    if (!nested) break;
    value = nested;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw imageToolError('ai302-invalid-response', 'The image tool returned an invalid response.', 502);
  }
  return value;
}

function responseRequestId(payload) {
  const value = imageToolResponseObject(payload);
  return validateRequestId(value.request_id ?? value.requestId ?? value.task_id ?? value.taskId);
}

function nestedResultUrls(value, depth = 0, urls = []) {
  if (depth > 6 || urls.length >= MAX_RESULT_IMAGES || value === null || value === undefined) return urls;
  if (Array.isArray(value)) {
    value.forEach((entry) => nestedResultUrls(entry, depth + 1, urls));
    return urls;
  }
  if (typeof value !== 'object') return urls;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase();
    if (
      typeof entry === 'string'
      && ['url', 'image_url', 'imageurl'].includes(normalizedKey)
      && /^https:\/\//i.test(entry.trim())
    ) {
      urls.push(validateAssetUrl(entry.trim()).toString());
      continue;
    }
    if (['data', 'result', 'response', 'output', 'task_result', 'images', 'image_urls', 'image'].includes(normalizedKey)) {
      nestedResultUrls(entry, depth + 1, urls);
    }
  }
  return [...new Set(urls)].slice(0, MAX_RESULT_IMAGES);
}

function nestedStatus(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') return '';
  for (const key of ['status', 'task_status', 'taskStatus', 'state']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const key of ['data', 'result', 'response', 'output']) {
    const found = nestedStatus(value[key], depth + 1);
    if (found) return found;
  }
  return '';
}

function normalizedDocumentedStatus(payload) {
  if (nestedResultUrls(payload).length) return 'succeeded';
  const raw = nestedStatus(payload).toUpperCase().replace(/[ -]+/g, '_');
  if (QUEUED_STATES.has(raw)) return 'queued';
  if (PROCESSING_STATES.has(raw)) return 'processing';
  if (FAILURE_STATES.has(raw)) return 'failed';
  if (SUCCESS_STATES.has(raw)) {
    throw imageToolError('ai302-invalid-response', 'The image tool completed without an image result.', 502);
  }
  throw imageToolError('ai302-invalid-response', 'The image tool returned an unsupported task status.', 502);
}

async function settledDocumentedTask(providerId, task, payload, userId, options) {
  const status = normalizedDocumentedStatus(payload);
  const settlement = status === 'failed' && typeof options.settleCredits === 'function'
    ? await options.settleCredits({
      requestId: task.accountingRequestId,
      status: 'failed',
      durationMs: Math.max(0, (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000)
    })
    : null;
  if (settlement && settlement.ok !== true) {
    throw imageToolError('credit-settlement-failed', 'The image-tool accounting could not be settled.', 503);
  }
  return {
    status,
    retryAfterMs: ['succeeded', 'failed'].includes(status) ? 0 : 5000,
    urls: status === 'succeeded' ? nestedResultUrls(payload) : [],
    accountingRequestId: task.accountingRequestId,
    accountingDurationMs: Math.max(0, (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000),
    ...(status === 'failed' ? {
      errorCode: 'image-tool-failed',
      errorMessage: 'Image processing failed.'
    } : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsCharged))
      ? { creditsCharged: Number(settlement.creditsCharged) }
      : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsReleased))
      ? { creditsReleased: Number(settlement.creditsReleased) }
      : {}),
    providerId
  };
}

async function readDocumentedTask(providerId, taskToken, userId, options = {}) {
  const requestDependencies = dependencies(options, { status: true });
  const task = readTaskToken(
    taskToken,
    userId,
    taskTokenKey(requestDependencies.apiKey, options.taskSecret),
    options.now
  );
  bindTaskRoute(requestDependencies, task.routeId);
  if (task.providerId !== providerId) throw invalidTaskToken();
  if (typeof options.touchCredits === 'function') {
    const touched = await options.touchCredits({ requestId: task.accountingRequestId, userId: String(userId || '') });
    if (!touched || touched.ok !== true) {
      throw imageToolError('credit-service-failed', 'The image-tool accounting could not be refreshed.', 503);
    }
  }
  return { requestDependencies, task };
}

function createRelays(imageDataUrls, options) {
  const images = imageDataUrls.map(parseSanitizedImage);
  const total = images.reduce((sum, image) => sum + image.buffer.length, 0);
  if (total > MAX_TOTAL_EDIT_BYTES) {
    throw imageToolError('image-too-large', 'The images exceed the supported total size.', 413);
  }
  const relays = [];
  try {
    for (const image of images) relays.push(storeAi302RelayAsset(image, options));
    return relays;
  } catch (error) {
    for (const relay of relays) deleteAi302RelayAsset(relay.token);
    throw error;
  }
}

function normalizeEditOptions(value = {}) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const width = boundedNumber(options.width, 1024, 256, 2048, 'width', { integer: true });
  const height = boundedNumber(options.height, 768, 256, 2048, 'height', { integer: true });
  if (width * height > 4_194_304) {
    throw imageToolError('invalid-image-tool-options', 'The requested image size is too large.', 400);
  }
  const seed = options.seed === undefined || options.seed === null || options.seed === ''
    ? undefined
    : boundedNumber(options.seed, 0, 0, 2_147_483_647, 'seed', { integer: true });
  return {
    image_size: { width, height },
    num_inference_steps: boundedNumber(options.numInferenceSteps, 30, 1, 50, 'numInferenceSteps', { integer: true }),
    guidance_scale: boundedNumber(options.guidanceScale, 4, 0, 20, 'guidanceScale'),
    output_format: 'png',
    negative_prompt: normalizeText(
      options.negativePrompt ?? 'blurry, ugly',
      'negative-prompt',
      { maximum: 2000 }
    ),
    ...(seed !== undefined ? { seed } : {})
  };
}

export async function submitQwenImageEdit({ imageDataUrl, imageDataUrls, prompt, toolOptions, userId } = {}, options = {}) {
  const sourceUrls = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl];
  if (!sourceUrls.length || sourceUrls.length > MAX_EDIT_IMAGES || sourceUrls.some((value) => typeof value !== 'string')) {
    throw imageToolError('invalid-image-data', `Between 1 and ${MAX_EDIT_IMAGES} images are required.`, 400);
  }
  const userPrompt = normalizeText(prompt, 'prompt', { required: true, maximum: 4000 });
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, { submission: true });
  const relays = createRelays(sourceUrls, options);
  try {
    const payload = await fetch302Json(QWEN_EDIT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: userPrompt,
        image_urls: relays.map((relay) => relay.url),
        ...normalizeEditOptions(toolOptions)
      })
    }, requestDependencies);
    let response;
    let requestId;
    let status;
    try {
      response = imageToolResponseObject(payload);
      requestId = responseRequestId(response);
      status = response.status ? normalizedStatus(response) : 'queued';
    } catch (error) {
      throw markSubmissionAmbiguous(error, requestDependencies);
    }
    return {
      taskToken: createTaskToken(
        'qwen-image-edit-plus',
        requestId,
        accountingRequestId,
        userId,
        taskTokenKey(requestDependencies.apiKey, options.taskSecret),
        options.now,
        requestDependencies.routeId
      ),
      status,
      retryAfterMs: status === 'queued' || status === 'processing' ? 5000 : 0,
      urls: []
    };
  } catch (error) {
    for (const relay of relays) deleteAi302RelayAsset(relay.token);
    throw error;
  }
}

export async function submitQwenImageLayered({ imageDataUrl, prompt, numLayers, toolOptions, userId } = {}, options = {}) {
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, { submission: true });
  const relays = createRelays([imageDataUrl], options);
  try {
    const payload = await fetch302Json(QWEN_LAYERED_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: relays[0].url,
        prompt: normalizeText(prompt, 'prompt', { maximum: 4000 }),
        num_layers: boundedNumber(numLayers, 4, 2, 8, 'numLayers', { integer: true }),
        enable_safety_checker: !toolOptions || toolOptions.enableSafetyChecker !== false,
        output_format: 'png'
      })
    }, requestDependencies);
    let response;
    let requestId;
    let status;
    try {
      response = imageToolResponseObject(payload);
      requestId = responseRequestId(response);
      status = response.status ? normalizedStatus(response) : 'queued';
    } catch (error) {
      throw markSubmissionAmbiguous(error, requestDependencies);
    }
    return {
      taskToken: createTaskToken(
        'qwen-image-layered',
        requestId,
        accountingRequestId,
        userId,
        taskTokenKey(requestDependencies.apiKey, options.taskSecret),
        options.now,
        requestDependencies.routeId
      ),
      status,
      retryAfterMs: status === 'queued' || status === 'processing' ? 5000 : 0,
      urls: []
    };
  } catch (error) {
    for (const relay of relays) deleteAi302RelayAsset(relay.token);
    throw error;
  }
}

async function pollAsyncImageTask(expectedProviderId, path, { taskToken, userId } = {}, options = {}) {
  const requestDependencies = dependencies(options, { status: true });
  const task = readTaskToken(
    taskToken,
    userId,
    taskTokenKey(requestDependencies.apiKey, options.taskSecret),
    options.now
  );
  bindTaskRoute(requestDependencies, task.routeId);
  if (task.providerId !== expectedProviderId) throw invalidTaskToken();
  if (typeof options.touchCredits === 'function') {
    const touched = await options.touchCredits({
      requestId: task.accountingRequestId,
      userId: String(userId || '')
    });
    if (!touched || touched.ok !== true) {
      throw imageToolError('credit-service-failed', 'The image-tool accounting could not be refreshed.', 503);
    }
  }
  const payload = await fetch302Json(`${path}?request_id=${encodeURIComponent(task.requestId)}`, {
    method: 'GET'
  }, requestDependencies);
  const response = imageToolResponseObject(payload);
  const status = normalizedStatus(response);
  const settlement = status === 'failed' && typeof options.settleCredits === 'function'
    ? await options.settleCredits({
      requestId: task.accountingRequestId,
      status: 'failed',
      durationMs: Math.max(0, (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000)
    })
    : null;
  if (settlement && settlement.ok !== true) {
    throw imageToolError('credit-settlement-failed', 'The image-tool accounting could not be settled.', 503);
  }
  return {
    status,
    retryAfterMs: status === 'queued' || status === 'processing' ? 5000 : 0,
    urls: status === 'succeeded' ? safeResultUrls(response.images) : [],
    accountingRequestId: task.accountingRequestId,
    accountingDurationMs: Math.max(0, (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000),
    ...(status === 'failed' ? {
      errorCode: 'image-tool-failed',
      errorMessage: 'Image processing failed.'
    } : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsCharged))
      ? { creditsCharged: Number(settlement.creditsCharged) }
      : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsReleased))
      ? { creditsReleased: Number(settlement.creditsReleased) }
      : {})
  };
}

export function pollQwenImageEdit(input, options = {}) {
  return pollAsyncImageTask('qwen-image-edit-plus', QWEN_EDIT_PATH, input, options);
}

export function pollQwenImageLayered(input, options = {}) {
  return pollAsyncImageTask('qwen-image-layered', QWEN_LAYERED_PATH, input, options);
}

export async function submitSeedEditImage({ imageDataUrl, prompt, toolOptions, userId } = {}, options = {}) {
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, { submission: true });
  const image = parseSanitizedImage(imageDataUrl);
  const form = new FormData();
  form.append('image_urls', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  form.append('prompt', normalizeText(prompt, 'prompt', { required: true, maximum: 1200 }));
  const source = toolOptions && typeof toolOptions === 'object' && !Array.isArray(toolOptions) ? toolOptions : {};
  if (source.seed !== undefined && source.seed !== null && source.seed !== '') {
    form.append('seed', String(boundedNumber(source.seed, 0, 0, 2_147_483_647, 'seed', { integer: true })));
  }
  form.append('scale', String(boundedNumber(source.scale, 5, 1, 10, 'scale')));
  const payload = await fetch302Json(SEED_EDIT_PATH, { method: 'POST', body: form }, requestDependencies);
  let requestId;
  try {
    requestId = responseRequestId(payload);
  } catch (error) {
    throw markSubmissionAmbiguous(error, requestDependencies);
  }
  return {
    taskToken: createTaskToken(
      'seededit-v3', requestId, accountingRequestId, userId,
      taskTokenKey(requestDependencies.apiKey, options.taskSecret), options.now, requestDependencies.routeId
    ),
    status: 'queued',
    retryAfterMs: 5000,
    urls: []
  };
}

export async function pollSeedEditImage({ taskToken, userId } = {}, options = {}) {
  const { requestDependencies, task } = await readDocumentedTask('seededit-v3', taskToken, userId, options);
  const payload = await fetch302Json(`${SEED_EDIT_RESULT_PATH}?response_format=url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: task.requestId, req_json: JSON.stringify({ return_url: true }) })
  }, requestDependencies);
  return settledDocumentedTask('seededit-v3', task, payload, userId, options);
}

function normalizeExpansionOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {
    up_expansion_ratio: boundedNumber(source.up, 0.25, 0, 2, 'up'),
    right_expansion_ratio: boundedNumber(source.right, 0.25, 0, 2, 'right'),
    down_expansion_ratio: boundedNumber(source.down, 0.25, 0, 2, 'down'),
    left_expansion_ratio: boundedNumber(source.left, 0.25, 0, 2, 'left')
  };
  const areaRatio = (1 + result.left_expansion_ratio + result.right_expansion_ratio)
    * (1 + result.up_expansion_ratio + result.down_expansion_ratio);
  if (areaRatio > 3 || areaRatio <= 1) {
    throw imageToolError('invalid-image-tool-options', 'The expanded area must be greater than the source and no more than three times its area.', 400);
  }
  const prompt = normalizeText(source.prompt, 'prompt', { maximum: 1200 });
  return { ...result, ...(prompt ? { prompt } : {}), n: 1 };
}

export async function submitKlingImageExpand({ imageDataUrl, toolOptions, userId } = {}, options = {}) {
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, { submission: true });
  const image = parseSanitizedImage(imageDataUrl);
  const payload = await fetch302Json(KLING_EXPAND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: image.buffer.toString('base64'), ...normalizeExpansionOptions(toolOptions) })
  }, requestDependencies);
  let requestId;
  try {
    requestId = responseRequestId(payload);
  } catch (error) {
    throw markSubmissionAmbiguous(error, requestDependencies);
  }
  return {
    taskToken: createTaskToken(
      'kling-image-expand', requestId, accountingRequestId, userId,
      taskTokenKey(requestDependencies.apiKey, options.taskSecret), options.now, requestDependencies.routeId
    ),
    status: 'queued',
    retryAfterMs: 5000,
    urls: []
  };
}

export async function pollKlingImageExpand({ taskToken, userId } = {}, options = {}) {
  const { requestDependencies, task } = await readDocumentedTask('kling-image-expand', taskToken, userId, options);
  const payload = await fetch302Json(`${KLING_EXPAND_PATH}/${encodeURIComponent(task.requestId)}`, {
    method: 'GET'
  }, requestDependencies);
  return settledDocumentedTask('kling-image-expand', task, payload, userId, options);
}

function normalizeTopazOptions(providerId, value = {}) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const common = {
    output_format: 'png',
    image: '',
    model: {
      'topaz-image-sharpen': 'Standard',
      'topaz-image-sharpen-gen': 'Super Focus V2',
      'topaz-image-enhance': 'Standard V2',
      'topaz-image-enhance-gen': 'Redefine',
      'topaz-image-denoise': 'Normal',
      'topaz-image-restore': 'Dust-Scratch',
      'topaz-image-lighting': 'Adjust'
    }[providerId]
  };
  if ([
    'topaz-image-sharpen', 'topaz-image-sharpen-gen',
    'topaz-image-enhance', 'topaz-image-enhance-gen',
    'topaz-image-denoise'
  ].includes(providerId)) {
    Object.assign(common, {
      subject_detection: 'All',
      face_enhancement: options.faceEnhancement !== false,
      face_enhancement_creativity: boundedNumber(options.faceEnhancementCreativity, 0, 0, 1, 'faceEnhancementCreativity'),
      face_enhancement_strength: boundedNumber(options.faceEnhancementStrength, 0.8, 0, 1, 'faceEnhancementStrength')
    });
  }
  if (providerId === 'topaz-image-enhance' || providerId === 'topaz-image-enhance-gen') {
    const outputWidth = boundedNumber(options.outputWidth, 1920, 128, 8192, 'outputWidth', { integer: true });
    const outputHeight = boundedNumber(options.outputHeight, 1080, 128, 8192, 'outputHeight', { integer: true });
    if (outputWidth * outputHeight > 33_554_432) {
      throw imageToolError('invalid-image-tool-options', 'The requested Topaz output is too large.', 400);
    }
    Object.assign(common, {
      output_width: outputWidth,
      output_height: outputHeight,
      crop_to_fill: options.cropToFill === true
    });
  }
  return common;
}

const TOPAZ_STATUS_VALUES = new Set([
  'created', 'in_queue', 'pending', 'queued', 'queueing', 'wait', 'waiting', 'submitted',
  'processing', 'running', 'in_progress', 'generating', 'completed', 'complete', 'done',
  'success', 'succeeded', 'failed', 'error', 'cancelled', 'canceled', 'rejected', 'expired'
]);

function topazObjectCandidates(payload, maximumDepth = 4) {
  const candidates = [];
  const queue = [{ value: payload, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
    if (depth >= maximumDepth) continue;
    for (const key of ['data', 'result', 'response', 'payload', 'output', 'download']) {
      const nested = value[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }
  return candidates;
}

function topazResponseObject(payload, required = 'status') {
  const candidates = topazObjectCandidates(payload);
  let best = null;
  let bestScore = -1;
  for (const value of candidates) {
    let score = 0;
    if (['process_id', 'processId', 'request_id', 'requestId', 'task_id', 'taskId', 'job_id', 'jobId'].some((key) => Object.hasOwn(value, key))) score += 8;
    if (['credits', 'cost', 'provider_cost', 'providerCost'].some((key) => Object.hasOwn(value, key))) score += 4;
    if (['status', 'state', 'task_status', 'taskStatus'].some((key) => TOPAZ_STATUS_VALUES.has(String(value[key] || '').trim().toLowerCase().replace(/[ -]+/g, '_')))) score += 8;
    if (['progress', 'percentage', 'progress_percent', 'progressPercent'].some((key) => Object.hasOwn(value, key))) score += 2;
    if (['download_url', 'downloadUrl', 'url'].some((key) => typeof value[key] === 'string' && value[key].trim())) score += required === 'download' ? 10 : 1;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  if (!best || bestScore <= 0) {
    throw imageToolError('ai302-invalid-response', 'The Topaz service returned an invalid response.', 502);
  }
  return best;
}

function topazField(payload, names, required = 'status') {
  for (const value of topazObjectCandidates(payload)) {
    for (const name of names) {
      if (value[name] !== undefined && value[name] !== null && value[name] !== '') return value[name];
    }
  }
  return undefined;
}

function topazProcessId(payload) {
  const processId = String(topazField(payload, [
    'process_id', 'processId', 'request_id', 'requestId', 'task_id', 'taskId', 'job_id', 'jobId'
  ], 'create') || '').trim().toLowerCase();
  if (!validUuid(processId)) {
    throw imageToolError('ai302-invalid-response', 'Topaz did not return a valid process identifier.', 502);
  }
  return processId;
}

function deniedTopazReservation(reservation) {
  const reason = String(reservation && reservation.reason || 'credit-service-failed');
  const status = reason === 'insufficient-credits' ? 402 : (reason === 'account-suspended' ? 403 : 503);
  const error = imageToolError(reason, reason === 'insufficient-credits'
    ? 'There are not enough credits for this Topaz operation.'
    : 'The Topaz credit reservation failed.', status);
  error.requiredCredits = Number(reservation && reservation.credits) || 0;
  error.availableCredits = Math.max(0, Number(reservation && (reservation.availableCredits ?? reservation.available_credits)) || 0);
  return error;
}

export async function submitTopazImageTool({ modelId, imageDataUrl, toolOptions, userId } = {}, options = {}) {
  const providerId = String(modelId || '').trim().toLowerCase();
  const path = TOPAZ_IMAGE_PATHS[providerId];
  if (!path) throw imageToolError('invalid-image-tool', 'The selected Topaz image tool is not supported.', 400);
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  if (typeof options.reserveCredits !== 'function') {
    throw imageToolError('credit-service-failed', 'Topaz credit enforcement is unavailable.', 503);
  }
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, { submission: true });
  const relays = createRelays([imageDataUrl], options);
  let reservation = null;
  try {
    reservation = await options.reserveCredits({
      requestId: accountingRequestId,
      providerId,
      providerCost: TOPAZ_IMAGE_PROVIDER_CREDIT_RESERVE
    });
    if (!reservation || reservation.ok !== true) throw deniedTopazReservation(reservation);
    const requestBody = normalizeTopazOptions(providerId, toolOptions);
    requestBody.image = relays[0].url;
    const payload = await fetch302Json(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }, requestDependencies);
    let processId;
    let providerCost;
    try {
      processId = topazProcessId(payload);
      providerCost = Number(topazField(payload, ['credits', 'cost', 'provider_cost', 'providerCost'], 'create'));
      if (!Number.isInteger(providerCost) || providerCost < 0 || providerCost > 1_000_000) {
        providerCost = TOPAZ_IMAGE_PROVIDER_CREDIT_RESERVE;
      }
    } catch (error) {
      throw markSubmissionAmbiguous(error, requestDependencies);
    }
    let billedCredits = Number(reservation.credits) || 0;
    if (providerCost > TOPAZ_IMAGE_PROVIDER_CREDIT_RESERVE) {
      if (typeof options.topUpCredits !== 'function') {
        throw imageToolError('credit-service-failed', 'Topaz credit adjustment is unavailable.', 503);
      }
      const adjustment = await options.topUpCredits({
        requestId: accountingRequestId,
        providerId,
        providerCost
      });
      if (!adjustment || adjustment.ok !== true) throw deniedTopazReservation(adjustment);
      billedCredits = Number(adjustment.credits) || billedCredits;
    }
    return {
      taskToken: createTaskToken(
        providerId,
        processId,
        accountingRequestId,
        userId,
        taskTokenKey(requestDependencies.apiKey, options.taskSecret),
        options.now,
        requestDependencies.routeId
      ),
      status: 'queued',
      retryAfterMs: 5000,
      resultCount: 0,
      providerCost,
      credits: billedCredits,
      availableCredits: reservation.availableCredits ?? reservation.available_credits
    };
  } catch (error) {
    for (const relay of relays) deleteAi302RelayAsset(relay.token);
    if (reservation && reservation.ok === true
        && error && error.submissionAmbiguous !== true
        && error.providerTaskAccepted !== true
        && typeof options.releaseCredits === 'function') {
      try {
        await options.releaseCredits({ requestId: accountingRequestId, status: 'failed', durationMs: 0 });
      } catch {}
    }
    throw error;
  }
}

function normalizeTopazStatus(value) {
  const status = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(status)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failed';
  if (['processing', 'running', 'in_progress'].includes(status)) return 'processing';
  return 'queued';
}

export async function pollTopazImageTool({ taskToken, userId } = {}, options = {}) {
  const requestDependencies = dependencies(options, { status: true });
  const task = readTaskToken(
    taskToken,
    userId,
    taskTokenKey(requestDependencies.apiKey, options.taskSecret),
    options.now
  );
  bindTaskRoute(requestDependencies, task.routeId);
  if (!Object.hasOwn(TOPAZ_IMAGE_PATHS, task.providerId)) throw invalidTaskToken();
  if (typeof options.touchCredits === 'function') {
    const touched = await options.touchCredits({ requestId: task.accountingRequestId, userId: String(userId || '') });
    if (!touched || touched.ok !== true) {
      throw imageToolError('credit-service-failed', 'The Topaz accounting could not be refreshed.', 503);
    }
  }
  const payload = await fetch302Json(`${TOPAZ_STATUS_PATH}/${encodeURIComponent(task.requestId)}`, {
    method: 'GET'
  }, requestDependencies);
  const statusPayload = topazResponseObject(payload);
  let status = normalizeTopazStatus(topazField(statusPayload, [
    'status', 'state', 'task_status', 'taskStatus'
  ]));
  let urls = [];
  if (status === 'succeeded') {
    const download = await fetch302Json(`${TOPAZ_DOWNLOAD_PATH}/${encodeURIComponent(task.requestId)}`, {
      method: 'GET'
    }, requestDependencies);
    const downloadUrl = topazField(download, ['download_url', 'downloadUrl', 'url'], 'download');
    if (downloadUrl) urls = [validateAssetUrl(String(downloadUrl).trim()).toString()];
    else status = 'processing';
  }
  const accountingDurationMs = Math.max(
    0,
    (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000
  );
  const settlement = status === 'failed' && typeof options.settleCredits === 'function'
    ? await options.settleCredits({
        requestId: task.accountingRequestId,
        status: 'failed',
        durationMs: accountingDurationMs
      })
    : null;
  if (settlement && settlement.ok !== true) {
    throw imageToolError('credit-settlement-failed', 'The Topaz accounting could not be settled.', 503);
  }
  return {
    status,
    progress: Math.max(0, Math.min(100, Math.round(Number(topazField(statusPayload, [
      'progress', 'percentage', 'progress_percent', 'progressPercent'
    ])) || (status === 'succeeded' ? 100 : 0)))),
    retryAfterMs: ['succeeded', 'failed'].includes(status) ? 0 : 5000,
    urls,
    accountingRequestId: task.accountingRequestId,
    accountingDurationMs,
    providerCost: Number.isFinite(Number(topazField(statusPayload, [
      'credits', 'cost', 'provider_cost', 'providerCost'
    ]))) ? Number(topazField(statusPayload, [
      'credits', 'cost', 'provider_cost', 'providerCost'
    ])) : undefined,
    ...(settlement && Number.isFinite(Number(settlement.creditsCharged))
      ? { creditsCharged: Number(settlement.creditsCharged) }
      : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsReleased))
      ? { creditsReleased: Number(settlement.creditsReleased) }
      : {})
  };
}

function normalizeUpscaleOptions(value = {}) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const modelType = String(options.modelType || 'SDXL').trim().toUpperCase();
  if (modelType !== 'SDXL') {
    throw imageToolError('invalid-image-tool-options', 'The selected upscale model is not supported.', 400);
  }
  return {
    model_type: modelType,
    scale: boundedNumber(options.scale, 3, 2, 4, 'scale'),
    creativity: boundedNumber(options.creativity, 0.2, 0, 1, 'creativity'),
    detail: boundedNumber(options.detail, 2, 0, 10, 'detail'),
    shape_preservation: boundedNumber(options.shapePreservation, 0.1, 0, 1, 'shapePreservation'),
    prompt_suffix: normalizeText(
      options.promptSuffix ?? 'high quality, highly detailed, high resolution, sharp',
      'prompt-suffix',
      { maximum: 1000 }
    ),
    negative_prompt: normalizeText(
      options.negativePrompt ?? 'blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisy, grainy',
      'negative-prompt',
      { maximum: 2000 }
    ),
    guidance_scale: boundedNumber(options.guidanceScale, 7.5, 0, 20, 'guidanceScale'),
    num_inference_steps: boundedNumber(options.numInferenceSteps, 20, 1, 50, 'numInferenceSteps', { integer: true }),
    override_size_limits: options.overrideSizeLimits === true
  };
}

function validateRasterImage(bytes) {
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) {
    throw imageToolError('invalid-image-result', 'The image tool returned an invalid image file.', 502);
  }
  return bytes;
}

async function fetch302BinaryImage(path, form, options = {}) {
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, {
    longRunning: true,
    submission: true
  });
  const routes = requestDependencies.routes;
  let response;
  let lastError;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      response = await requestDependencies.fetchImpl(ai302RouteUrl(route, path), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${route.apiKey}`,
          Accept: 'image/png,image/jpeg,image/webp,application/json',
          ...(requestDependencies.requestId
            ? {
                'Idempotency-Key': requestDependencies.requestId,
                'X-Request-Id': requestDependencies.requestId
              }
            : {})
        },
        body: form,
        redirect: 'error',
        signal: composedSignal(requestDependencies.timeoutMs, requestDependencies.signal)
      });
    } catch (error) {
      throw markSubmissionAmbiguous(providerTransportFailure(error), requestDependencies);
    }
    if (!response.ok) {
      const error = await upstreamFailure(response);
      if (requestDependencies.submission === true && error.safeToFallback === true && index < routes.length - 1) {
        lastError = error;
        continue;
      }
      if (requestDependencies.submission === true && Number(response.status) >= 500) {
        error.submissionAmbiguous = true;
      }
      throw error;
    }
    requestDependencies.routeId = route.id;
    break;
  }
  if (!response) throw lastError || imageToolError('ai302-unavailable', 'The 302 tool service is temporarily unavailable.', 503);
  const contentType = String(response.headers && response.headers.get('content-type') || '').toLowerCase();
  let bytes;
  try {
    bytes = await limitedBuffer(response, MAX_OUTPUT_IMAGE_BYTES);
  } catch (error) {
    throw markSubmissionAmbiguous(error, requestDependencies);
  }
  if (contentType.includes('application/json')) {
    let payload;
    try { payload = JSON.parse(bytes.toString('utf8')); }
    catch (error) {
      throw markSubmissionAmbiguous(
        imageToolError('ai302-invalid-response', 'The image tool returned an invalid response.', 502),
        requestDependencies
      );
    }
    const [resultUrl] = nestedResultUrls(payload);
    if (!resultUrl) {
      throw markSubmissionAmbiguous(
        imageToolError('ai302-invalid-response', 'The image tool did not return an image.', 502),
        requestDependencies
      );
    }
    try {
      return await downloadAi302ImageResult(resultUrl, options);
    } catch (error) {
      throw markSubmissionAmbiguous(error, requestDependencies);
    }
  }
  try {
    return validateRasterImage(bytes);
  } catch (error) {
    throw markSubmissionAmbiguous(error, requestDependencies);
  }
}

export async function generativeUpscaleImage({ imageDataUrl } = {}, options = {}) {
  const image = parseSanitizedImage(imageDataUrl);
  const form = new FormData();
  form.append('image_file', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  return fetch302BinaryImage(CLIPDROP_UPSCALE_PATH, form, options);
}

export async function uncropImage({ imageDataUrl, toolOptions } = {}, options = {}) {
  const image = parseSanitizedImage(imageDataUrl);
  const source = toolOptions && typeof toolOptions === 'object' && !Array.isArray(toolOptions) ? toolOptions : {};
  const extensions = {
    extend_left: boundedNumber(source.left, 0, 0, 2000, 'left', { integer: true }),
    extend_right: boundedNumber(source.right, 0, 0, 2000, 'right', { integer: true }),
    extend_up: boundedNumber(source.up, 0, 0, 2000, 'up', { integer: true }),
    extend_down: boundedNumber(source.down, 0, 0, 2000, 'down', { integer: true })
  };
  if (!Object.values(extensions).some((value) => value > 0)) {
    throw imageToolError('invalid-image-tool-options', 'The expanded image must be larger than the source.', 400);
  }
  const seed = source.seed === undefined || source.seed === null || source.seed === ''
    ? undefined
    : boundedNumber(source.seed, 0, 0, 100_000, 'seed', { integer: true });
  const form = new FormData();
  form.append('image_file', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  for (const [name, value] of Object.entries(extensions)) form.append(name, String(value));
  if (seed !== undefined) form.append('seed', String(seed));
  return fetch302BinaryImage(CLIPDROP_UNCROP_PATH, form, options);
}

export async function cleanupImageObjects({ imageDataUrl, maskImageDataUrl } = {}, options = {}) {
  const image = parseSanitizedImage(imageDataUrl);
  const mask = parseSanitizedImage(maskImageDataUrl);
  if (mask.mime !== 'image/png') {
    throw imageToolError('invalid-mask-image', 'The object-removal mask must be a PNG image.', 400);
  }
  const form = new FormData();
  form.append('image_file', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  form.append('mask_file', new Blob([mask.buffer], { type: mask.mime }), 'mask.png');
  return fetch302BinaryImage(CLEANUP_PATH, form, options);
}

export async function superUpscaleImage({ imageDataUrl, toolOptions } = {}, options = {}) {
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, {
    longRunning: true,
    submission: true
  });
  const relays = createRelays([imageDataUrl], options);
  try {
    const payload = await fetch302Json(SUPER_UPSCALE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...normalizeUpscaleOptions(toolOptions),
        image_url: relays[0].url
      })
    }, requestDependencies);
    try {
      return synchronousResult(payload);
    } catch (error) {
      throw markSubmissionAmbiguous(error, requestDependencies);
    }
  } finally {
    for (const relay of relays) deleteAi302RelayAsset(relay.token);
  }
}

export async function eraseImageObjects({ imageDataUrl, maskImageDataUrl } = {}, options = {}) {
  const image = parseSanitizedImage(imageDataUrl);
  const mask = parseSanitizedImage(maskImageDataUrl);
  if (mask.mime !== 'image/png') {
    throw imageToolError('invalid-mask-image', 'The object-removal mask must be a PNG image.', 400);
  }
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const requestDependencies = dependencies({ ...options, accountingRequestId }, {
    longRunning: true,
    submission: true
  });
  const form = new FormData();
  form.append('image_url', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  form.append('mask_image_url', new Blob([mask.buffer], { type: mask.mime }), 'mask.png');
  const payload = await fetch302Json(ERASE_PATH, {
    method: 'POST',
    headers: { Accept: 'image/*' },
    body: form
  }, requestDependencies);
  try {
    return synchronousResult(payload);
  } catch (error) {
    throw markSubmissionAmbiguous(error, requestDependencies);
  }
}

export async function downloadAi302ImageResult(urlValue, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw imageToolError('tool-download-failed', 'The image result could not be downloaded.', 502);
  }
  let url = validateAssetUrl(urlValue);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'image/png,image/*' },
        redirect: 'manual',
        signal: composedSignal(DOWNLOAD_TIMEOUT_MS, options.signal)
      });
    } catch (error) {
      throw imageToolError('tool-download-failed', 'The image result could not be downloaded.', 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (response.body) await response.body.cancel().catch(() => {});
      if (!location || redirectCount === 3) {
        throw imageToolError('unsafe-tool-result-url', 'The image result contains an invalid redirect.', 502);
      }
      url = validateAssetUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw imageToolError('tool-download-failed', 'The image result could not be downloaded.', 502);
    }
    const image = await limitedBuffer(response, MAX_OUTPUT_IMAGE_BYTES);
    validatePng(image);
    return image;
  }
  throw imageToolError('unsafe-tool-result-url', 'The image result contains too many redirects.', 502);
}
