import crypto from 'node:crypto';
import net from 'node:net';
import { quoteTopazRetailCredits } from './tool-pricing.js';

const API_ORIGIN = 'https://api.302.ai';
const BACKGROUND_PATH = '/photoroom/v1/segment?response_format=url';
const HUNYUAN_PATH = '/tencent/hunyuan3d/pro-job';
const HYPER3D_PATH = '/302/submit/hyper3d-rodin';
const TOPAZ_VIDEO_UPLOAD_PATH = '/topazlabs/video/upload';
const TOPAZ_VIDEO_STATUS_PATH = '/topazlabs/video';
const REQUEST_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 20_000;
const ASSET_TIMEOUT_MS = 90_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_BACKGROUND_INPUT_BYTES = 24 * 1024 * 1024;
const MAX_3D_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_INPUT_BYTES = 48 * 1024 * 1024;
const MAX_BACKGROUND_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_GLB_BYTES = 256 * 1024 * 1024;
const MAX_VIDEO_OUTPUT_BYTES = 256 * 1024 * 1024;
const TASK_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
const TASK_TOKEN_AAD = Buffer.from('messs:ai302-3d-task:v1', 'utf8');
const VIDEO_TASK_TOKEN_AAD = Buffer.from('messs:ai302-video-task:v1', 'utf8');
const RELAY_ASSET_TTL_MS = 15 * 60 * 1000;
const VIDEO_RELAY_ASSET_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RELAY_ASSET_ENTRIES = 64;
const MAX_RELAY_ASSET_BYTES = 128 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const THREE_D_PROVIDERS = new Set(['hunyuan3d', 'hyper3d']);
const TOPAZ_VIDEO_PROVIDER = 'topaz-video-upscale';
const QUEUED_STATES = new Set(['CREATED', 'IN_QUEUE', 'PENDING', 'QUEUED', 'QUEUEING', 'WAIT', 'WAITING']);
const PROCESSING_STATES = new Set(['PROCESSING', 'RUNNING', 'RUN', 'IN_PROGRESS', 'GENERATING']);
const SUCCESS_STATES = new Set(['DONE', 'SUCCESS', 'SUCCEEDED', 'COMPLETED']);
const FAILURE_STATES = new Set(['FAIL', 'FAILED', 'ERROR', 'CANCELED', 'CANCELLED', 'EXPIRED']);
const TOPAZ_VIDEO_FILTER_MODELS = new Set([
  'aaa-9', 'ahq-12', 'alq-13', 'alqs-2', 'amq-13', 'amqs-2', 'ddv-3',
  'dtd-4', 'dtds-2', 'dtv-4', 'dtvs-2', 'gcg-5', 'ghq-5', 'iris-2',
  'iris-3', 'nxf-1', 'nyx-3', 'prob-4', 'rhea-1', 'rxl-1', 'thd-3',
  'thf-4', 'thm-2', 'aion-1', 'apf-2', 'apo-8', 'chf-3', 'chr-2'
]);
const PRIVATE_INPUT_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk[-_][A-Za-z0-9_-]{8,}\b/i,
  /\b(?:ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i,
  /\b(?:postgres|postgresql|mysql):\/\/[^\s:/]+:[^\s@]+@/i
];
const relayAssets = new Map();
let relayAssetBytes = 0;
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}

function toolError(code, message, status = 500) {
  return Object.assign(new Error(message), { code, status });
}

function configuredApiKey(explicitKey) {
  const key = String(explicitKey ?? process.env.AI302_KEY ?? process.env.AI_302_API_KEY ?? '').trim();
  if (!key) throw toolError('ai302-not-configured', 'The 302 tool gateway is not configured.', 503);
  if (key.length > 4096 || /[\r\n]/.test(key)) {
    throw toolError('ai302-not-configured', 'The 302 tool gateway credential is invalid.', 503);
  }
  return key;
}

