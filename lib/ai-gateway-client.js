'use strict';

const crypto = require('node:crypto');

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_BACKGROUND_BYTES = 64 * 1024 * 1024;
const MAX_BUTLER_IMAGE_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_GLB_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 256 * 1024;
const MAX_BUTLER_IMAGE_BYTES = Math.floor(7.5 * 1024 * 1024);
const MAX_BUTLER_VIDEO_BYTES = 48 * 1024 * 1024;
const VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES = 2 * 1024 * 1024;
const VIDEO_UPLOAD_SESSION_TIMEOUT_MS = 90 * 1000;
const VIDEO_UPLOAD_CHUNK_TIMEOUT_MS = 3 * 60 * 1000;
const VIDEO_UPLOAD_RETRIES = 5;
const VIDEO_CREATE_TIMEOUT_MS = 15 * 60 * 1000;

function setBufferMetadata(buffer, key, value) {
  Object.defineProperty(buffer, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false
  });
}

function numericResponseHeader(response, name) {
  const value = response.headers && response.headers.get && response.headers.get(name);
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(value);
}

function abortableDelay(ms, signal) {
  if (signal && signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}

function publicHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const bareHost = host.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (bareHost.includes(':')) return '';
    if (bareHost === 'localhost' || bareHost.endsWith('.local') || bareHost === '0.0.0.0') return '';
    if (/^(?:10|127|169\.254|192\.168)\./.test(bareHost)) return '';
    const private172 = /^172\.(\d{1,3})\./.exec(bareHost);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function validVideoBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 12 && (
    (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
    || buffer.toString('ascii', 4, 8) === 'ftyp'
  );
}

async function fetchPublicVideo(fetchImpl, initialUrl, signal) {
  let currentUrl = publicHttpsUrl(initialUrl);
  if (!currentUrl) return null;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      method: 'GET',
      headers: { Accept: 'video/*,application/octet-stream;q=0.8' },
      redirect: 'manual',
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers && response.headers.get && response.headers.get('location');
    if (!location || redirects === 3) return response;
    currentUrl = publicHttpsUrl(new URL(location, currentUrl).toString());
    if (!currentUrl) return null;
  }
  return null;
}

async function boundedResponseBuffer(response, maximumBytes, options = {}) {
  const tooLargeMessage = String(options.message || 'The gateway response exceeds the size limit.');
  const tooLargeCode = String(options.code || 'gateway-response-too-large');
  const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0;
  if (declaredLength > maximumBytes) {
    const error = new Error(tooLargeMessage);
    error.code = tooLargeCode;
    throw error;
  }
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maximumBytes) {
      const error = new Error(tooLargeMessage);
      error.code = tooLargeCode;
      throw error;
    }
    return buffer;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    received += buffer.length;
    if (received > maximumBytes) {
      try { await response.body.cancel(); } catch (error) {}
      const sizeError = new Error(tooLargeMessage);
      sizeError.code = tooLargeCode;
      throw sizeError;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, received);
}

function gatewayError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isGatewayTransportError(error) {
  if (!error || error.name === 'AbortError' || error.code) return false;
  const message = String(error.message || '').toLowerCase();
  return error.name === 'TypeError'
    || /fetch failed|network error|econnreset|etimedout|socket hang up|connection refused/i.test(message);
}

function validButlerImageDataUrl(value) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
  if (!match) return false;
  return Math.ceil(match[1].length * 0.75) <= MAX_BUTLER_IMAGE_BYTES;
}

function validButlerVideoDataUrl(value) {
  const match = /^data:video\/(?:mp4|quicktime|webm|x-matroska);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || ''));
  if (!match) return false;
  return Math.ceil(match[1].length * 0.75) <= MAX_BUTLER_VIDEO_BYTES;
}

function butlerVideoMime(buffer, requestedMime) {
  if (!validVideoBuffer(buffer) || buffer.length > MAX_BUTLER_VIDEO_BYTES) return '';
  const mime = String(requestedMime || '').trim().toLowerCase();
  const isEbml = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (isEbml && ['video/webm', 'video/x-matroska'].includes(mime)) return mime;
  if (!isEbml && ['video/mp4', 'video/quicktime'].includes(mime)) return mime;
  return '';
}

function validButlerTaskToken(value) {
  return /^[A-Za-z0-9._~-]{16,2048}$/.test(String(value || '').trim());
}

const BUTLER_IMAGE_TOOLS = new Set([
  // These providers create an opaque task token and therefore must also be
  // accepted by the status/download bridge after creation.
  'seededit-v3',
  'kling-image-expand',
  'qwen-image-edit-plus',
  'qwen-image-layered',
  'super-upscale-v2',
  'erase',
  'topaz-image-sharpen',
  'topaz-image-sharpen-gen',
  'topaz-image-enhance',
  'topaz-image-enhance-gen',
  'topaz-image-denoise',
  'topaz-image-restore',
  'topaz-image-lighting'
]);

