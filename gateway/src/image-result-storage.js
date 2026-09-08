import { getR2Media, putR2Media, r2MediaConfigured } from './r2-media-storage.js';

const supabaseUrl = String(process.env.SUPABASE_URL || 'https://trmbhcniijedpmohkbzx.supabase.co').replace(/\/$/, '');
const IMAGE_RESULT_BUCKET = 'messs-ai-image-results';
const MAX_IMAGE_RESULT_BYTES = 64 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const STORAGE_REF = new RegExp(`^storage://${IMAGE_RESULT_BUCKET}/(${UUID})/(${UUID})\\.(png|jpg|webp|gif|avif)$`, 'i');

function serviceError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function serviceHeaders() {
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) throw serviceError('image-result-storage-not-configured', 'Image recovery storage is not configured.');
  return {
    apikey: secret,
    ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` })
  };
}

function validUuid(value) {
  return new RegExp(`^${UUID}$`, 'i').test(String(value || '').trim());
}

function imageType(buffer) {
  const bytes = Buffer.from(buffer || []);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a'
      || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { extension: 'gif', contentType: 'image/gif' };
  }
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
      && bytes.subarray(8, 16).toString('ascii').includes('avif')) {
    return { extension: 'avif', contentType: 'image/avif' };
  }
  return null;
}

function parseReference(reference, userId, requestId) {
  const match = STORAGE_REF.exec(String(reference || '').trim());
  if (!match || String(match[1]).toLowerCase() !== String(userId || '').trim().toLowerCase()
      || String(match[2]).toLowerCase() !== String(requestId || '').trim().toLowerCase()) {
    return null;
  }
  return {
    userId: match[1].toLowerCase(),
    requestId: match[2].toLowerCase(),
    extension: match[3].toLowerCase(),
    key: `${match[1].toLowerCase()}/${match[2].toLowerCase()}.${match[3].toLowerCase()}`
  };
}

function storageUrl(key) {
  return `${supabaseUrl}/storage/v1/object/${IMAGE_RESULT_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function isStoredImageResult(reference, userId, requestId) {
  return Boolean(parseReference(reference, userId, requestId));
}

export async function storeImageResult(userId, requestId, buffer, fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('image-result-storage-failed', 'The image result identity is invalid.', 400);
  }
  const image = Buffer.from(buffer || []);
  const type = imageType(image);
  if (!type || !image.length || image.length > MAX_IMAGE_RESULT_BYTES) {
    throw serviceError('image-result-storage-failed', 'The generated image cannot be stored safely.', 502);
  }
  const key = `${String(userId).toLowerCase()}/${String(requestId).toLowerCase()}.${type.extension}`;
  if (r2MediaConfigured()) {
    try {
      await putR2Media(`image/${key}`, image, type.contentType);
    } catch {
      throw serviceError('image-result-storage-failed', 'The generated image could not be stored safely.');
    }
    return `storage://${IMAGE_RESULT_BUCKET}/${key}`;
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
      body: image,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw serviceError('image-result-storage-failed', 'The generated image could not be stored safely.');
  }
  if (!response.ok) {
    throw serviceError('image-result-storage-failed', 'The generated image could not be stored safely.');
  }
  return `storage://${IMAGE_RESULT_BUCKET}/${key}`;
}

export async function readStoredImageResult(userId, requestId, reference, fetchImpl = fetch) {
  if (!validUuid(userId) || !validUuid(requestId)) {
    throw serviceError('image-result-storage-invalid', 'The stored image result is invalid.', 502);
  }
  const parsed = parseReference(reference, userId, requestId);
  const keys = parsed
    ? [parsed.key]
    : ['png', 'jpg', 'webp', 'gif', 'avif'].map((extension) => (
      `${String(userId).toLowerCase()}/${String(requestId).toLowerCase()}.${extension}`
    ));
  let missing = true;
  for (const key of keys) {
    if (r2MediaConfigured()) {
      let stored;
      try { stored = await getR2Media(`image/${key}`, MAX_IMAGE_RESULT_BYTES); }
      catch { throw serviceError('image-result-storage-unavailable', 'The saved image result is temporarily unavailable.'); }
      if (stored) {
        if (!imageType(stored.body) || !stored.body.length || stored.body.length > MAX_IMAGE_RESULT_BYTES) {
          throw serviceError('image-result-storage-invalid', 'The saved image result is invalid.', 502);
        }
        return stored.body;
      }
    }
    let response;
    try {
      response = await fetchImpl(storageUrl(key), {
        headers: { ...serviceHeaders(), Accept: 'image/*,application/octet-stream' },
        signal: AbortSignal.timeout(90_000)
      });
    } catch (error) {
      throw serviceError('image-result-storage-unavailable', 'The saved image result is temporarily unavailable.');
    }
    if (response.status === 404) continue;
    missing = false;
    if (!response.ok) {
      throw serviceError('image-result-storage-unavailable', 'The saved image result is temporarily unavailable.');
    }
    const advertised = Number(response.headers.get('content-length')) || 0;
    if (advertised > MAX_IMAGE_RESULT_BYTES) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw serviceError('image-result-storage-invalid', 'The saved image result exceeds the safe size limit.', 502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!imageType(bytes) || !bytes.length || bytes.length > MAX_IMAGE_RESULT_BYTES) {
      throw serviceError('image-result-storage-invalid', 'The saved image result is invalid.', 502);
    }
    return bytes;
  }
  if (missing) throw serviceError('image-result-storage-missing', 'The saved image result is not available yet.', 404);
  throw serviceError('image-result-storage-invalid', 'The saved image result is invalid.', 502);
}