function configuredTaskSecret(apiKey, explicitSecret) {
  const secret = String(explicitSecret ?? process.env.AI302_TASK_SECRET ?? apiKey).trim();
  if (!secret || secret.length > 8192 || /[\r\n]/.test(secret)) {
    throw toolError('ai302-not-configured', 'The 302 task-token secret is invalid.', 503);
  }
  return crypto
    .createHash('sha256')
    .update('messs:ai302-task-secret:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function invalidTaskToken() {
  return toolError('three-d-task-not-found', '3D task not found.', 404);
}

function createTaskToken(providerId, jobId, userId, key, now = Date.now()) {
  const issuedAt = Math.floor(Number(now) / 1000);
  const payload = Buffer.from(JSON.stringify({
    p: providerId,
    j: jobId,
    u: userId,
    i: issuedAt,
    e: issuedAt + Math.floor(TASK_TOKEN_TTL_MS / 1000)
  }), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(TASK_TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `v1.${base64url(iv)}.${base64url(ciphertext)}.${base64url(cipher.getAuthTag())}`;
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
    const jobId = String(payload && payload.j || '');
    const ownerId = String(payload && payload.u || '');
    const issuedAt = Number(payload && payload.i);
    const expiresAt = Number(payload && payload.e);
    if (
      !THREE_D_PROVIDERS.has(providerId)
      || !jobId || jobId.length > 512 || /[\u0000-\u001f\u007f]/.test(jobId)
      || !ownerId || ownerId !== String(userId || '')
      || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || issuedAt > currentTime + 300 || expiresAt <= currentTime
      || expiresAt - issuedAt !== Math.floor(TASK_TOKEN_TTL_MS / 1000)
    ) {
      throw invalidTaskToken();
    }
    return { providerId, jobId };
  } catch (error) {
    if (error && error.code === 'three-d-task-not-found') throw error;
    throw invalidTaskToken();
  }
}

function invalidVideoTaskToken() {
  return toolError('video-tool-task-not-found', 'Video tool task not found.', 404);
}

function createVideoTaskToken(providerJobId, requestId, relayToken, userId, providerCost, credits, key, now = Date.now()) {
  const issuedAt = Math.floor(Number(now) / 1000);
  const payload = Buffer.from(JSON.stringify({
    p: TOPAZ_VIDEO_PROVIDER,
    j: providerJobId,
    q: requestId,
    r: relayToken,
    u: userId,
    c: providerCost,
    a: credits,
    i: issuedAt,
    e: issuedAt + Math.floor(TASK_TOKEN_TTL_MS / 1000)
  }), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(VIDEO_TASK_TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `v1.${base64url(iv)}.${base64url(ciphertext)}.${base64url(cipher.getAuthTag())}`;
}

function readVideoTaskToken(taskToken, userId, key, now = Date.now()) {
  const parts = String(taskToken || '').split('.');
  if (
    parts.length !== 4 || parts[0] !== 'v1'
    || parts.some((part) => !part || part.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw invalidVideoTaskToken();
  }
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 4096) {
      throw invalidVideoTaskToken();
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(VIDEO_TASK_TOKEN_AAD);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    const currentTime = Math.floor(Number(now) / 1000);
    const providerJobId = String(payload && payload.j || '');
    const requestId = String(payload && payload.q || '').toLowerCase();
    const relayToken = String(payload && payload.r || '');
    const ownerId = String(payload && payload.u || '');
    const providerCost = Number(payload && payload.c);
    const credits = Number(payload && payload.a);
    const issuedAt = Number(payload && payload.i);
    const expiresAt = Number(payload && payload.e);
    if (
      payload && payload.p !== TOPAZ_VIDEO_PROVIDER
      || !providerJobId || providerJobId.length > 512 || /[\u0000-\u001f\u007f]/.test(providerJobId)
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(requestId)
      || !/^[A-Za-z0-9_-]{43}$/.test(relayToken)
      || !ownerId || ownerId !== String(userId || '')
      || !Number.isInteger(providerCost) || providerCost < 0 || providerCost > 1_000_000
      || !Number.isInteger(credits) || credits < 0 || credits > 3_000_000
      || credits !== quoteTopazRetailCredits(providerCost)
      || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)
      || issuedAt > currentTime + 300 || expiresAt <= currentTime
      || expiresAt - issuedAt !== Math.floor(TASK_TOKEN_TTL_MS / 1000)
    ) {
      throw invalidVideoTaskToken();
    }
    return { providerJobId, requestId, relayToken, providerCost, credits, issuedAt };
  } catch (error) {
    if (error && error.code === 'video-tool-task-not-found') throw error;
    throw invalidVideoTaskToken();
  }
}

function assertStrictBase64(value) {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw toolError('invalid-image-data', 'The image data is not valid base64.', 400);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(buffer, { requireTransparency = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw toolError('invalid-png-result', 'The image result is not a valid PNG file.', 502);
  }
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let supportsTransparency = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw toolError('invalid-png-result', 'The PNG result is truncated.', 502);
    const length = buffer.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (length > MAX_BACKGROUND_OUTPUT_BYTES || chunkEnd > buffer.length) {
      throw toolError('invalid-png-result', 'The PNG result contains an invalid chunk.', 502);
    }
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) throw toolError('invalid-png-result', 'The PNG result failed integrity validation.', 502);
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw toolError('invalid-png-result', 'The PNG header is invalid.', 502);
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      const colorType = buffer[dataStart + 9];
      if (!width || !height || width > 32768 || height > 32768 || width * height > 100_000_000) {
        throw toolError('invalid-png-result', 'The PNG dimensions are invalid.', 502);
      }
      supportsTransparency = colorType === 4 || colorType === 6;
      sawHeader = true;
    } else if (type === 'IHDR') {
      throw toolError('invalid-png-result', 'The PNG contains duplicate headers.', 502);
    }
    if (type === 'tRNS') supportsTransparency = true;
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) throw toolError('invalid-png-result', 'The PNG ending is invalid.', 502);
      sawEnd = true;
    }
    offset = chunkEnd;
    if (sawEnd) break;
  }
  if (!sawHeader || !sawImageData || !sawEnd || (requireTransparency && !supportsTransparency)) {
    throw toolError(
      'invalid-png-result',
      requireTransparency ? 'The background-removal result is not a transparent PNG.' : 'The PNG image is incomplete.',
      502
    );
  }
  return true;
}

function validateJpeg(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
}

function validateWebp(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 20
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
    && buffer.readUInt32LE(4) + 8 === buffer.length;
}

export function parseImageDataUrl(imageDataUrl, { maxBytes = MAX_BACKGROUND_INPUT_BYTES } = {}) {
  if (typeof imageDataUrl !== 'string' || imageDataUrl.length > Math.ceil(maxBytes * 4 / 3) + 128) {
    throw toolError('image-too-large', 'The image exceeds the supported size.', 413);
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(imageDataUrl);
  if (!match) throw toolError('invalid-image-data', 'A PNG, JPEG, or WebP data URL is required.', 400);
  const mime = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mime)) throw toolError('invalid-image-data', 'The image type is not supported.', 400);
  assertStrictBase64(match[2]);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw toolError('image-too-large', 'The image exceeds the supported size.', 413);
  if (buffer.toString('base64') !== match[2]) throw toolError('invalid-image-data', 'The image data is not canonical base64.', 400);
  if (mime === 'image/png') {
    try {
      validatePng(buffer);
    } catch (error) {
      throw toolError('invalid-image-data', 'The PNG image is invalid.', 400);
    }
  } else if (mime === 'image/jpeg' && !validateJpeg(buffer)) {
    throw toolError('invalid-image-data', 'The JPEG image is invalid.', 400);
  } else if (mime === 'image/webp' && !validateWebp(buffer)) {
    throw toolError('invalid-image-data', 'The WebP image is invalid.', 400);
  }
  return {
    buffer,
    mime,
    extension: mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length)
  };
}

export function validateVideo(buffer, mime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_VIDEO_OUTPUT_BYTES) {
    throw toolError('invalid-video-data', 'The video file is invalid.', 400);
  }
  const isIsoMedia = buffer.toString('ascii', 4, 8) === 'ftyp';
  const isWebm = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (!isIsoMedia && !isWebm) {
    throw toolError('invalid-video-data', 'Only MP4, MOV, WebM, or Matroska video is supported.', 400);
  }
  const normalizedMime = String(mime || '').toLowerCase();
  if (normalizedMime && !ALLOWED_VIDEO_MIME.has(normalizedMime)) {
    throw toolError('invalid-video-data', 'The video MIME type is not supported.', 400);
  }
  if (normalizedMime && isWebm && !['video/webm', 'video/x-matroska'].includes(normalizedMime)) {
    throw toolError('invalid-video-data', 'The video container does not match its MIME type.', 400);
  }
  if (normalizedMime && isIsoMedia && ['video/webm', 'video/x-matroska'].includes(normalizedMime)) {
    throw toolError('invalid-video-data', 'The video container does not match its MIME type.', 400);
  }
  return true;
}

