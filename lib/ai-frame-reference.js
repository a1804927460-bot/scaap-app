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

async function normalizeFirstLastFrameDataUrls(values, options = {}) {
  if (!Array.isArray(values) || values.length !== 2) {
    throw frameReferenceError('First and last frame generation requires exactly two images.');
  }
  const firstDimensions = await imageDataUrlDimensions(values[0], options);
  const lastDimensions = await imageDataUrlDimensions(values[1], options);
  if (firstDimensions.width === lastDimensions.width && firstDimensions.height === lastDimensions.height) {
    return {
      dataUrls: [...values],
      width: firstDimensions.width,
      height: firstDimensions.height,
      adjusted: false
    };
  }
  const lastFrame = await fitImageDataUrlToCanvas(values[1], firstDimensions, options);
  return {
    dataUrls: [values[0], lastFrame],
    width: firstDimensions.width,
    height: firstDimensions.height,
    adjusted: true
  };
}

module.exports = {
  DEFAULT_BACKGROUND,
  fitImageDataUrlToCanvas,
  imageDataUrlDimensions,
  normalizeFirstLastFrameDataUrls
};