function normalizedButlerImageTool(value) {
  const modelId = String(value || '').trim().toLowerCase();
  if (!BUTLER_IMAGE_TOOLS.has(modelId)) {
    throw gatewayError('The selected image tool is invalid.', 'invalid-image-tool');
  }
  return modelId;
}

function assertValidGlbBuffer(buffer, maximumBytes = MAX_GLB_BYTES) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > maximumBytes) {
    throw gatewayError(
      buffer && buffer.length > maximumBytes
        ? 'The generated 3D model exceeds the download size limit.'
        : 'The 3D provider returned an invalid GLB file.',
      buffer && buffer.length > maximumBytes ? 'media-too-large' : 'invalid-glb'
    );
  }
  if (buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2) {
    throw gatewayError('The 3D provider returned an invalid GLB file.', 'invalid-glb');
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw gatewayError('The 3D provider returned an incomplete GLB file.', 'invalid-glb');
  }

  let offset = 12;
  let chunkIndex = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw gatewayError('The 3D provider returned an incomplete GLB file.', 'invalid-glb');
    }
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > buffer.length) {
      throw gatewayError('The 3D provider returned an invalid GLB file.', 'invalid-glb');
    }
    if (chunkIndex === 0 && chunkType !== 0x4e4f534a) {
      throw gatewayError('The 3D provider returned a GLB file without a JSON scene.', 'invalid-glb');
    }
    if (chunkIndex === 0) {
      try {
        const jsonText = buffer.subarray(offset + 8, offset + 8 + chunkLength)
          .toString('utf8')
          .replace(/[\u0000\u0020]+$/g, '');
        const scene = JSON.parse(jsonText);
        if (!scene || typeof scene !== 'object' || String(scene.asset && scene.asset.version || '') !== '2.0') {
          throw new Error('invalid GLB asset');
        }
      } catch (error) {
        throw gatewayError('The 3D provider returned invalid GLB scene metadata.', 'invalid-glb');
      }
    }
    if (chunkIndex > 0 && (chunkIndex > 1 || chunkType !== 0x004e4942)) {
      throw gatewayError('The 3D provider returned an unsupported GLB layout.', 'invalid-glb');
    }
    offset += 8 + chunkLength;
    chunkIndex += 1;
  }
  if (!chunkIndex || offset !== buffer.length) {
    throw gatewayError('The 3D provider returned an invalid GLB file.', 'invalid-glb');
  }
  return buffer;
}

function requestAbortScope(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal && parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = Number(timeoutMs) > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Number(timeoutMs))
    : null;
  if (timer && typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    }
  };
}

class AiGatewayClient {
  constructor(options) {
    this.fetch = options.fetchImpl;
    this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    this.getAccessToken = options.getAccessToken;
    this.refreshAccessToken = options.refreshAccessToken;
  }

  isConfigured() {
    return Boolean(this.baseUrl);
  }