export function parseVideoDataUrl(videoDataUrl, { maxBytes = MAX_VIDEO_INPUT_BYTES } = {}) {
  if (typeof videoDataUrl !== 'string' || videoDataUrl.length > Math.ceil(maxBytes * 4 / 3) + 128) {
    throw toolError('video-too-large', 'The video exceeds the supported upload size.', 413);
  }
  const match = /^data:(video\/(?:mp4|quicktime|webm|x-matroska));base64,([A-Za-z0-9+/=]+)$/i.exec(videoDataUrl);
  if (!match) throw toolError('invalid-video-data', 'A supported base64 video data URL is required.', 400);
  const mime = match[1].toLowerCase();
  assertStrictBase64(match[2]);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    throw toolError('video-too-large', 'The video exceeds the supported upload size.', 413);
  }
  if (buffer.toString('base64') !== match[2]) {
    throw toolError('invalid-video-data', 'The video data is not canonical base64.', 400);
  }
  validateVideo(buffer, mime);
  const extension = mime === 'video/quicktime' ? 'mov'
    : mime === 'video/x-matroska' ? 'mkv'
      : mime.slice('video/'.length);
  return { buffer, mime, extension };
}

function stripPngMetadata(buffer) {
  const removedTypes = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!removedTypes.has(type)) chunks.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }
  return Buffer.concat(chunks);
}

function stripJpegMetadata(buffer) {
  const parts = [buffer.subarray(0, 2)];
  let offset = 2;
  let sawScan = false;
  while (offset < buffer.length) {
    const markerStart = offset;
    if (buffer[offset] !== 0xff) throw toolError('invalid-image-data', 'The JPEG image is invalid.', 400);
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw toolError('invalid-image-data', 'The JPEG image is invalid.', 400);
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) {
      parts.push(buffer.subarray(markerStart, offset));
      break;
    }
    if (marker === 0xda) {
      if (offset + 2 > buffer.length) throw toolError('invalid-image-data', 'The JPEG scan is invalid.', 400);
      const scanHeaderLength = buffer.readUInt16BE(offset);
      if (scanHeaderLength < 2 || offset + scanHeaderLength > buffer.length) {
        throw toolError('invalid-image-data', 'The JPEG scan is invalid.', 400);
      }
      parts.push(buffer.subarray(markerStart));
      sawScan = true;
      offset = buffer.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buffer.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw toolError('invalid-image-data', 'The JPEG segment is invalid.', 400);
    const segmentLength = buffer.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      throw toolError('invalid-image-data', 'The JPEG segment is invalid.', 400);
    }
    if (![0xe1, 0xed, 0xfe].includes(marker)) parts.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }
  if (!sawScan) throw toolError('invalid-image-data', 'The JPEG image has no scan data.', 400);
  return Buffer.concat(parts);
}

function stripWebpMetadata(buffer) {
  const chunks = [];
  let offset = 12;
  let sawImage = false;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw toolError('invalid-image-data', 'The WebP image is invalid.', 400);
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + length + (length % 2);
    if (chunkEnd > buffer.length) throw toolError('invalid-image-data', 'The WebP image is invalid.', 400);
    if (['VP8 ', 'VP8L'].includes(type)) sawImage = true;
    if (!['EXIF', 'XMP '].includes(type)) {
      const chunk = Buffer.from(buffer.subarray(offset, chunkEnd));
      if (type === 'VP8X' && length >= 1) chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    offset = chunkEnd;
  }
  if (offset !== buffer.length || !sawImage) throw toolError('invalid-image-data', 'The WebP image has no image data.', 400);
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, payload]);
}

export function stripImageMetadata(image) {
  if (!image || !Buffer.isBuffer(image.buffer) || !ALLOWED_IMAGE_MIME.has(image.mime)) {
    throw toolError('invalid-image-data', 'The image is invalid.', 400);
  }
  if (image.mime === 'image/png') return { ...image, buffer: stripPngMetadata(image.buffer) };
  if (image.mime === 'image/jpeg') return { ...image, buffer: stripJpegMetadata(image.buffer) };
  return { ...image, buffer: stripWebpMetadata(image.buffer) };
}

function configuredPublicOrigin(explicitValue) {
  const supplied = String(explicitValue ?? process.env.AI_GATEWAY_PUBLIC_URL ?? '').trim();
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  const candidate = supplied || (railwayDomain ? `https://${railwayDomain}` : '');
  if (!candidate) {
    throw toolError('tool-public-url-not-configured', 'The public gateway URL is not configured.', 503);
  }
  let url;
  try { url = new URL(candidate); } catch (error) {
    throw toolError('tool-public-url-not-configured', 'The public gateway URL is invalid.', 503);
  }
  const host = url.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash || !host
    || bareHost.includes(':') || net.isIP(bareHost) !== 0
    || bareHost === 'localhost' || bareHost.endsWith('.local')
  ) {
    throw toolError('tool-public-url-not-configured', 'The public gateway URL must be an HTTPS origin.', 503);
  }
  return url.origin;
}

export function cleanupAi302RelayAssets(now = Date.now()) {
  const currentTime = Number(now);
  for (const [token, asset] of relayAssets) {
    if (asset.expiresAt <= currentTime) {
      relayAssetBytes -= asset.buffer.length;
      relayAssets.delete(token);
    }
  }
}

function deleteRelayAsset(token) {
  const asset = relayAssets.get(token);
  if (!asset) return;
  relayAssetBytes -= asset.buffer.length;
  relayAssets.delete(token);
}

