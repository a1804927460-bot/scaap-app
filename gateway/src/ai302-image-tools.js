import crypto from 'node:crypto';
import {
  deleteAi302RelayAsset,
  parseImageDataUrl,
  storeAi302RelayAsset,
  stripImageMetadata,
  validateAssetUrl,
  validatePng
} from './ai302-tools.js';

const API_ORIGIN = 'https://api.302.ai';
const QWEN_EDIT_PATH = '/302/submit/qwen-image-edit-plus';
const QWEN_LAYERED_PATH = '/302/submit/qwen-image-layered';
const SUPER_UPSCALE_PATH = '/302/submit/super-upscale-v2';
const ERASE_PATH = '/302/submit/erase';
const REQUEST_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_INPUT_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_EDIT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_EDIT_IMAGES = 4;
const MAX_RESULT_IMAGES = 8;
const TASK_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
const TASK_TOKEN_AAD = Buffer.from('messs:ai302-image-task:v1', 'utf8');
const ASYNC_PROVIDERS = new Set(['qwen-image-edit-plus', 'qwen-image-layered']);
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
  const key = String(explicitKey ?? process.env.AI302_KEY ?? process.env.AI_302_API_KEY ?? '').trim();
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

function upstreamFailure(response) {
  const error = response.status === 402
    ? imageToolError('ai302-balance-exhausted', 'The 302 tool balance is insufficient.', 402)
    : response.status === 429
      ? imageToolError('ai302-rate-limited', 'The 302 tool service is busy. Try again shortly.', 429)
      : imageToolError('ai302-upstream-error', 'The 302 tool service rejected the request.', 502);
  error.upstreamStatus = response.status;
  return error;
}

async function fetch302Json(path, init, dependencies) {
  let response;
  try {
    response = await dependencies.fetchImpl(`${API_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${dependencies.apiKey}`,
        Accept: 'application/json',
        ...(init.headers || {})
      },
      redirect: 'error',
      signal: composedSignal(dependencies.timeoutMs || REQUEST_TIMEOUT_MS, dependencies.signal)
    });
  } catch (error) {
    throw imageToolError('ai302-unavailable', 'The 302 tool service is temporarily unavailable.', 503);
  }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw upstreamFailure(response);
  }
  const bytes = await limitedBuffer(response, MAX_JSON_BYTES);
  try {
    const payload = JSON.parse(bytes.toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid object');
    return payload;
  } catch (error) {
    throw imageToolError('ai302-invalid-response', 'The 302 tool service returned an invalid response.', 502);
  }
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

function createTaskToken(providerId, requestId, accountingRequestId, userId, key, now = Date.now()) {
  const issuedAt = Math.floor(Number(now) / 1000);
  const payload = Buffer.from(JSON.stringify({
    p: providerId,
    j: requestId,
    r: accountingRequestId,
    u: String(userId || ''),
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
    const issuedAt = Number(payload && payload.i);
    const expiresAt = Number(payload && payload.e);
    if (
      !ASYNC_PROVIDERS.has(providerId)
      || !requestId || requestId.length > 512 || /[\u0000-\u001f\u007f]/.test(requestId)
      || !validUuid(accountingRequestId)
      || !ownerId || ownerId !== String(userId || '')
      || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || issuedAt > currentTime + 300 || expiresAt <= currentTime
      || expiresAt - issuedAt !== Math.floor(TASK_TOKEN_TTL_MS / 1000)
    ) {
      throw invalidTaskToken();
    }
    return { providerId, requestId, accountingRequestId, issuedAt };
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

function dependencies(options = {}, { status = false } = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw imageToolError('ai302-unavailable', 'The 302 tool service is unavailable.', 503);
  }
  return {
    apiKey,
    fetchImpl,
    signal: options.signal,
    timeoutMs: status ? STATUS_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  };
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
  return {
    image_size: { width, height },
    num_inference_steps: boundedNumber(options.numInferenceSteps, 30, 1, 50, 'numInferenceSteps', { integer: true }),
    guidance_scale: boundedNumber(options.guidanceScale, 4, 0, 20, 'guidanceScale'),
    output_format: 'png',
    negative_prompt: normalizeText(
      options.negativePrompt ?? 'blurry, ugly',
      'negative-prompt',
      { maximum: 2000 }
    )
  };
}

export async function submitQwenImageEdit({ imageDataUrl, imageDataUrls, prompt, toolOptions, userId } = {}, options = {}) {
  const sourceUrls = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl];
  if (!sourceUrls.length || sourceUrls.length > MAX_EDIT_IMAGES || sourceUrls.some((value) => typeof value !== 'string')) {
    throw imageToolError('invalid-image-data', `Between 1 and ${MAX_EDIT_IMAGES} images are required.`, 400);
  }
  const userPrompt = normalizeText(prompt, 'prompt', { required: true, maximum: 4000 });
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const requestDependencies = dependencies(options);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
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
    const response = imageToolResponseObject(payload);
    const requestId = responseRequestId(response);
    const status = response.status ? normalizedStatus(response) : 'queued';
    return {
      taskToken: createTaskToken(
        'qwen-image-edit-plus',
        requestId,
        accountingRequestId,
        userId,
        taskTokenKey(requestDependencies.apiKey, options.taskSecret),
        options.now
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

export async function submitQwenImageLayered({ imageDataUrl, prompt, numLayers, userId } = {}, options = {}) {
  if (!String(userId || '').trim()) throw imageToolError('invalid-user', 'An authenticated user is required.', 401);
  const requestDependencies = dependencies(options);
  const accountingRequestId = validUuid(options.accountingRequestId)
    ? String(options.accountingRequestId).trim().toLowerCase()
    : crypto.randomUUID();
  const relays = createRelays([imageDataUrl], options);
  try {
    const payload = await fetch302Json(QWEN_LAYERED_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: relays[0].url,
        prompt: normalizeText(prompt, 'prompt', { maximum: 4000 }),
        num_layers: boundedNumber(numLayers, 4, 2, 8, 'numLayers', { integer: true }),
        enable_safety_checker: true,
        output_format: 'png'
      })
    }, requestDependencies);
    const response = imageToolResponseObject(payload);
    const requestId = responseRequestId(response);
    const status = response.status ? normalizedStatus(response) : 'queued';
    return {
      taskToken: createTaskToken(
        'qwen-image-layered',
        requestId,
        accountingRequestId,
        userId,
        taskTokenKey(requestDependencies.apiKey, options.taskSecret),
        options.now
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
  const settlement = ['succeeded', 'failed'].includes(status) && typeof options.settleCredits === 'function'
    ? await options.settleCredits({
      requestId: task.accountingRequestId,
      status,
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

export async function superUpscaleImage({ imageDataUrl, toolOptions } = {}, options = {}) {
  const requestDependencies = dependencies(options);
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
    return synchronousResult(payload);
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
  const requestDependencies = dependencies(options);
  const form = new FormData();
  form.append('image_url', new Blob([image.buffer], { type: image.mime }), `image.${image.extension}`);
  form.append('mask_image_url', new Blob([mask.buffer], { type: mask.mime }), 'mask.png');
  const payload = await fetch302Json(ERASE_PATH, {
    method: 'POST',
    headers: { Accept: 'image/*' },
    body: form
  }, requestDependencies);
  return synchronousResult(payload);
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