  async request(pathname, options = {}) {
    if (!this.isConfigured()) {
      const error = new Error('The secure AI gateway is not configured in this build.');
      error.code = 'gateway-not-configured';
      throw error;
    }
    let token = String(await this.getAccessToken() || '').trim();
    if (!token) throw gatewayError('Sign in is required to use online AI tools.', 'auth-required');
    const abortScope = requestAbortScope(options.signal, options.timeoutMs);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await this.fetch(`${this.baseUrl}${pathname}`, {
            method: options.method || 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: options.binary ? 'application/octet-stream' : 'application/json',
              ...(options.operationId ? { 'X-Idempotency-Key': String(options.operationId) } : {}),
              ...(options.rawBody !== undefined
                ? { 'Content-Type': String(options.contentType || 'application/octet-stream') }
                : options.body === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            ...(options.rawBody !== undefined
              ? { body: options.rawBody }
              : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            signal: abortScope.signal
          });
        } catch (error) {
          // Read-only calls (catalog/account/config/model discovery) can be
          // safely retried when the desktop briefly loses the Railway edge.
          // Paid creation requests do not opt into this path, so an ambiguous
          // submission is never replayed automatically.
          if (options.retryTransient && attempt === 0 && isGatewayTransportError(error)) {
            await abortableDelay(500, abortScope.signal);
            continue;
          }
          throw error;
        }
        if (!response.ok) {
          let payload = {};
          try {
            const errorBuffer = await boundedResponseBuffer(response, MAX_ERROR_BYTES);
            payload = JSON.parse(errorBuffer.toString('utf8'));
          } catch (error) {}
          const err = new Error(String(payload.message || payload.error || `Gateway request failed (HTTP ${response.status})`));
          err.code = String(payload.code || (response.status === 401 ? 'auth-required' : 'gateway-request-failed'));
          err.status = response.status;
          const requestId = String(response.headers && response.headers.get && response.headers.get('x-request-id') || '').trim();
          const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
          if (requestId) err.requestId = requestId;
          if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = Math.min(60_000, retryAfter * 1_000);
          const sessionRejected = response.status === 401 && ['invalid-session', 'auth-required'].includes(err.code);
          if (attempt === 0 && sessionRejected && typeof this.refreshAccessToken === 'function') {
            try {
              token = String(await this.refreshAccessToken() || '').trim();
            } catch (refreshError) {
              throw err;
            }
            if (token) continue;
          }
          if (options.retryTransient && attempt === 0
            && [408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
            const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
            const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(5_000, retryAfter * 1_000)
              : 500;
            await abortableDelay(delayMs, abortScope.signal);
            continue;
          }
          throw err;
        }
        if (options.binary) {
          const buffer = await boundedResponseBuffer(response, Number(options.maximumBytes) || MAX_VIDEO_BYTES, {
            message: options.tooLargeMessage || 'The generated media exceeds the download size limit.',
            code: 'media-too-large'
          });
          const estimatedCredits = numericResponseHeader(response, 'x-messs-credits-estimated');
          const creditsCharged = numericResponseHeader(response, 'x-messs-credits-charged');
          const deliveryRequestId = String(response.headers && (
            response.headers.get('x-messs-delivery-request-id')
            || response.headers.get('x-request-id')
          ) || '').trim();
          const deliveryPending = String(response.headers && response.headers.get('x-messs-delivery-pending') || '') === '1';
          const deliveryDurationMs = numericResponseHeader(response, 'x-messs-delivery-duration-ms');
          const deliveryContentType = String(response.headers && response.headers.get('content-type') || '').split(';', 1)[0].trim();
          if (Number.isFinite(estimatedCredits) && estimatedCredits >= 0) {
            setBufferMetadata(buffer, 'estimatedCredits', estimatedCredits);
          }
          if (Number.isFinite(creditsCharged) && creditsCharged >= 0) {
            setBufferMetadata(buffer, 'creditsCharged', creditsCharged);
          }
          if (deliveryPending) setBufferMetadata(buffer, 'deliveryPending', true);
          if (deliveryPending && deliveryRequestId) setBufferMetadata(buffer, 'deliveryRequestId', deliveryRequestId);
          if (deliveryPending && Number.isFinite(deliveryDurationMs) && deliveryDurationMs >= 0) {
            setBufferMetadata(buffer, 'deliveryDurationMs', deliveryDurationMs);
          }
          if (deliveryContentType) setBufferMetadata(buffer, 'deliveryContentType', deliveryContentType);
          return buffer;
        }
        const jsonBuffer = await boundedResponseBuffer(response, Number(options.maximumBytes) || MAX_JSON_BYTES);
        try {
          return JSON.parse(jsonBuffer.toString('utf8'));
        } catch (error) {
          throw gatewayError('The secure AI gateway returned an invalid response.', 'invalid-gateway-response');
        }
      }
      throw gatewayError('The secure AI gateway rejected the refreshed session.', 'invalid-session');
    } catch (error) {
      if (abortScope.didTimeOut()) throw gatewayError('The secure AI gateway timed out.', 'gateway-timeout');
      if (error && error.name === 'AbortError' && !(options.signal && options.signal.aborted)) {
        const interrupted = gatewayError(
          'The secure AI gateway connection was interrupted. Please retry.',
          'gateway-request-failed'
        );
        interrupted.status = 503;
        throw interrupted;
      }
      if (isGatewayTransportError(error)) {
        const interrupted = gatewayError(
          'The secure AI gateway connection was interrupted. Please retry.',
          'gateway-request-failed'
        );
        interrupted.status = 503;
        throw interrupted;
      }
      throw error;
    } finally {
      abortScope.dispose();
    }
  }

  async generateMedia(kind, request, signal, operationId = '') {
    if (kind === 'video') return this.generateVideo(request, signal, operationId);
    // The gateway caches image operations by this method's stable operation
    // ID. Retrying therefore resumes the same paid result after an edge or
    // large-response disconnect without submitting or charging it twice.
    return this.idempotentPaidRequest('/v1/media/image', {
      body: { ...request, deliveryConfirmation: true },
      binary: true,
      signal,
      operationId
    });
  }