function storeRelayAsset(image, options = {}) {
  const now = Number(options.now ?? Date.now());
  const ttlMs = Math.max(
    RELAY_ASSET_TTL_MS,
    Math.min(VIDEO_RELAY_ASSET_TTL_MS, Number(options.relayTtlMs) || RELAY_ASSET_TTL_MS)
  );
  const publicOrigin = configuredPublicOrigin(options.publicBaseUrl);
  cleanupAi302RelayAssets(now);
  if (relayAssets.size >= MAX_RELAY_ASSET_ENTRIES || relayAssetBytes + image.buffer.length > MAX_RELAY_ASSET_BYTES) {
    throw toolError('tool-asset-capacity-exceeded', 'The temporary image relay is at capacity.', 503);
  }
  let token;
  do { token = crypto.randomBytes(32).toString('base64url'); } while (relayAssets.has(token));
  relayAssets.set(token, {
    buffer: image.buffer,
    mime: image.mime,
    expiresAt: now + ttlMs
  });
  relayAssetBytes += image.buffer.length;
  return {
    token,
    url: `${publicOrigin}/v1/tools/assets/${token}`
  };
}

export function storeAi302RelayAsset(asset, options = {}) {
  const mime = String(asset && asset.mime || '').toLowerCase();
  if (
    !asset || !Buffer.isBuffer(asset.buffer) || !asset.buffer.length
    || (!ALLOWED_IMAGE_MIME.has(mime) && !ALLOWED_VIDEO_MIME.has(mime))
  ) {
    throw toolError('invalid-relay-asset', 'The temporary relay asset is invalid.', 400);
  }
  return storeRelayAsset({ ...asset, mime }, options);
}

export function deleteAi302RelayAsset(token) {
  deleteRelayAsset(String(token || ''));
}

export function getAi302RelayAsset(token, { now = Date.now() } = {}) {
  const normalized = String(token || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw toolError('tool-asset-not-found', 'Temporary image not found.', 404);
  }
  const asset = relayAssets.get(normalized);
  if (!asset || asset.expiresAt <= Number(now)) {
    if (asset) deleteRelayAsset(normalized);
    throw toolError('tool-asset-not-found', 'Temporary image not found.', 404);
  }
  return { buffer: asset.buffer, mime: asset.mime };
}

const relayCleanupTimer = setInterval(() => cleanupAi302RelayAssets(), 60_000);
relayCleanupTimer.unref();

function safeAssetHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'file.302.ai'
    || host.endsWith('.file.302.ai')
    || host === 'fal.media'
    || host.endsWith('.fal.media')
    || host === 'topazlabs.com'
    || host.endsWith('.topazlabs.com')
    || host.endsWith('.cos.myqcloud.com')
    || /\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(host)
    || host.endsWith('.tencentcos.cn')
    || /\.cos\.[a-z0-9-]+\.tencentcos\.cn$/.test(host);
}

export function validateAssetUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (error) {
    throw toolError('unsafe-tool-result-url', 'The tool provider returned an invalid download address.', 502);
  }
  const hostname = url.hostname.toLowerCase();
  const bareHostname = hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || url.hash
    || bareHostname.includes(':') || net.isIP(bareHostname) !== 0 || !safeAssetHost(bareHostname)
  ) {
    throw toolError('unsafe-tool-result-url', 'The tool provider returned an unsafe download address.', 502);
  }
  return url;
}

function composedSignal(timeoutMs, signal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function limitedBuffer(response, maximum) {
  const contentLength = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw toolError('tool-result-too-large', 'The tool result exceeds the supported size.', 502);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (total > maximum) {
      await response.body.cancel().catch(() => {});
      throw toolError('tool-result-too-large', 'The tool result exceeds the supported size.', 502);
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
}

function upstreamFailure(response) {
  const error = response.status === 402
    ? toolError('ai302-balance-exhausted', 'The 302 tool balance is insufficient.', 402)
    : response.status === 429
      ? toolError('ai302-rate-limited', 'The 302 tool service is busy. Try again shortly.', 429)
      : toolError('ai302-upstream-error', 'The 302 tool service rejected the request.', 502);
  error.upstreamStatus = response.status;
  return error;
}

async function fetch302Json(path, init, { apiKey, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  let response;
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init.headers || {})
      },
      redirect: 'error',
      signal: composedSignal(timeoutMs, signal)
    });
  } catch (error) {
    throw toolError('ai302-unavailable', 'The 302 tool service is temporarily unavailable.', 503);
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
    throw toolError('ai302-invalid-response', 'The 302 tool service returned an invalid response.', 502);
  }
}

