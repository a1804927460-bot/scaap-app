import { setTimeout as delay } from 'node:timers/promises';
import { parseImageDataUrl } from './ai302-tools.js';
import { downloadAi302ImageResult } from './ai302-image-tools.js';
import falPricing from '../../lib/fal-pricing.js';
import sharp from 'sharp';

const origin = 'https://queue.fal.run';
function failure(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}
export function assertFalConfigured(env = process.env) {
  const key = String(env.FAL_API_KEY || env.FAL_KEY || '').trim();
  if (!key) throw failure('provider-not-configured', '图片工具尚未配置，请联系管理员。');
  return key;
}
export function falResizeInput(imageDataUrl, options = {}) {
  const width = Number(options.width);
  const height = Number(options.height);
  if (![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096)) {
    throw failure('invalid-image-tool-options', '宽度和高度须为 64 至 4096 的整数。', 400);
  }
  return { image_url: imageDataUrl, target_sizes: [`${width}x${height}`], resolution: falPricing.falResolution(options), num_images_per_size: 1, output_format: 'png' };
}

export async function normalizeFalResizeOptions(imageDataUrl, options = {}) {
  const { buffer } = parseImageDataUrl(imageDataUrl);
  const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  const swapped = metadata.orientation >= 5 && metadata.orientation <= 8;
  const sourceWidth = swapped ? metadata.height : metadata.width;
  const sourceHeight = swapped ? metadata.width : metadata.height;
  let normalized;
  if (options.width !== undefined || options.height !== undefined) {
    falResizeInput(imageDataUrl, options);
    normalized = { width: Number(options.width), height: Number(options.height) };
  } else {
    const edges = ['left', 'right', 'up', 'down'].map(key => Number(options[key] || 0));
    if (!edges.every(value => Number.isInteger(value) && value >= 0 && value <= 2000) || !edges.some(Boolean)) {
      throw failure('invalid-image-tool-options', '修改尺寸参数无效。', 400);
    }
    normalized = { width: sourceWidth + edges[0] + edges[1], height: sourceHeight + edges[2] + edges[3] };
  }
  falResizeInput(imageDataUrl, normalized);
  if (!sourceWidth || !sourceHeight || metadata.pages > 1 || normalized.width < sourceWidth || normalized.height < sourceHeight
      || (normalized.width === sourceWidth && normalized.height === sourceHeight)) {
    throw failure('invalid-image-tool-options', '扩图必须保留完整原图，并至少向外扩展一边；最大尺寸为 4096 px。', 400);
  }
  return normalized;
}

