const VIDEO_RESULT_BUCKET = 'messs-ai-video-results';
const MAX_VIDEO_RESULT_BYTES = 256 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const STORAGE_REF = new RegExp(`^storage://${VIDEO_RESULT_BUCKET}/(${UUID})/(${UUID})\\.(mp4|webm|mov)$`, 'i');

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');

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
  const bytes = Buffer.from(buffer || []);
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

export function isStoredVideoResult(reference, userId, requestId) {
  return Boolean(parseReference(reference, userId, requestId));
}

export async function storeVideoResult(userId, requestId, buffer, contentType = '', fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('video-result-storage-failed', 'The video result identity is invalid.', 400);
  }
  const video = Buffer.from(buffer || []);
  const type = videoType(video, contentType);
  if (!type || !video.length || video.length > MAX_VIDEO_RESULT_BYTES) {
    throw serviceError('video-result-storage-failed', 'The generated video cannot be stored safely.', 502);
  }
  const key = `${String(userId).toLowerCase()}/${String(requestId).toLowerCase()}.${type.extension}`;
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
    throw serviceError('video-result-storage-failed', 'The generated video could not be stored safely.');
  }
  if (!response.ok) throw serviceError('video-result-storage-failed', 'The generated video could not be stored safely.');
  return `storage://${VIDEO_RESULT_BUCKET}/${key}`;
}

export async function readStoredVideoResult(userId, requestId, reference, fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('video-result-storage-invalid', 'The stored video result is invalid.', 502);
  }
  const parsed = parseReference(reference, userId, requestId);
  if (!parsed) throw serviceError('video-result-storage-missing', 'The saved video result is not available yet.', 404);
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
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = videoType(bytes, response.headers.get('content-type'));
  if (!type || !bytes.length || bytes.length > MAX_VIDEO_RESULT_BYTES) {
    throw serviceError('video-result-storage-invalid', 'The saved video result is invalid.', 502);
  }
  return { buffer: bytes, contentType: type.contentType };
}