async function fetchAsset(urlValue, maximum, { fetchImpl, signal } = {}) {
  let url = validateAssetUrl(urlValue);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/octet-stream,image/png,video/*' },
        redirect: 'manual',
        signal: composedSignal(ASSET_TIMEOUT_MS, signal)
      });
    } catch (error) {
      throw toolError('tool-download-failed', 'The tool result could not be downloaded.', 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (response.body) await response.body.cancel().catch(() => {});
      if (!location || redirectCount === 3) {
        throw toolError('unsafe-tool-result-url', 'The tool result contains an invalid redirect.', 502);
      }
      url = validateAssetUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw toolError('tool-download-failed', 'The tool result could not be downloaded.', 502);
    }
    return limitedBuffer(response, maximum);
  }
  throw toolError('unsafe-tool-result-url', 'The tool result contains too many redirects.', 502);
}

function nestedResponseObject(payload, predicate, message = 'The 302 tool service returned an invalid response.') {
  let value = payload;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    if (predicate(value)) return value;
    const nested = ['data', 'result', 'response', 'Response']
      .map((key) => value[key])
      .find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    if (!nested) break;
    value = nested;
  }
  throw toolError('ai302-invalid-response', message, 502);
}

function responseObject(payload) {
  return nestedResponseObject(
    payload,
    (value) => ['JobId', 'Status', 'ResultFile3Ds', 'ErrorCode'].some((key) => Object.hasOwn(value, key))
  );
}

function hyper3dResponseObject(payload) {
  return nestedResponseObject(
    payload,
    (value) => ['request_id', 'requestId', 'task_id', 'taskId', 'status', 'model_mesh'].some((key) => Object.hasOwn(value, key)),
    'The Hyper3D service returned an invalid response.'
  );
}

function backgroundResultUrl(payload) {
  const value = nestedResponseObject(
    payload,
    (entry) => (typeof entry.url === 'string' && entry.url.trim())
      || (entry.image && typeof entry.image.url === 'string' && entry.image.url.trim()),
    'The background-removal service returned an invalid response.'
  );
  return String(value.url || (value.image && value.image.url) || '').trim();
}

function normalizeThreeDStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (QUEUED_STATES.has(raw)) return 'queued';
  if (PROCESSING_STATES.has(raw)) return 'processing';
  if (SUCCESS_STATES.has(raw)) return 'succeeded';
  if (FAILURE_STATES.has(raw)) return 'failed';
  throw toolError('ai302-invalid-response', 'The 3D service returned an unsupported task status.', 502);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function optionalBoundedNumber(source, key, minimum, maximum) {
  if (!source || source[key] === undefined || source[key] === null || source[key] === '') return {};
  const parsed = Number(source[key]);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw toolError('invalid-video-upscale-options', `The ${key} video filter option is invalid.`, 400);
  }
  return { [key]: parsed };
}

function normalizeTopazFilter(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const model = String(source.model || 'prob-4').trim().toLowerCase();
  if (!TOPAZ_VIDEO_FILTER_MODELS.has(model)) {
    throw toolError('invalid-video-upscale-options', 'The selected Topaz video filter is not supported.', 400);
  }
  const filter = { model };
  const videoType = String(source.videoType || '').trim();
  if (videoType) {
    if (!['Progressive', 'Interlaced', 'ProgressiveInterlaced'].includes(videoType)) {
      throw toolError('invalid-video-upscale-options', 'The video scan type is invalid.', 400);
    }
    filter.videoType = videoType;
  }
  const auto = String(source.auto || '').trim();
  if (auto) {
    if (!['Auto', 'Manual', 'Relative'].includes(auto)) {
      throw toolError('invalid-video-upscale-options', 'The video filter mode is invalid.', 400);
    }
    filter.auto = auto;
  }
  const fieldOrder = String(source.fieldOrder || '').trim();
  if (fieldOrder) {
    if (!['TopFirst', 'BottomFirst', 'Auto'].includes(fieldOrder)) {
      throw toolError('invalid-video-upscale-options', 'The video field order is invalid.', 400);
    }
    filter.fieldOrder = fieldOrder;
  }
  const focusFixLevel = String(source.focusFixLevel || '').trim();
  if (focusFixLevel) {
    if (!['None', 'Normal', 'Strong'].includes(focusFixLevel)) {
      throw toolError('invalid-video-upscale-options', 'The focus correction level is invalid.', 400);
    }
    filter.focusFixLevel = focusFixLevel;
  }
  Object.assign(
    filter,
    optionalBoundedNumber(source, 'compression', -1, 1),
    optionalBoundedNumber(source, 'details', -1, 1),
    optionalBoundedNumber(source, 'prenoise', 0, 0.1),
    optionalBoundedNumber(source, 'noise', -1, 1),
    optionalBoundedNumber(source, 'halo', -1, 1),
    optionalBoundedNumber(source, 'preblur', -1, 1),
    optionalBoundedNumber(source, 'blur', -1, 1),
    optionalBoundedNumber(source, 'grain', 0, 0.1),
    optionalBoundedNumber(source, 'grainSize', 0, 5),
    optionalBoundedNumber(source, 'recoverOriginalDetailValue', 0, 1),
    optionalBoundedNumber(source, 'slowmo', 1, 16),
    optionalBoundedNumber(source, 'fps', 15, 240),
    optionalBoundedNumber(source, 'duplicateThreshold', 0.001, 0.1)
  );
  if (source.duplicate !== undefined) filter.duplicate = source.duplicate === true;
  return filter;
}

export function normalizeVideoUpscaleOptions(value = {}) {
  const options = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const requestedFilters = Array.isArray(options.filters) ? options.filters.slice(0, 2) : [];
  const filters = (requestedFilters.length ? requestedFilters : [{ model: 'prob-4' }]).map(normalizeTopazFilter);
  const outputSource = options.output && typeof options.output === 'object' && !Array.isArray(options.output)
    ? options.output
    : {};
  const resolutionSource = outputSource.resolution && typeof outputSource.resolution === 'object'
    ? outputSource.resolution
    : {};
  const width = Math.round(boundedNumber(resolutionSource.width, 1920, 128, 7680));
  const height = Math.round(boundedNumber(resolutionSource.height, 1080, 128, 7680));
  if (width * height > 33_177_600) {
    throw toolError('invalid-video-upscale-options', 'The requested output resolution exceeds the 8K safety limit.', 400);
  }
  const frameRate = boundedNumber(outputSource.frameRate, 30, 1, 240);
  const audioCodec = String(outputSource.audioCodec || 'AAC').trim().toUpperCase();
  const audioTransfer = String(outputSource.audioTransfer || 'Copy').trim();
  const videoEncoder = String(outputSource.videoEncoder || 'H264').trim();
  const dynamicCompressionLevel = String(outputSource.dynamicCompressionLevel || 'High').trim();
  const container = String(outputSource.container || 'mp4').trim().toLowerCase();
  if (!['AAC', 'AC3', 'PCM'].includes(audioCodec)
      || !['Copy', 'Convert', 'None'].includes(audioTransfer)
      || !['AV1', 'FFV1', 'H264', 'H265', 'ProRes', 'QuickTime Animation', 'QuickTime R210', 'QuickTime V210', 'VP9'].includes(videoEncoder)
      || !['Low', 'Mid', 'High'].includes(dynamicCompressionLevel)
      || !['mp4', 'mov', 'mkv'].includes(container)) {
    throw toolError('invalid-video-upscale-options', 'The requested video output format is invalid.', 400);
  }
  const videoProfile = String(outputSource.videoProfile || (videoEncoder === 'H264' ? 'High' : 'Main')).trim();
  if (!videoProfile || videoProfile.length > 64 || /[\u0000-\u001f\u007f]/.test(videoProfile)) {
    throw toolError('invalid-video-upscale-options', 'The video output profile is invalid.', 400);
  }
  return {
    filters,
    output: {
      resolution: { width, height },
      frameRate,
      audioCodec,
      audioTransfer,
      videoEncoder,
      videoProfile,
      dynamicCompressionLevel,
      cropToFit: outputSource.cropToFit === true,
      container
    },
    sourceDuration: boundedNumber(options.sourceDuration, 0, 0, 21_600)
  };
}

function normalizeTopazVideoStatus(job) {
  const resultUrl = topazDownloadUrl(job);
  if (resultUrl) return 'succeeded';
  const raw = String(job && job.status || '').trim().toUpperCase().replace(/[ -]+/g, '_');
  if (QUEUED_STATES.has(raw) || ['UPLOADING', 'ACCEPTED', 'SUBMITTED'].includes(raw)) return 'queued';
  if (PROCESSING_STATES.has(raw) || ['ENCODING', 'ENHANCING'].includes(raw)) return 'processing';
  if (SUCCESS_STATES.has(raw) || ['COMPLETE', 'FINISHED', 'READY'].includes(raw)) return 'succeeded';
  if (FAILURE_STATES.has(raw) || ['ABORTED', 'REJECTED'].includes(raw)) return 'failed';
  const childStatuses = Array.isArray(job && job.processingJobs)
    ? job.processingJobs.map((entry) => String(entry && entry.status || '').trim().toUpperCase().replace(/[ -]+/g, '_')).filter(Boolean)
    : [];
  if (childStatuses.length) {
    if (childStatuses.some((status) => FAILURE_STATES.has(status) || ['ABORTED', 'REJECTED'].includes(status))) return 'failed';
    if (childStatuses.every((status) => SUCCESS_STATES.has(status) || ['COMPLETE', 'FINISHED', 'READY'].includes(status))) return 'succeeded';
    if (childStatuses.some((status) => PROCESSING_STATES.has(status) || ['ENCODING', 'ENHANCING'].includes(status))) return 'processing';
    if (childStatuses.every((status) => QUEUED_STATES.has(status) || ['UPLOADING', 'ACCEPTED', 'SUBMITTED'].includes(status))) return 'queued';
  }
  throw toolError('ai302-invalid-response', 'The video enhancement service returned an unsupported task status.', 502);
}

function hasTopazPayloadFields(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && [
    'requestId', 'request_id', 'cost', 'status', 'progress', 'download', 'processingJobs'
  ].some((key) => Object.hasOwn(value, key));
}

function topazResponseObject(payload) {
  let value = payload;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) break;
    if (hasTopazPayloadFields(value)) break;
    const nested = ['data', 'result', 'response']
      .map((key) => value[key])
      .find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    if (!nested) break;
    value = nested;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw toolError('ai302-invalid-response', 'The video enhancement service returned an invalid response.', 502);
  }
  return value;
}

function topazDownloadUrl(payload) {
  const job = topazResponseObject(payload);
  const candidates = [
    job.download && job.download.url,
    typeof job.download === 'string' ? job.download : '',
    job.output && job.output.url,
    job.result && job.result.url,
    job.url
  ];
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim();
}

function topazProgress(job, status) {
  const direct = Number(job && job.progress);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, Math.round(direct)));
  const childProgress = Array.isArray(job && job.processingJobs)
    ? job.processingJobs.map((entry) => Number(entry && entry.progress)).filter(Number.isFinite)
    : [];
  if (childProgress.length) {
    return Math.max(0, Math.min(100, Math.round(childProgress.reduce((total, value) => total + value, 0) / childProgress.length)));
  }
  return status === 'succeeded' ? 100 : 0;
}

async function queryTopazVideoJob(providerJobId, dependencies) {
  const payload = await fetch302Json(`${TOPAZ_VIDEO_STATUS_PATH}/${encodeURIComponent(providerJobId)}/status`, {
    method: 'GET'
  }, {
    ...dependencies,
    timeoutMs: STATUS_TIMEOUT_MS
  });
  return topazResponseObject(payload);
}

async function settleVideoUpscaleCredits(task, status, options) {
  if (!['succeeded', 'failed'].includes(status) || typeof options.settleCredits !== 'function') return null;
  const settled = await options.settleCredits({
    requestId: task.requestId,
    status,
    durationMs: Math.max(0, (Math.floor(Number(options.now ?? Date.now()) / 1000) - task.issuedAt) * 1000)
  });
  if (!settled || settled.ok !== true) {
    throw toolError('credit-settlement-failed', 'The video enhancement credits could not be settled.', 503);
  }
  return settled;
}

async function queryHunyuanJob(jobId, dependencies) {
  return responseObject(await fetch302Json(`${HUNYUAN_PATH}/${encodeURIComponent(jobId)}`, {
    method: 'GET'
  }, {
    ...dependencies,
    timeoutMs: STATUS_TIMEOUT_MS
  }));
}

function findHunyuanGlb(job) {
  const files = Array.isArray(job.ResultFile3Ds) ? job.ResultFile3Ds : [];
  const result = files.find((file) => String(file && file.Type || '').trim().toUpperCase() === 'GLB');
  if (!result || typeof result.Url !== 'string') {
    throw toolError('three-d-result-invalid', 'The completed 3D task did not contain a GLB model.', 502);
  }
  return result;
}

async function createHunyuanJob(image, dependencies) {
  const payload = await fetch302Json(HUNYUAN_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Model: '3.0',
      ImageBase64: image.buffer.toString('base64'),
      GenerateType: 'Normal'
    })
  }, dependencies);
  const jobId = String(responseObject(payload).JobId || '').trim();
  if (!jobId || jobId.length > 512 || /[\u0000-\u001f\u007f]/.test(jobId)) {
    throw toolError('ai302-invalid-response', 'The 3D service did not return a valid task.', 502);
  }
  return { jobId, status: 'queued' };
}

async function queryHyper3dJob(jobId, dependencies) {
  return hyper3dResponseObject(await fetch302Json(`${HYPER3D_PATH}?request_id=${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ...dependencies,
    timeoutMs: STATUS_TIMEOUT_MS
  }));
}

function hyper3dStatus(job) {
  if (job && job.model_mesh && typeof job.model_mesh.url === 'string') return 'succeeded';
  return normalizeThreeDStatus(job && job.status);
}

function findHyper3dGlb(job) {
  const result = job && job.model_mesh;
  if (!result || typeof result.url !== 'string') {
    throw toolError('three-d-result-invalid', 'The completed 3D task did not contain a GLB model.', 502);
  }
  return { url: result.url };
}

async function createHyper3dJob(image, prompt, dependencies) {
  if (!prompt) throw toolError('invalid-prompt', 'Hyper3D requires a prompt.', 400);
  const relay = storeRelayAsset(image, dependencies);
  try {
    const payload = await fetch302Json(HYPER3D_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        input_image_urls: [relay.url],
        condition_mode: 'concat',
        geometry_file_format: 'glb',
        material: 'PBR',
        quality: 'medium',
        tier: 'Regular',
        use_hyper: false,
        TAPose: false
      })
    }, dependencies);
    const response = hyper3dResponseObject(payload);
    const jobId = String(response.request_id || response.requestId || response.task_id || response.taskId || '').trim();
    if (!jobId || jobId.length > 512 || /[\u0000-\u001f\u007f]/.test(jobId)) {
      throw toolError('ai302-invalid-response', 'The 3D service did not return a valid task.', 502);
    }
    const status = response.status ? normalizeThreeDStatus(response.status) : 'queued';
    return { jobId, status };
  } catch (error) {
    deleteRelayAsset(relay.token);
    throw error;
  }
}

const threeDProviderHandlers = Object.freeze({
  hunyuan3d: {
    create: (image, prompt, dependencies) => createHunyuanJob(image, dependencies),
    query: queryHunyuanJob,
    status: (job) => normalizeThreeDStatus(job.Status),
    result: (job) => {
      const result = findHunyuanGlb(job);
      return { url: result.Url, previewImageUrl: result.PreviewImageUrl };
    }
  },
  hyper3d: {
    create: createHyper3dJob,
    query: queryHyper3dJob,
    status: hyper3dStatus,
    result: findHyper3dGlb
  }
});

export function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw toolError('invalid-glb-result', 'The 3D result is not a valid GLB file.', 502);
  }
  if (buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length || buffer.length > MAX_GLB_BYTES) {
    throw toolError('invalid-glb-result', 'The GLB header is invalid.', 502);
  }
  let offset = 12;
  let chunkIndex = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw toolError('invalid-glb-result', 'The GLB file is truncated.', 502);
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + chunkLength;
    if (chunkLength % 4 !== 0 || chunkEnd > buffer.length) {
      throw toolError('invalid-glb-result', 'The GLB file contains an invalid chunk.', 502);
    }
    if (chunkIndex === 0 && chunkType !== 0x4e4f534a) {
      throw toolError('invalid-glb-result', 'The GLB JSON chunk is missing.', 502);
    }
    if (chunkIndex === 0) {
      try {
        const json = JSON.parse(buffer.subarray(offset + 8, chunkEnd).toString('utf8').replace(/[\u0000\u0020]+$/g, ''));
        if (!json || typeof json !== 'object' || String(json.asset && json.asset.version || '') !== '2.0') {
          throw new Error('invalid asset');
        }
      } catch (error) {
        throw toolError('invalid-glb-result', 'The GLB metadata is invalid.', 502);
      }
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (offset !== buffer.length || chunkIndex < 1) throw toolError('invalid-glb-result', 'The GLB file is incomplete.', 502);
  return true;
}

export async function removeBackground({ imageDataUrl } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const image = stripImageMetadata(parseImageDataUrl(imageDataUrl, { maxBytes: MAX_BACKGROUND_INPUT_BYTES }));
  const form = new FormData();
  form.append('image_file', new Blob([image.buffer], { type: image.mime }), `input.${image.extension}`);
  form.append('format', 'png');
  form.append('channels', 'rgba');
  form.append('size', 'full');
  const payload = await fetch302Json(BACKGROUND_PATH, {
    method: 'POST',
    body: form
  }, {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  const resultUrl = validateAssetUrl(backgroundResultUrl(payload)).toString();
  const png = await fetchAsset(resultUrl, MAX_BACKGROUND_OUTPUT_BYTES, {
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  validatePng(png, { requireTransparency: true });
  return png;
}

export async function createThreeDTask({ providerId, imageDataUrl, prompt, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const normalizedProviderId = String(providerId || '').trim().toLowerCase();
  const handler = threeDProviderHandlers[normalizedProviderId];
  if (!handler) throw toolError('invalid-three-d-provider', 'The selected 3D provider is not supported.', 400);
  const ownerId = String(userId || '').trim();
  if (!ownerId || ownerId.length > 256 || /[\u0000-\u001f\u007f]/.test(ownerId)) {
    throw toolError('invalid-tool-user', 'The authenticated user is invalid.', 400);
  }
  const normalizedPrompt = String(prompt || '').trim();
  if (Array.from(normalizedPrompt).length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalizedPrompt)) {
    throw toolError('invalid-prompt', 'The 3D prompt is invalid.', 400);
  }
  if (PRIVATE_INPUT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    throw toolError('privacy-blocked', 'The 3D prompt appears to contain a private credential.', 400);
  }
  const image = stripImageMetadata(parseImageDataUrl(imageDataUrl, { maxBytes: MAX_3D_INPUT_BYTES }));
  // Hunyuan image-to-3D forbids Prompt and ImageBase64 in the same request, so
  // its handler intentionally ignores the optional local prompt.
  const dependencies = {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal,
    publicBaseUrl: options.publicBaseUrl,
    now: options.now
  };
  const job = await handler.create(image, normalizedPrompt, dependencies);
  return {
    taskToken: createTaskToken(normalizedProviderId, job.jobId, ownerId, taskKey, options.now ?? Date.now()),
    status: job.status,
    retryAfterMs: ['queued', 'processing'].includes(job.status) ? 5_000 : 0
  };
}

export async function getThreeDStatus({ taskToken, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const { providerId, jobId } = readTaskToken(taskToken, userId, taskKey, options.now ?? Date.now());
  const handler = threeDProviderHandlers[providerId];
  const job = await handler.query(jobId, {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  const status = handler.status(job);
  const result = {
    status,
    retryAfterMs: ['queued', 'processing'].includes(status) ? 5_000 : 0
  };
  if (status === 'succeeded') {
    const model = handler.result(job);
    validateAssetUrl(model.url);
    if (model.previewImageUrl) result.previewImageUrl = validateAssetUrl(model.previewImageUrl).toString();
  }
  if (status === 'failed') {
    result.errorCode = 'three-d-generation-failed';
    result.errorMessage = '3D generation failed.';
  }
  return result;
}

export async function downloadThreeDModel({ taskToken, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const { providerId, jobId } = readTaskToken(taskToken, userId, taskKey, options.now ?? Date.now());
  const handler = threeDProviderHandlers[providerId];
  const job = await handler.query(jobId, {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  const status = handler.status(job);
  if (status !== 'succeeded') {
    throw toolError(
      status === 'failed' ? 'three-d-generation-failed' : 'three-d-task-not-ready',
      status === 'failed' ? '3D generation failed.' : 'The 3D model is not ready to download.',
      409
    );
  }
  const result = handler.result(job);
  const url = validateAssetUrl(result.url).toString();
  const glb = await fetchAsset(url, MAX_GLB_BYTES, {
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  validateGlb(glb);
  return glb;
}

export async function createVideoUpscaleTask({ videoDataUrl, toolOptions, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const ownerId = String(userId || '').trim();
  if (!ownerId || ownerId.length > 256 || /[\u0000-\u001f\u007f]/.test(ownerId)) {
    throw toolError('invalid-tool-user', 'The authenticated user is invalid.', 400);
  }
  const video = parseVideoDataUrl(videoDataUrl, { maxBytes: MAX_VIDEO_INPUT_BYTES });
  const normalized = normalizeVideoUpscaleOptions(toolOptions);
  const relay = storeRelayAsset(video, {
    ...options,
    relayTtlMs: VIDEO_RELAY_ASSET_TTL_MS
  });
  const localRequestId = crypto.randomUUID();
  try {
    const payload = await fetch302Json(TOPAZ_VIDEO_UPLOAD_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: relay.url,
        filters: normalized.filters,
        output: normalized.output
      })
    }, {
      apiKey,
      fetchImpl: options.fetchImpl || fetch,
      signal: options.signal
    });
    const result = topazResponseObject(payload);
    const providerJobId = String(result.requestId || result.request_id || '').trim();
    const providerCost = Number(result.cost);
    if (!providerJobId || providerJobId.length > 512 || /[\u0000-\u001f\u007f]/.test(providerJobId)
        || !Number.isInteger(providerCost) || providerCost < 0 || providerCost > 1_000_000) {
      throw toolError('ai302-invalid-response', 'The video enhancement service did not return a valid task.', 502);
    }
    const credits = quoteTopazRetailCredits(providerCost);
    let reservation = null;
    if (typeof options.reserveCredits === 'function') {
      reservation = await options.reserveCredits({
        userId: ownerId,
        requestId: localRequestId,
        providerId: TOPAZ_VIDEO_PROVIDER,
        credits,
        providerCost,
        resolution: `${normalized.output.resolution.width}x${normalized.output.resolution.height}`,
        duration: normalized.sourceDuration > 0 ? Math.ceil(normalized.sourceDuration) : null
      });
      if (!reservation || reservation.ok !== true) {
        const reason = String(reservation && reservation.reason || 'credit-service-failed');
        const status = reason === 'insufficient-credits' ? 402 : reason === 'account-suspended' ? 403 : 503;
        throw toolError(reason, 'The video enhancement credits could not be reserved.', status);
      }
    }
    return {
      taskToken: createVideoTaskToken(
        providerJobId,
        localRequestId,
        relay.token,
        ownerId,
        providerCost,
        credits,
        taskKey,
        options.now ?? Date.now()
      ),
      status: 'queued',
      retryAfterMs: 5_000,
      credits,
      providerCost,
      ...(reservation && Number.isFinite(Number(reservation.availableCredits))
        ? { availableCredits: Number(reservation.availableCredits) }
        : {})
    };
  } catch (error) {
    deleteRelayAsset(relay.token);
    throw error;
  }
}

export async function getVideoUpscaleStatus({ taskToken, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const task = readVideoTaskToken(taskToken, userId, taskKey, options.now ?? Date.now());
  if (typeof options.touchCredits === 'function') {
    const touched = await options.touchCredits({ requestId: task.requestId, userId: String(userId || '') });
    if (!touched || touched.ok !== true) {
      throw toolError('credit-service-failed', 'The video enhancement accounting could not be refreshed.', 503);
    }
  }
  const job = await queryTopazVideoJob(task.providerJobId, {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  const status = normalizeTopazVideoStatus(job);
  if (status === 'succeeded') validateAssetUrl(topazDownloadUrl(job));
  const settlement = await settleVideoUpscaleCredits(task, status, options);
  if (['succeeded', 'failed'].includes(status)) deleteRelayAsset(task.relayToken);
  const progress = topazProgress(job, status);
  return {
    status,
    progress,
    retryAfterMs: ['queued', 'processing'].includes(status) ? 5_000 : 0,
    credits: task.credits,
    providerCost: task.providerCost,
    ...(settlement && Number.isFinite(Number(settlement.creditsCharged))
      ? { creditsCharged: Number(settlement.creditsCharged) }
      : {}),
    ...(settlement && Number.isFinite(Number(settlement.creditsReleased))
      ? { creditsReleased: Number(settlement.creditsReleased) }
      : {}),
    ...(status === 'failed'
      ? { errorCode: 'video-upscale-failed', errorMessage: 'Video enhancement failed.' }
      : {})
  };
}

export async function downloadVideoUpscaleResult({ taskToken, userId } = {}, options = {}) {
  const apiKey = configuredApiKey(options.apiKey);
  const taskKey = configuredTaskSecret(apiKey, options.taskSecret);
  const task = readVideoTaskToken(taskToken, userId, taskKey, options.now ?? Date.now());
  if (typeof options.touchCredits === 'function') {
    const touched = await options.touchCredits({ requestId: task.requestId, userId: String(userId || '') });
    if (!touched || touched.ok !== true) {
      throw toolError('credit-service-failed', 'The video enhancement accounting could not be refreshed.', 503);
    }
  }
  const job = await queryTopazVideoJob(task.providerJobId, {
    apiKey,
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  const status = normalizeTopazVideoStatus(job);
  await settleVideoUpscaleCredits(task, status, options);
  if (status !== 'succeeded') {
    if (status === 'failed') deleteRelayAsset(task.relayToken);
    throw toolError(
      status === 'failed' ? 'video-upscale-failed' : 'video-tool-task-not-ready',
      status === 'failed' ? 'Video enhancement failed.' : 'The enhanced video is not ready to download.',
      409
    );
  }
  const resultUrl = validateAssetUrl(topazDownloadUrl(job)).toString();
  const video = await fetchAsset(resultUrl, MAX_VIDEO_OUTPUT_BYTES, {
    fetchImpl: options.fetchImpl || fetch,
    signal: options.signal
  });
  try {
    validateVideo(video);
  } catch (error) {
    throw toolError('invalid-video-result', 'The enhanced video result is invalid.', 502);
  }
  deleteRelayAsset(task.relayToken);
  return video;
}