async function prepareFalExpansion(imageDataUrl, options) {
  const dimensions = await normalizeFalResizeOptions(imageDataUrl, options);
  const { buffer } = parseImageDataUrl(imageDataUrl);
  const source = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().toColourspace('srgb').ensureAlpha().png().toBuffer({ resolveWithObject: true });
  const left = Math.floor((dimensions.width - source.info.width) / 2);
  const top = Math.floor((dimensions.height - source.info.height) / 2);
  const padded = await sharp(source.data).extend({ left, top,
    right: dimensions.width - source.info.width - left, bottom: dimensions.height - source.info.height - top,
    background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const input = falResizeInput(`data:image/png;base64,${padded.toString('base64')}`, dimensions);
  input.prompt = `Outpaint only the transparent margins outside the original image. The output canvas is ${dimensions.width}x${dimensions.height} pixels. Keep the original ${source.info.width}x${source.info.height} image fixed at x=${left}, y=${top}, at its original scale. Seamlessly continue its background, lighting and scene into the margins. Do not crop, resize, move, redraw or replace the original content. Fill every transparent margin.`;
  return { input, source: source.data, left, top, ...dimensions };
}

export async function normalizeFalEnhanceOptions(imageDataUrl) {
  const { buffer } = parseImageDataUrl(imageDataUrl);
  const metadata = await sharp(buffer, { limitInputPixels: 6_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.pages > 1 || metadata.width * metadata.height > 6_000_000) {
    throw failure('invalid-image-tool-options', '画质提升支持不超过 600 万像素的静态图片，请先缩小图片。', 400);
  }
  return { megapixels: Math.ceil(metadata.width * metadata.height * 4 / 1_000_000) };
}

export async function runFalImageTool(model, imageDataUrl, options = {}, dependencies = {}) {
  if (!['smart-resize', 'feynobg', 'topaz/upscale/image'].includes(model)) throw failure('invalid-image-tool', '不支持此图片工具。', 400);
  const key = assertFalConfigured(dependencies.env || process.env);
  parseImageDataUrl(imageDataUrl);
  const expansion = model === 'smart-resize' ? await prepareFalExpansion(imageDataUrl, options) : null;
  const input = expansion ? expansion.input : model === 'topaz/upscale/image' ? { image_url: imageDataUrl, upscale_factor: 2, model: 'Standard MAX', output_format: 'png', face_enhancement: false } : { image_url: imageDataUrl };
  const fetchImpl = dependencies.fetchImpl || fetch;
  const sleep = dependencies.sleep || delay;
  const endpoint = `${origin}/fal-ai/${model}`;
  let accepted = Boolean(dependencies.existingTaskId);
  let submitted = false;
  const json = async (url, method = 'GET', body) => {
    const response = await fetchImpl(url, {
      method, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const error = failure('provider-request-failed', '图片工具请求失败，请稍后重试。', 502);
      error.rejected = method === 'POST' && [400, 401, 403, 422, 429].includes(response.status);
      throw error;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw failure('provider-invalid-response', '图片工具返回异常。');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  };
  try {
    submitted = !dependencies.existingTaskId;
    const task = dependencies.existingTaskId
      ? { request_id: dependencies.existingTaskId }
      : await json(endpoint, 'POST', input);
    accepted = true;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(task.request_id || '')) throw failure('provider-invalid-response', '图片任务标识缺失。');
    const taskEndpoint = model.startsWith('topaz/') ? `${origin}/fal-ai/topaz` : endpoint;
    const taskUrl = `${taskEndpoint}/requests/${task.request_id}`;
    if (!dependencies.existingTaskId && dependencies.onAccepted) {
      await dependencies.onAccepted({ taskId: task.request_id, pollUrl: `${taskUrl}/status` });
    }
    const deadline = Date.now() + 9 * 60_000;
    while (Date.now() < deadline) {
      const state = await json(`${taskUrl}/status`);
      if (state.status === 'COMPLETED') {
        const result = await json(taskUrl);
        const url = model === 'smart-resize' ? result.images?.[0]?.url : result.image?.url;
        if (!url) throw failure('provider-result-missing', '图片结果暂未就绪。');
        const output = await downloadAi302ImageResult(url, { fetchImpl });
        if (!expansion) return output;
        const metadata = await sharp(output, { limitInputPixels: 40_000_000 }).metadata();
        if (metadata.width !== expansion.width || metadata.height !== expansion.height) {
          throw failure('provider-invalid-response', '扩图结果尺寸不匹配，请重试。', 502);
        }
        // The model generates only the surround; restore the original pixels exactly.
        const original = await sharp(expansion.source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = await sharp(output).toColourspace('srgb').ensureAlpha().raw().toBuffer();
        const rowBytes = original.info.width * 4;
        for (let row = 0; row < original.info.height; row++) {
          original.data.copy(pixels, ((row + expansion.top) * expansion.width + expansion.left) * 4, row * rowBytes, (row + 1) * rowBytes);
        }
        return await sharp(pixels, { raw: { width: expansion.width, height: expansion.height, channels: 4 } }).png().toBuffer();
      }
      if (!['IN_QUEUE', 'IN_PROGRESS'].includes(state.status)) throw failure('provider-invalid-response', '图片任务状态异常。');
      await sleep(1500);
    }
    throw failure('provider-timeout', '图片仍在处理中，请稍后重试。');
  } catch (error) {
    if (accepted) error.providerTaskAccepted = true;
    else if (submitted && !error.rejected) error.submissionAmbiguous = true;
    throw error;
  }
}