  async idempotentPaidRequest(pathname, options = {}) {
    const requestedOperationId = String(options.operationId || '').trim();
    const operationId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestedOperationId)
      ? requestedOperationId
      : crypto.randomUUID();
    let lastError;
    const queueDeadline = Date.now() + 15 * 60_000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.request(pathname, { ...options, operationId });
      } catch (error) {
        lastError = error;
        const status = Number(error && error.status) || 0;
        const code = String(error && error.code || '').trim();
        const queued = ['gateway-queue-full', 'gateway-queue-timeout', 'rate-limited'].includes(code);
        if (queued && Date.now() < queueDeadline && !options.signal?.aborted) {
          const delay = Math.min(queueDeadline - Date.now(), Math.max(1000, Math.min(30_000, Number(error.retryAfterMs) || 5000)) + Math.floor(Math.random() * 1000));
          await abortableDelay(delay, options.signal);
          attempt -= 1;
          continue;
        }
        const transient = !status || [500, 502, 503, 504].includes(status)
          || ['gateway-timeout', 'gateway-request-failed', 'ai302-timeout', 'ai302-unavailable', 'ai302-rate-limited'].includes(code);
        if (options.signal && options.signal.aborted || !transient || attempt === 2) throw error;
        await abortableDelay(600 * (attempt + 1), options.signal);
      }
    }
    throw lastError;
  }

  async generateVideo(request, signal, requestedOperationId = '') {
    const normalizedOperationId = String(requestedOperationId || '').trim();
    const operationId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(normalizedOperationId)
      ? normalizedOperationId
      : crypto.randomUUID();
    const taskToken = `d_${crypto.randomBytes(32).toString('base64url')}`;
    const createBody = { ...request, operationId, taskToken };
    const created = await this.idempotentPaidRequest('/v1/media/video/tasks/create', {
      body: createBody, signal, operationId
    });

    let status = created || {};
    let transientFailures = 0;
    while (!['succeeded', 'failed', 'cancelled', 'expired'].includes(String(status.status || '').toLowerCase())) {
      const retryAfterMs = Math.max(2_000, Math.min(15_000, Number(status.retryAfterMs) || 5_000));
      await abortableDelay(retryAfterMs + Math.floor(Math.random() * 600), signal);
      try {
        status = await this.request('/v1/media/video/tasks/status', {
          body: { taskToken },
          timeoutMs: 15_000,
          signal
        });
        transientFailures = 0;
      } catch (error) {
        const statusCode = Number(error && error.status) || 0;
        if (signal && signal.aborted || statusCode > 0 && statusCode !== 429 && statusCode < 500) throw error;
        transientFailures += 1;
        status = {
          ...status,
          retryAfterMs: Math.min(30_000, 2_000 * (2 ** Math.min(4, transientFailures)))
        };
      }
    }

    if (String(status.status).toLowerCase() !== 'succeeded') {
      const error = new Error(String(status.errorMessage || 'Video generation failed.'));
      error.code = String(status.errorCode || `video-${String(status.status || 'failed').toLowerCase()}`);
      error.taskId = operationId;
      throw error;
    }

    let lastDownloadError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const buffer = await this.request('/v1/media/video/tasks/download', {
          body: { taskToken, deliveryConfirmation: true },
          binary: true,
          maximumBytes: MAX_VIDEO_BYTES,
          timeoutMs: 180_000,
          signal
        });
        if (!validVideoBuffer(buffer)) {
          const error = new Error('The video gateway returned an invalid media file.');
          error.code = 'invalid-media';
          throw error;
        }
        setBufferMetadata(buffer, 'deliveryTaskToken', taskToken);
        return buffer;
      } catch (error) {
        if (error && !Object.prototype.hasOwnProperty.call(error, 'deliveryTaskToken')) {
          Object.defineProperty(error, 'deliveryTaskToken', {
            value: taskToken,
            configurable: true
          });
        }
        if (signal && signal.aborted || error && ['media-too-large', 'unsafe-media-url', 'invalid-media'].includes(error.code)) throw error;
        lastDownloadError = error;
        if (attempt < 2) await abortableDelay(1_000 * (attempt + 1), signal);
      }
    }
    const deliveryError = lastDownloadError || new Error('The generated video could not be downloaded.');
    if (!Object.prototype.hasOwnProperty.call(deliveryError, 'deliveryTaskToken')) {
      Object.defineProperty(deliveryError, 'deliveryTaskToken', {
        value: taskToken,
        configurable: true
      });
    }
    deliveryError.taskId = operationId;
    throw deliveryError;
  }
  async uploadReferenceVideo(video, sourceMime, signal) {
    const mime = butlerVideoMime(video, sourceMime);
    if (!mime) throw gatewayError('The reference video is invalid or exceeds the upload size limit.', 'invalid-reference-video');
    const upload = await this.request('/v1/media/video/reference-uploads', {
      body: { size: video.length, mime },
      timeoutMs: 45 * 1000,
      signal
    });
    const uploadId = String(upload && upload.uploadId || '').trim();
    const chunkSize = Math.max(256 * 1024, Math.min(
      VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES,
      Math.round(Number(upload && upload.chunkSize) || VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES)
    ));
    if (!/^[A-Za-z0-9_-]{43}$/.test(uploadId)) {
      throw gatewayError('The gateway did not create a valid reference video upload.', 'invalid-gateway-response');
    }
    for (let offset = 0, index = 0; offset < video.length; offset += chunkSize, index += 1) {
      const chunk = video.subarray(offset, Math.min(video.length, offset + chunkSize));
      let lastError;
      for (let attempt = 0; attempt < VIDEO_UPLOAD_RETRIES; attempt += 1) {
        try {
          await this.request(`/v1/media/video/reference-uploads/${uploadId}/${index}`, {
            method: 'PUT',
            rawBody: chunk,
            timeoutMs: 90 * 1000,
            signal
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const status = Number(error && error.status) || 0;
          if (signal && signal.aborted || status > 0 && status < 500 || attempt === VIDEO_UPLOAD_RETRIES - 1) throw error;
          await abortableDelay(700 * (attempt + 1), signal);
        }
      }
      if (lastError) throw lastError;
    }
    return { uploadId };
  }

  async uploadReferenceAudio(audio, sourceMime, signal) {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
    const mime = String(sourceMime || '').trim().toLowerCase();
    if (!buffer.length || buffer.length > 32 * 1024 * 1024 || !['audio/wav', 'audio/mpeg', 'audio/mp3'].includes(mime)) {
      throw gatewayError('The reference audio is invalid or exceeds the upload size limit.', 'invalid-reference-audio');
    }
    const upload = await this.request('/v1/media/audio/reference-uploads', {
      body: { size: buffer.length, mime }, timeoutMs: 45 * 1000, signal
    });
    const uploadId = String(upload && upload.uploadId || '').trim();
    const chunkSize = Math.max(256 * 1024, Math.min(VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES, Math.round(Number(upload && upload.chunkSize) || VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES)));
    if (!/^[A-Za-z0-9_-]{43}$/.test(uploadId)) throw gatewayError('The gateway did not create a valid reference audio upload.', 'invalid-gateway-response');
    for (let offset = 0, index = 0; offset < buffer.length; offset += chunkSize, index += 1) {
      const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
      let lastError;
      for (let attempt = 0; attempt < VIDEO_UPLOAD_RETRIES; attempt += 1) {
        try {
          await this.request(`/v1/media/audio/reference-uploads/${uploadId}/${index}`, { method: 'PUT', rawBody: chunk, timeoutMs: 90 * 1000, signal });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const status = Number(error && error.status) || 0;
          if (signal && signal.aborted || status > 0 && status < 500 || attempt === VIDEO_UPLOAD_RETRIES - 1) throw error;
          await abortableDelay(700 * (attempt + 1), signal);
        }
      }
      if (lastError) throw lastError;
    }
    return { uploadId };
  }

  async chat(request, signal) {
    const payload = await this.request('/v1/chat', { body: request, signal });
    if (request.returnUsage === true) return { text: String(payload.text || ''), usage: payload.usage || null, creditsCharged: payload.creditsCharged ?? null };
    return String(payload.text || '');
  }

  discoverModels(providerId, signal) {
    return this.request(`/v1/models?providerId=${encodeURIComponent(providerId || '')}`, {
      method: 'GET',
      retryTransient: true,
      signal
    });
  }

  getImageStyles(providerId, signal) {
    return this.request(`/v1/media/image/styles?providerId=${encodeURIComponent(providerId || '')}`, {
      method: 'GET',
      retryTransient: true,
      signal
    });
  }

  getConfig(signal) {
    return this.request('/v1/config', { method: 'GET', retryTransient: true, signal });
  }

  getAccount(signal) {
    return this.request('/v1/account', { method: 'GET', retryTransient: true, signal });
  }

  async getUsageSummary(range = '7d', signal) {
    const parameters = new URLSearchParams();
    if (range && typeof range === 'object' && !Array.isArray(range)) {
      const from = String(range.from || '').slice(0, 10);
      const to = String(range.to || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        throw gatewayError('The custom usage date range is invalid.', 'invalid-usage-range');
      }
      parameters.set('from', from);
      parameters.set('to', to);
      parameters.set('tzOffset', String(Math.max(-840, Math.min(840, -new Date().getTimezoneOffset()))));
    } else {
      const normalized = String(range || '7d').trim().toLowerCase();
      const value = normalized === '7' || normalized === '7d'
        ? '7d'
        : normalized === '30' || normalized === '30d'
          ? '30d'
          : normalized === 'all'
            ? 'all'
            : '';
      if (!value) throw gatewayError('The usage range is invalid.', 'invalid-usage-range');
      parameters.set('range', value);
    }
    const payload = await this.request(`/v1/usage/summary?${parameters.toString()}`, {
      method: 'GET',
      retryTransient: true,
      signal
    });
    return payload && payload.summary ? payload.summary : null;
  }

  async getCanvasUsage(canvasId, signal) {
    const normalized = String(canvasId || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(normalized)) {
      throw gatewayError('The canvas identity is invalid.', 'invalid-canvas-id');
    }
    const payload = await this.request(`/v1/usage/canvas?canvasId=${encodeURIComponent(normalized)}`, {
      method: 'GET',
      retryTransient: true,
      signal
    });
    return payload && payload.usage ? payload.usage : null;
  }

  quoteMediaCredits(request = {}, signal) {
    return this.request('/v1/usage/quote', {
      body: request,
      timeoutMs: 15 * 1000,
      signal
    });
  }

  confirmMediaDelivery(requestId, durationMs = 0, signal) {
    return this.request('/v1/usage/delivery', {
      body: {
        requestId: String(requestId || '').trim(),
        delivered: true,
        durationMs: Math.max(0, Math.round(Number(durationMs) || 0))
      },
      retryTransient: true,
      signal
    });
  }

  releaseMediaDelivery(requestId, durationMs = 0, signal) {
    return this.request('/v1/usage/delivery', {
      body: {
        requestId: String(requestId || '').trim(),
        delivered: false,
        durationMs: Math.max(0, Math.round(Number(durationMs) || 0))
      },
      retryTransient: true,
      signal
    });
  }

  confirmVideoDelivery(taskToken, details = {}, signal) {
    return this.request('/v1/media/video/tasks/confirm', {
      body: {
        taskToken: String(taskToken || '').trim(),
        contentType: String(details.contentType || 'video/mp4').slice(0, 128),
        bytes: Math.max(0, Math.round(Number(details.bytes) || 0))
      },
      retryTransient: true,
      signal
    });
  }

  releaseVideoDelivery(taskToken, signal) {
    return this.request('/v1/media/video/tasks/release', {
      body: { taskToken: String(taskToken || '').trim() },
      retryTransient: true,
      signal
    });
  }

  redeemCode(code, signal) {
    return this.request('/v1/account/redeem', {
      body: { code: String(code || '') },
      signal
    });
  }

  removeBackground(imageDataUrl, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    return this.idempotentPaidRequest('/v1/tools/background/remove', {
      body: { imageDataUrl, options, deliveryConfirmation: true },
      binary: true,
      maximumBytes: MAX_BACKGROUND_BYTES,
      tooLargeMessage: 'The background removal result exceeds the download size limit.',
      timeoutMs: 12 * 60 * 1000,
      signal
    });
  }

  editImage(imageDataUrl, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    const prompt = String(options && options.prompt || '').trim().slice(0, 1200);
    if (!prompt) throw gatewayError('Enter an image-edit prompt.', 'invalid-prompt');
    return this.idempotentPaidRequest('/v1/tools/image/edit', {
      body: { modelId: 'seededit-v3', imageDataUrl, options: { ...options, prompt } },
      timeoutMs: 3 * 60 * 1000,
      signal
    });
  }

  expandImage(imageDataUrl, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    return this.idempotentPaidRequest('/v1/tools/image/expand', {
      body: { modelId: 'clipdrop-uncrop', imageDataUrl, options, deliveryConfirmation: true },
      binary: true,
      maximumBytes: MAX_BUTLER_IMAGE_RESULT_BYTES,
      tooLargeMessage: 'The expanded image exceeds the download size limit.',
      timeoutMs: 12 * 60 * 1000,
      signal
    });
  }

  layerImage(imageDataUrl, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    const numLayers = Math.max(2, Math.min(8, Math.round(Number(options && options.numLayers) || 4)));
    const prompt = String(options && options.prompt || '').trim().slice(0, 800);
    return this.idempotentPaidRequest('/v1/tools/image/layer', {
      body: { modelId: 'qwen-image-layered', imageDataUrl, options: { ...options, numLayers, prompt } },
      timeoutMs: 3 * 60 * 1000,
      signal
    });
  }

  upscaleImage(imageDataUrl, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    return this.idempotentPaidRequest('/v1/tools/image/upscale', {
      body: { modelId: 'clipdrop-upscale', imageDataUrl, deliveryConfirmation: true },
      binary: true,
      maximumBytes: MAX_BUTLER_IMAGE_RESULT_BYTES,
      tooLargeMessage: 'The enhanced image exceeds the download size limit.',
      timeoutMs: 12 * 60 * 1000,
      signal
    });
  }

  eraseObject(imageDataUrl, maskDataUrl, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl) || !validButlerImageDataUrl(maskDataUrl)) {
      throw gatewayError('The Butler image or mask is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    return this.idempotentPaidRequest('/v1/tools/image/erase', {
      body: {
        modelId: 'cleanup',
        imageDataUrl,
        maskDataUrl,
        options: {
          maskWidth: Math.max(1, Math.min(5000, Math.round(Number(options && options.maskWidth) || 1))),
          maskHeight: Math.max(1, Math.min(5000, Math.round(Number(options && options.maskHeight) || 1)))
        },
        deliveryConfirmation: true
      },
      binary: true,
      maximumBytes: MAX_BUTLER_IMAGE_RESULT_BYTES,
      tooLargeMessage: 'The erased image exceeds the download size limit.',
      timeoutMs: 12 * 60 * 1000,
      signal
    });
  }

  runImageTool(imageDataUrl, modelId, options = {}, signal) {
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    const normalizedModelId = normalizedButlerImageTool(modelId);
    if (!normalizedModelId.startsWith('topaz-image-') && normalizedModelId !== 'kling-image-expand') {
      throw gatewayError('The selected asynchronous image tool is invalid.', 'invalid-image-tool');
    }
    const pathname = normalizedModelId === 'kling-image-expand'
      ? '/v1/tools/image/expand'
      : '/v1/tools/image/topaz';
    return this.idempotentPaidRequest(pathname, {
      body: { modelId: normalizedModelId, imageDataUrl, options },
      timeoutMs: 3 * 60 * 1000,
      signal
    });
  }

  getImageToolStatus(taskToken, modelId, signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The image tool task token is invalid.', 'invalid-task-token');
    }
    return this.request('/v1/tools/image/status', {
      body: {
        taskToken: String(taskToken).trim(),
        modelId: normalizedButlerImageTool(modelId)
      },
      timeoutMs: 45 * 1000,
      signal
    });
  }

  async downloadImageToolResult(taskToken, modelId, resultCount = 1, signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The image tool task token is invalid.', 'invalid-task-token');
    }
    const normalizedModelId = normalizedButlerImageTool(modelId);
    const count = Math.max(1, Math.min(8, Math.round(Number(resultCount) || 1)));
    const results = [];
    for (let index = 0; index < count; index += 1) {
      results.push(await this.request('/v1/tools/image/download', {
        body: {
          taskToken: String(taskToken).trim(),
          modelId: normalizedModelId,
          index,
          deliveryConfirmation: true
        },
        binary: true,
        maximumBytes: MAX_BUTLER_IMAGE_RESULT_BYTES,
        tooLargeMessage: 'The processed image exceeds the download size limit.',
        timeoutMs: 3 * 60 * 1000,
        signal
      }));
    }
    return results;
  }

  create3d(providerId, imageDataUrl, prompt, options = {}, signal) {
    const normalizedProvider = String(providerId || 'hunyuan3d').trim().toLowerCase();
    if (!['hunyuan3d', 'hyper3d', 'tripo3d'].includes(normalizedProvider)) {
      throw gatewayError('The 3D provider is invalid.', 'invalid-3d-provider');
    }
    if (!validButlerImageDataUrl(imageDataUrl)) {
      throw gatewayError('The Butler image is invalid or exceeds the upload size limit.', 'invalid-butler-image');
    }
    const cleanPrompt = String(prompt || '').trim().slice(0, 1024);
    return this.idempotentPaidRequest('/v1/tools/3d/create', {
      body: { providerId: normalizedProvider, imageDataUrl, prompt: cleanPrompt, options },
      timeoutMs: 3 * 60 * 1000,
      signal
    });
  }

  get3dStatus(taskToken, signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The 3D task token is invalid.', 'invalid-task-token');
    }
    return this.request('/v1/tools/3d/status', {
      body: { taskToken: String(taskToken).trim() },
      timeoutMs: 45 * 1000,
      signal
    });
  }

  async download3d(taskToken, signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The 3D task token is invalid.', 'invalid-task-token');
    }
    const buffer = await this.request('/v1/tools/3d/download', {
      body: { taskToken: String(taskToken).trim(), deliveryConfirmation: true },
      binary: true,
      maximumBytes: MAX_GLB_BYTES,
      tooLargeMessage: 'The generated 3D model exceeds the download size limit.',
      timeoutMs: 3 * 60 * 1000,
      signal
    });
    return assertValidGlbBuffer(buffer);
  }

  async upscaleVideo(video, options = {}, signal) {
    const modelId = String(options && options.modelId || 'topaz-video-upscale').trim().toLowerCase();
    if (modelId !== 'topaz-video-upscale') {
      throw gatewayError('The selected video tool is invalid.', 'invalid-video-tool');
    }
    if (!Buffer.isBuffer(video)) {
      if (!validButlerVideoDataUrl(video)) {
        throw gatewayError('The Butler video is invalid or exceeds the upload size limit.', 'invalid-butler-video');
      }
      return this.idempotentPaidRequest('/v1/tools/video/upscale', {
        body: { modelId, videoDataUrl: video, options },
        timeoutMs: 12 * 60 * 1000,
        signal
      });
    }
    const sourceMime = butlerVideoMime(video, options && options.sourceMime);
    if (!sourceMime) {
      throw gatewayError('The Butler video is invalid or exceeds the upload size limit.', 'invalid-butler-video');
    }
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const reportProgress = (payload) => {
      if (!onProgress) return;
      try { onProgress(payload); } catch (error) {}
    };
    const safeOptions = { ...options };
    delete safeOptions.sourceMime;
    delete safeOptions.onProgress;
    const upload = await this.request('/v1/tools/video/uploads', {
      body: { size: video.length, mime: sourceMime },
      timeoutMs: VIDEO_UPLOAD_SESSION_TIMEOUT_MS,
      signal
    });
    const uploadId = String(upload && upload.uploadId || '').trim();
    const chunkSize = Math.max(
      256 * 1024,
      Math.min(VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES, Math.round(Number(upload && upload.chunkSize) || VIDEO_UPLOAD_FALLBACK_CHUNK_BYTES))
    );
    if (!/^[A-Za-z0-9_-]{43}$/.test(uploadId)) {
      throw gatewayError('The gateway did not create a valid video upload.', 'invalid-gateway-response');
    }
    reportProgress({ phase: 'uploading', progress: 0, uploadedBytes: 0, totalBytes: video.length });
    for (let offset = 0, index = 0; offset < video.length; offset += chunkSize, index += 1) {
      const chunk = video.subarray(offset, Math.min(video.length, offset + chunkSize));
      let lastError;
      for (let attempt = 0; attempt < VIDEO_UPLOAD_RETRIES; attempt += 1) {
        try {
          await this.request(`/v1/tools/video/uploads/${uploadId}/${index}`, {
            method: 'PUT',
            rawBody: chunk,
            timeoutMs: VIDEO_UPLOAD_CHUNK_TIMEOUT_MS,
            signal
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const status = Number(error && error.status) || 0;
          const code = String(error && error.code || '').trim();
          const transient = !status || status === 408 || status === 425 || status === 429 || status >= 500
            || ['gateway-timeout', 'gateway-request-failed', 'rate-limited'].includes(code);
          if (signal && signal.aborted || !transient || attempt === VIDEO_UPLOAD_RETRIES - 1) throw error;
          await abortableDelay(Math.min(8_000, 700 * (attempt + 1) ** 2), signal);
        }
      }
      if (lastError) throw lastError;
      const uploadedBytes = Math.min(video.length, offset + chunk.length);
      reportProgress({
        phase: 'uploading',
        progress: Math.round(uploadedBytes / video.length * 100),
        uploadedBytes,
        totalBytes: video.length
      });
    }
    reportProgress({ phase: 'creating', progress: 100, uploadedBytes: video.length, totalBytes: video.length });
    return this.idempotentPaidRequest('/v1/tools/video/upscale', {
      body: { modelId, uploadId, options: safeOptions },
      timeoutMs: VIDEO_CREATE_TIMEOUT_MS,
      signal
    });
  }

  getVideoToolStatus(taskToken, modelId = 'topaz-video-upscale', signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The video tool task token is invalid.', 'invalid-task-token');
    }
    if (String(modelId || '').trim().toLowerCase() !== 'topaz-video-upscale') {
      throw gatewayError('The selected video tool is invalid.', 'invalid-video-tool');
    }
    return this.request('/v1/tools/video/status', {
      body: { taskToken: String(taskToken).trim() },
      timeoutMs: 45 * 1000,
      signal
    });
  }

  async downloadVideoToolResult(taskToken, modelId = 'topaz-video-upscale', signal) {
    if (!validButlerTaskToken(taskToken)) {
      throw gatewayError('The video tool task token is invalid.', 'invalid-task-token');
    }
    if (String(modelId || '').trim().toLowerCase() !== 'topaz-video-upscale') {
      throw gatewayError('The selected video tool is invalid.', 'invalid-video-tool');
    }
    const buffer = await this.request('/v1/tools/video/download', {
      body: { taskToken: String(taskToken).trim(), deliveryConfirmation: true },
      binary: true,
      maximumBytes: MAX_VIDEO_BYTES,
      tooLargeMessage: 'The enhanced video exceeds the download size limit.',
      timeoutMs: 5 * 60 * 1000,
      signal
    });
    if (!validVideoBuffer(buffer)) {
      throw gatewayError('The video enhancement service returned an invalid media file.', 'invalid-media');
    }
    return buffer;
  }
}

module.exports = { AiGatewayClient, assertValidGlbBuffer };
