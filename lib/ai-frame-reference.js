'use strict';

let defaultSharp = null;
try {
  defaultSharp = require('sharp');
} catch (error) {}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i;
const DEFAULT_BACKGROUND = Object.freeze({ r: 16, g: 18, b: 20, alpha: 1 });
const WEBP_QUALITIES = Object.freeze([84, 72, 62, 54, 48, 42, 34, 28]);

function frameReferenceError(message, cause) {
  return Object.assign(new Error(message), {
    code: 'invalid-frame-reference',
    ...(cause ? { cause } : {})
  });
}

function decodeImageDataUrl(value) {
  const match = IMAGE_DATA_URL.exec(String(value || ''));
  if (!match) throw frameReferenceError('The first or last frame image is invalid.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.toString('base64') !== match[2]) {
    throw frameReferenceError('The first or last frame image is invalid.');
  }
  return { buffer, mimeType: match[1].toLowerCase() };
}

function imageEngine(sharpImpl) {
  const engine = sharpImpl || defaultSharp;
  if (!engine) throw frameReferenceError('Image preparation is unavailable in this build.');
  return engine;
}

async function imageDataUrlDimensions(value, options = {}) {
  const sharpImpl = imageEngine(options.sharpImpl);
  const image = decodeImageDataUrl(value);
  try {
    const metadata = await sharpImpl(image.buffer, {
      failOn: 'error',
      limitInputPixels: 512 * 1024 * 1024,
      sequentialRead: true
    }).metadata();
    let width = Math.round(Number(metadata.width) || 0);
    let height = Math.round(Number(metadata.height) || 0);
    if ([5, 6, 7, 8].includes(Number(metadata.orientation))) [width, height] = [height, width];
    if (!(width > 0 && height > 0)) throw new Error('missing dimensions');
    return { width, height };
  } catch (cause) {
    throw frameReferenceError('The first or last frame dimensions could not be read.', cause);
  }
}

async function fitImageDataUrlToCanvas(value, target, options = {}) {
  const sharpImpl = imageEngine(options.sharpImpl);
  const image = decodeImageDataUrl(value);
  const requestedWidth = Math.round(Number(target && target.width) || 0);
  const requestedHeight = Math.round(Number(target && target.height) || 0);
  if (!(requestedWidth > 0 && requestedHeight > 0) || requestedWidth > 8192 || requestedHeight > 8192) {
    throw frameReferenceError('The first-frame dimensions are invalid.');
  }
  const width = requestedWidth;
  const height = requestedHeight;
  const maximumBytes = Math.max(128 * 1024, Number(options.maximumBytes) || 1_250_000);
  const background = options.background || DEFAULT_BACKGROUND;
  let output = null;
  try {
    const pipeline = sharpImpl(image.buffer, {
      failOn: 'error',
      limitInputPixels: 512 * 1024 * 1024,
      sequentialRead: true
    })
      .rotate()
      .resize({ width, height, fit: 'contain', position: 'centre', background });
    for (const quality of WEBP_QUALITIES) {
      output = await pipeline.clone().webp({ quality, effort: 3 }).toBuffer();
      if (output.length <= maximumBytes) break;
    }
  } catch (cause) {
    throw frameReferenceError('The last frame could not be matched to the first-frame canvas.', cause);
  }
  if (!output || !output.length) throw frameReferenceError('The last frame could not be prepared.');
  return `data:image/webp;base64,${output.toString('base64')}`;
}

function parseAspectRatio(value) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(value || '').trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return width / height;
}

function aspectRatioCanvas(source, aspectRatio) {
  const sourceWidth = Math.max(1, Math.round(Number(source && source.width) || 0));
  const sourceHeight = Math.max(1, Math.round(Number(source && source.height) || 0));
  const targetRatio = parseAspectRatio(aspectRatio);
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(targetRatio > 0)) {
    throw frameReferenceError('The selected frame aspect ratio is invalid.');
  }
  const sourceRatio = sourceWidth / sourceHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceRatio > targetRatio) {
    height = Math.max(2, Math.round(width / targetRatio));
  } else if (sourceRatio < targetRatio) {
    width = Math.max(2, Math.round(height * targetRatio));
  }
  const scale = Math.min(1, 8192 / width, 8192 / height);
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale))
  };
}

async function fitImageDataUrlToAspectRatio(value, aspectRatio, options = {}) {
  const source = await imageDataUrlDimensions(value, options);
  const target = aspectRatioCanvas(source, aspectRatio);
  const sameSize = source.width === target.width && source.height === target.height;
  return {
    dataUrl: sameSize ? value : await fitImageDataUrlToCanvas(value, target, options),
    width: target.width,
    height: target.height,
    adjusted: !sameSize
  };
}

async function normalizeFirstLastFrameDataUrls(values, options = {}) {
  if (!Array.isArray(values) || values.length !== 2) {
    throw frameReferenceError('First and last frame generation requires exactly two images.');
  }
  const firstDimensions = await imageDataUrlDimensions(values[0], options);
  const lastDimensions = await imageDataUrlDimensions(values[1], options);
  const target = parseAspectRatio(options.aspectRatio) > 0
    ? aspectRatioCanvas(firstDimensions, options.aspectRatio)
    : firstDimensions;
  const firstFrame = firstDimensions.width === target.width && firstDimensions.height === target.height
    ? values[0]
    : await fitImageDataUrlToCanvas(values[0], target, options);
  const sameCanvas = lastDimensions.width === target.width && lastDimensions.height === target.height;
  if (firstFrame === values[0] && sameCanvas) {
    return {
      dataUrls: [...values],
      width: target.width,
      height: target.height,
      adjusted: false
    };
  }
  const lastFrame = sameCanvas
    ? values[1]
    : await fitImageDataUrlToCanvas(values[1], target, options);
  return {
    dataUrls: [firstFrame, lastFrame],
    width: target.width,
    height: target.height,
    adjusted: true
  };
}

module.exports = {
  DEFAULT_BACKGROUND,
  fitImageDataUrlToCanvas,
  fitImageDataUrlToAspectRatio,
  imageDataUrlDimensions,
  normalizeFirstLastFrameDataUrls
};
