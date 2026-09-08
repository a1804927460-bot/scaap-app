import { getR2Media, putR2Media, r2MediaConfigured } from './r2-media-storage.js';

const VIDEO_RESULT_BUCKET = 'messs-ai-video-results';
const MAX_VIDEO_RESULT_BYTES = 256 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const STORAGE_REF = new RegExp(`^storage://${VIDEO_RESULT_BUCKET}/(${UUID})/(${UUID})\\.(mp4|webm|mov)$`, 'i');

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const MAX_PROVIDER_DOWNLOAD_BYTES = MAX_VIDEO_RESULT_BYTES;

function serviceError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function serviceHeaders() {
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) throw serviceError('video-result-storage-not-configured', 'Video recovery storage is not configured.');
  return {
    apikey: secret,
    ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` })
  };
}

function validUuid(value) {
  return new RegExp(`^${UUID}$`, 'i').test(String(value || '').trim());
}

function videoType(buffer, suppliedType = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalized = String(suppliedType || '').toLowerCase().split(';', 1)[0];
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const extension = normalized === 'video/quicktime' ? 'mov' : 'mp4';
    return { extension, contentType: normalized.startsWith('video/') ? normalized : 'video/mp4' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { extension: 'webm', contentType: normalized === 'video/webm' ? normalized : 'video/webm' };
  }
  return null;
}

function storageUrl(key) {
  return `${supabaseUrl}/storage/v1/object/${VIDEO_RESULT_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function parseReference(reference, userId, requestId) {
  const match = STORAGE_REF.exec(String(reference || '').trim());
  if (!match || String(match[1]).toLowerCase() !== String(userId || '').trim().toLowerCase()
      || String(match[2]).toLowerCase() !== String(requestId || '').trim().toLowerCase()) return null;
  return {
    key: `${match[1].toLowerCase()}/${match[2].toLowerCase()}.${match[3].toLowerCase()}`,
    extension: match[3].toLowerCase()
  };
}

function publicProviderUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')) return '';
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return '';
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export async function downloadProviderVideoResult(downloadUrl, fetchImpl = fetch) {
  const safeUrl = publicProviderUrl(downloadUrl);
  if (!safeUrl) throw serviceError('video-result-download-failed', 'The provider video URL is invalid.', 502);
  let response;
  try {
    response = await fetchImpl(safeUrl, {
      redirect: 'follow',
      headers: { Accept: 'video/mp4,video/quicktime,video/webm,application/octet-stream' },
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    throw Object.assign(
      serviceError('video-result-download-failed', 'The provider video could not be downloaded.', 502),
      { retryable: true }
    );
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw Object.assign(serviceError('video-result-download-failed', 'The provider video could not be downloaded.', 502), { retryable });
  }
  const redirectedUrl = publicProviderUrl(response.url || safeUrl);
  if (!redirectedUrl) {
    if (response.body?.cancel) await response.body.cancel().catch(() => {});
    throw serviceError('video-result-download-failed', 'The provider video redirect is invalid.', 502);
  }
  const advertised = Number(response.headers?.get('content-length')) || 0;
  if (advertised > MAX_PROVIDER_DOWNLOAD_BYTES) {
    if (response.body?.cancel) await response.body.cancel().catch(() => {});
    throw serviceError('video-result-download-failed', 'The provider video is too large.', 502);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (total > MAX_PROVIDER_DOWNLOAD_BYTES) {
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
      throw serviceError('video-result-download-failed', 'The provider video is too large.', 502);
    }
    chunks.push(part);
  }
  const buffer = Buffer.concat(chunks, total);
  const suppliedType = String(response.headers?.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  const type = videoType(buffer, suppliedType);
  if (!type || !buffer.length) throw serviceError('video-result-download-failed', 'The provider returned an invalid video.', 502);
  return { buffer, contentType: type.contentType };
}

export function isStoredVideoResult(reference, userId, requestId) {
  return Boolean(parseReference(reference, userId, requestId));
}

export async function storeVideoResult(userId, requestId, buffer, contentType = '', fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('video-result-storage-failed', 'The video result identity is invalid.', 400);
  }
  const video = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const type = videoType(video, contentType);
  if (!type || !video.length || video.length > MAX_VIDEO_RESULT_BYTES) {
    throw serviceError('video-result-storage-failed', 'The generated video cannot be stored safely.', 502);
  }
  const key = `${String(userId).toLowerCase()}/${String(requestId).toLowerCase()}.${type.extension}`;
  if (r2MediaConfigured()) {
    try {
      await putR2Media(`video/${key}`, video, type.contentType);
    } catch (error) {
      throw Object.assign(serviceError('video-result-storage-failed', 'The generated video could not be stored safely.'), { retryable: true });
    }
    return `storage://${VIDEO_RESULT_BUCKET}/${key}`;
  }
  let response;
  try {
    response = await fetchImpl(storageUrl(key), {
      method: 'PUT',
      headers: {
        ...serviceHeaders(),
        'Content-Type': type.contentType,
        'x-upsert': 'true',
        'cache-control': '31536000'
      },
      body: video,
      signal: AbortSignal.timeout(90_000)
    });
  } catch (error) {
    throw Object.assign(
      serviceError('video-result-storage-failed', 'The generated video could not be stored safely.'),
      { retryable: true }
    );
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw Object.assign(
      serviceError('video-result-storage-failed', 'The generated video could not be stored safely.'),
      { retryable }
    );
  }
  return `storage://${VIDEO_RESULT_BUCKET}/${key}`;
}

export async function readStoredVideoResult(userId, requestId, reference, fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('video-result-storage-invalid', 'The stored video result is invalid.', 502);
  }
  const parsed = parseReference(reference, userId, requestId);
  if (!parsed) throw serviceError('video-result-storage-missing', 'The saved video result is not available yet.', 404);
  if (r2MediaConfigured()) {
    let stored;
    try { stored = await getR2Media(`video/${parsed.key}`, MAX_VIDEO_RESULT_BYTES); }
    catch { throw serviceError('video-result-storage-unavailable', 'The saved video result is temporarily unavailable.'); }
    if (stored) {
      const type = videoType(stored.body, stored.contentType);
      if (!type || !stored.body.length || stored.body.length > MAX_VIDEO_RESULT_BYTES) {
        throw serviceError('video-result-storage-invalid', 'The saved video result is invalid.', 502);
      }
      return { buffer: stored.body, contentType: type.contentType };
    }
  }
  let response;
  try {
    response = await fetchImpl(storageUrl(parsed.key), {
      headers: { ...serviceHeaders(), Accept: 'video/*,application/octet-stream' },
      signal: AbortSignal.timeout(120_000)
    });
  } catch (error) {
    throw serviceError('video-result-storage-unavailable', 'The saved video result is temporarily unavailable.');
  }
  if (response.status === 404) throw serviceError('video-result-storage-missing', 'The saved video result is not available yet.', 404);
  if (!response.ok) throw serviceError('video-result-storage-unavailable', 'The saved video result is temporarily unavailable.');
  const advertised = Number(response.headers.get('content-length')) || 0;
  if (advertised > MAX_VIDEO_RESULT_BYTES) throw serviceError('video-result-storage-invalid', 'The saved video result is too large.', 502);
  // Enforce the limit while reading; chunked storage responses may omit size.
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body || []) {
      total += chunk.length;
      if (total > MAX_VIDEO_RESULT_BYTES) {
        throw serviceError('video-result-storage-invalid', 'The saved video result is too large.', 502);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code === 'video-result-storage-invalid') throw error;
    throw serviceError('video-result-storage-unavailable', 'The saved video download was interrupted.');
  }
  const bytes = Buffer.concat(chunks, total);
  const type = videoType(bytes, response.headers.get('content-type'));
  if (!type || !bytes.length || bytes.length > MAX_VIDEO_RESULT_BYTES) {
    throw serviceError('video-result-storage-invalid', 'The saved video result is invalid.', 502);
  }
  return { buffer: bytes, contentType: type.contentType };
}
