'use strict';

// Default image requests retain the legacy compatibility route; catalog entries
// can opt into native Gemini image generation explicitly.
const DEFAULT_IMAGE_ENDPOINT = 'https://api.302.ai/ws/api/v3/google/nano-banana-pro/text-to-image';
const DEFAULT_VIDEO_ENDPOINT = 'https://api.quickrouter.ai/v1/videos?model=sora-2';
const DEFAULT_RESULT_ENDPOINT = 'https://api.quickrouter.ai/v1/videos';
const IMAGE_SIZES = new Set(['1K', '2K', '4K']);
const GPT_IMAGE_2_SIZES = new Set([
  '1024x1024', '2048x2048', '2880x2880',
  '1536x1024', '3072x2048', '1024x1536', '2048x3072',
  '1920x1080', '3840x2160', '1080x1920', '2160x3840',
  '1920x1200', '3200x2000', '1200x1920', '2000x3200',
  '2048x1024', '3840x1920', '1024x2048', '1920x3840',
  '1600x1200', '3200x2400', '1200x1600', '2400x3200',
  '1600x1280', '3200x2560', '1280x1600', '2560x3200',
  '2520x1080', '3780x1620', 'auto'
]);
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MAX_PIXELS = 8_300_000;
const GPT_IMAGE_2_RESOLUTION_AREAS = Object.freeze({
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  // GPT Image 2's 4K ceiling is pixel-area limited rather than a literal
  // 4096px edge. Keep the request within the provider's documented maximum.
  '4K': GPT_IMAGE_2_MAX_PIXELS
});
const GPT_IMAGE_2_RESOLUTION_EDGES = Object.freeze({
  '1K': 1024,
  '2K': 2048,
  '4K': 3840
});
const GPT_IMAGE_2_QUALITIES = new Set(['low', 'medium', 'high', 'auto']);
const GPT_IMAGE_2_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const GPT_IMAGE_2_MAX_REFERENCE_BYTES = (25 * 1024 * 1024) - 1;
const IMAGE_RATIOS = new Set([
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '5:4', '4:5', '21:9',
  '16:10', '10:16', '2:1', '1:2'
]);
const VIDEO_RATIOS = new Set(['16:9', '9:16']);

function normalizeEndpoint(value, fallback) {
  try {
    const url = new URL(String(value || fallback).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    return url.toString();
  } catch (err) {
    return fallback;
  }
}

function normalizeConfig(config = {}) {
  return {
    imageEndpoint: normalizeEndpoint(config.imageEndpoint, DEFAULT_IMAGE_ENDPOINT),
    imageModel: String(config.imageModel || '').trim(),
    videoEndpoint: normalizeEndpoint(config.videoEndpoint, DEFAULT_VIDEO_ENDPOINT),
    resultEndpoint: normalizeEndpoint(config.resultEndpoint, DEFAULT_RESULT_ENDPOINT),
    apiKey: String(config.apiKey || '').trim(),
    imageSize: IMAGE_SIZES.has(config.imageSize) ? config.imageSize : '1K',
    imageQuality: GPT_IMAGE_2_QUALITIES.has(config.imageQuality) ? config.imageQuality : 'auto',
    imageAspectRatio: IMAGE_RATIOS.has(config.imageAspectRatio) ? config.imageAspectRatio : 'auto',
    videoAspectRatio: VIDEO_RATIOS.has(config.videoAspectRatio) ? config.videoAspectRatio : '16:9',
    videoDuration: Math.min(15, Math.max(6, Number(config.videoDuration) || 6)),
    pollIntervalMs: Math.max(800, Number(config.pollIntervalMs) || 2500),
    timeoutMs: Math.max(10000, Number(config.timeoutMs) || 20 * 60 * 1000)
  };
}

function withQuery(endpoint, values) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function formatAuthorization(apiKey) {
  const text = String(apiKey || '').trim();
  if (!text) return '';
  return /^Bearer\s+/i.test(text) ? text : `Bearer ${text}`;
}

function formatMidjourneySecret(apiKey) {
  return String(apiKey || '').trim().replace(/^Bearer\s+/i, '');
}

function detectMediaProtocol(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || '').trim());
  } catch (err) {
    return 'generic-async';
  }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (/\/higgsfield\/soul\/standard\/?$/.test(pathname)) {
    return 'higgsfield-soul-standard';
  }
  if (/\/higgsfield\/v1\/text2image\/soul\/?$/.test(pathname)) {
    return 'higgsfield-soul';
  }
  if (/\/mj\/submit\/imagine\/?$/.test(pathname)) {
    return 'midjourney-imagine';
  }
  if (/\/mj-turbo\/submit\/imagine\/?$/.test(pathname)) {
    return 'midjourney-imagine';
  }
  if (host === 'api.legnext.ai' && /\/api\/v1\/diffusion\/?$/.test(pathname)) {
    return 'legnext-midjourney';
  }
  if (/\/klingai\/v1\/images\/(?:generations|multi-image2image)\/?$/.test(pathname)) {
    return 'ai302-kling-image';
  }
  if (/\/doubao\/drawing\/?$/.test(pathname)) {
    return 'ai302-jimeng-drawing';
  }
  if (pathname.startsWith('/kling/')) {
    return 'quickrouter-kling';
  }
  if (
    /\/v1\/video\/(?:create|query)\/?$/.test(pathname)
  ) {
    return 'quickrouter-unified-video';
  }
  if (
    host.includes('generativelanguage.googleapis.com') ||
    /^\/v1beta(?:\/|$)/.test(pathname) ||
    /^\/google\/v1\/models\/[^/]+\/?$/.test(pathname) ||
    /\/models\/[^/]+:(?:stream)?generatecontent\/?$/.test(pathname)
  ) {
    return 'gemini-native';
  }
  if (/\/images\/(?:generations|edits)\/?$/.test(pathname)) {
    return 'openai-images';
  }
  if (
    /\/videos\/?$/.test(pathname) ||
    /\/videos\/[^/]+(?:\/content)?\/?$/.test(pathname)
  ) {
    return 'openai-videos';
  }
  if (/\/chat\/completions\/?$/.test(pathname)) {
    return 'openai-chat-media';
  }
  if (/^\/ws\/api\/v3\/google\/nano-banana-(?:pro|2(?:-lite)?)\/(?:text-to-image|edit)\/?$/.test(pathname)) {
    return 'ai302-nano-banana-v3';
  }
  if (/^\/302\/submit\/gemini-2\.5-flash-image(?:-edit)?-async\/?$/.test(pathname)) {
    return 'ai302-nano-banana-legacy';
  }
  if (
    pathname === '/' ||
    /^\/v\d+(?:beta\d*)?\/?$/.test(pathname) ||
    /\/(?:chat\/completions|responses|models)\/?$/.test(pathname)
  ) {
    return 'openai-compatible';
  }
  return 'generic-async';
}

function deriveKlingModel(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch (err) {
    return 'kling-v3';
  }
  const queryModel = url.searchParams.get('model_name') || url.searchParams.get('model');
  const segments = url.pathname.split('/').filter(Boolean);
  const pathModel = [...segments].reverse().find((segment) => (
    /^kling-(?:v?\d|o)/i.test(segment) &&
    !/^(?:kling-)?(?:image|text)(?:-to)?-?video$/i.test(segment)
  ));
  const raw = String(queryModel || pathModel || 'kling-v3').toLowerCase();
  if (/^kling-v\d/.test(raw)) return raw.replace(/\./g, '-');
  const match = /^kling-(\d+)(?:[.-](\d+))?(?:-(turbo|master))?/.exec(raw);
  if (!match) return 'kling-v3';
  const major = match[1];
  const minor = match[2] && match[2] !== '0' ? `-${match[2]}` : '';
  const suffix = match[3] ? `-${match[3]}` : '';
  if (major === '3') return 'kling-v3';
  return `kling-v${major}${minor}${suffix}`;
}

function normalizeKlingDuration(value) {
  return Number(value) >= 8 ? '10' : '5';
}

function resolveAi302KlingImageEndpoint(endpoint, referenceCount = 0) {
  const url = new URL(endpoint);
  url.pathname = Number(referenceCount) >= 2
    ? '/klingai/v1/images/multi-image2image'
    : '/klingai/v1/images/generations';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildAi302KlingImageBody(request, config, endpoint) {
  const prompt = String(request.prompt || '').trim();
  const images = cleanPublicUrls(request.urls, 4);
  const isMultiImage = /\/multi-image2image\/?$/i.test(new URL(endpoint).pathname);
  const aspectRatio = IMAGE_RATIOS.has(request.aspectRatio) && request.aspectRatio !== 'auto'
    ? request.aspectRatio
    : '1:1';
  if (isMultiImage) {
    return {
      model_name: String(config.imageModel || 'kling-v2').trim() || 'kling-v2',
      ...(prompt ? { promot: prompt.slice(0, 2500) } : {}),
      subject_image_list: images.map((subjectImage) => ({ subject_image: subjectImage })),
      n: 1,
      aspect_ratio: aspectRatio
    };
  }
  return {
    model_name: String(config.imageModel || 'kling-v2').trim() || 'kling-v2',
    prompt: prompt.slice(0, 500),
    ...(images.length ? { image: images[0] } : {}),
    n: 1,
    aspect_ratio: aspectRatio,
    resolution: String(request.size || '1K').trim().toLowerCase() === '2k' ? '2k' : '1k'
  };
}

function resolveQuickRouterKlingEndpoint(endpoint, hasReferenceImage) {
  const url = new URL(endpoint);
  url.pathname = hasReferenceImage
    ? '/kling/v1/videos/image2video'
    : '/kling/v1/videos/text2video';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildQuickRouterKlingBody(request, config) {
  const imageUrls = cleanPublicUrls(request.urls, 2);
  const hasReferenceImage = imageUrls.length > 0;
  const body = {
    model_name: deriveKlingModel(config.videoEndpoint),
    prompt: String(request.prompt || '').trim().slice(0, 2500),
    mode: hasReferenceImage ? 'std' : 'high',
    duration: normalizeKlingDuration(request.duration || config.videoDuration)
  };
  if (hasReferenceImage) {
    body.image = imageUrls[0];
    if (imageUrls[1]) body.image_tail = imageUrls[1];
  } else {
    body.multi_shot = 'false';
    body.aspect_ratio = VIDEO_RATIOS.has(request.aspectRatio)
      ? request.aspectRatio
      : config.videoAspectRatio;
  }
  return body;
}

function resolveOpenAiImagesEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (/\/images\/edits\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/edits\/?$/i, '/generations');
  }
  if (!/\/images\/generations\/?$/i.test(url.pathname)) {
    let pathname = url.pathname
      .replace(/\/(?:chat\/completions|responses|models)\/?$/i, '')
      .replace(/\/$/, '');
    if (!pathname || pathname === '/') pathname = '/v1';
    if (!/\/v\d+(?:beta\d*)?$/i.test(pathname)) pathname = `${pathname}/v1`;
    url.pathname = `${pathname}/images/generations`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveOpenAiChatMediaEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    let pathname = url.pathname.replace(/\/$/, '');
    if (!pathname || pathname === '/') pathname = '/v1';
    if (!/\/v\d+(?:beta\d*)?$/i.test(pathname)) pathname = `${pathname}/v1`;
    url.pathname = `${pathname}/chat/completions`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveOpenAiImageEditsEndpoint(endpoint) {
  const url = new URL(resolveOpenAiImagesEndpoint(endpoint));
  url.pathname = url.pathname.replace(/\/generations\/?$/i, '/edits');
  return url.toString();
}

function resolveOpenAiVideosEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (/\/videos\/[^/]+(?:\/content)?\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/videos\/[^/]+(?:\/content)?\/?$/i, '/videos');
  }
  if (!/\/videos\/?$/i.test(url.pathname)) {
    let pathname = url.pathname
      .replace(/\/(?:chat\/completions|responses|models|images\/generations)\/?$/i, '')
      .replace(/\/$/, '');
    if (!pathname || pathname === '/') pathname = '/v1';
    if (!/\/v\d+(?:beta\d*)?$/i.test(pathname)) pathname = `${pathname}/v1`;
    url.pathname = `${pathname}/videos`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function endpointModel(endpoint, fallback) {
  try {
    const url = new URL(endpoint);
    return String(url.searchParams.get('model') || fallback || '').trim();
  } catch (err) {
    return String(fallback || '').trim();
  }
}

function openAiVideoDuration(value) {
  const requested = Number(value) || 4;
  return [4, 8, 12].reduce((closest, seconds) => (
    Math.abs(seconds - requested) <= Math.abs(closest - requested) ? seconds : closest
  ), 4);
}

function closestOpenAiImageSize(request) {
  const width = Number(request.sourceWidth);
  const height = Number(request.sourceHeight);
  const ratio = width > 0 && height > 0
    ? width / height
    : (() => {
      const match = String(request.aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      return match ? Number(match[1]) / Number(match[2]) : 1;
    })();
  if (ratio > 1.15) return '1536x1024';
  if (ratio < 0.87) return '1024x1536';
  return '1024x1024';
}

function isGptImage2Model(model) {
  return String(model || '').trim().toLowerCase() === 'gpt-image-2';
}

function gptImage2Size(request) {
  const requested = String(request && request.size || '').trim().toLowerCase();
  const preset = requested.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(GPT_IMAGE_2_RESOLUTION_EDGES, preset)) {
    const ratioText = String(request && request.aspectRatio || '').trim();
    const ratioMatch = ratioText.match(/^(\d+):(\d+)$/);
    const ratio = requestedAspectRatio(request, 1);
    if (!Number.isFinite(ratio) || ratio < 1 / 3 || ratio > 3) return 'auto';

    if (ratioMatch) {
      let ratioWidth = Number(ratioMatch[1]);
      let ratioHeight = Number(ratioMatch[2]);
      const gcd = (left, right) => {
        let a = left;
        let b = right;
        while (b) [a, b] = [b, a % b];
        return a;
      };
      const lcm = (left, right) => (left * right) / gcd(left, right);
      const divisor = gcd(ratioWidth, ratioHeight);
      ratioWidth /= divisor;
      ratioHeight /= divisor;
      const alignmentStep = lcm(
        16 / gcd(ratioWidth, 16),
        16 / gcd(ratioHeight, 16)
      );
      const targetEdge = GPT_IMAGE_2_RESOLUTION_EDGES[preset];
      const maximumMultiplier = Math.floor(Math.min(
        targetEdge / Math.max(ratioWidth, ratioHeight),
        GPT_IMAGE_2_MAX_EDGE / ratioWidth,
        GPT_IMAGE_2_MAX_EDGE / ratioHeight,
        Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / (ratioWidth * ratioHeight))
      ));
      const multiplier = Math.floor(maximumMultiplier / alignmentStep) * alignmentStep;
      if (multiplier > 0) return `${ratioWidth * multiplier}x${ratioHeight * multiplier}`;
    }

    const targetEdge = GPT_IMAGE_2_RESOLUTION_EDGES[preset];
    let width = ratio >= 1 ? targetEdge : targetEdge * ratio;
    let height = ratio >= 1 ? targetEdge / ratio : targetEdge;
    const pixelScale = Math.min(1, Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / (width * height)));
    width = Math.max(16, Math.floor((width * pixelScale) / 16) * 16);
    height = Math.max(16, Math.floor((height * pixelScale) / 16) * 16);
    return `${width}x${height}`;
  }
  if (requested === 'auto') return requested;
  const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec(requested);
  if (!match) return 'auto';
  const width = Math.floor(Number(match[1]) / 16) * 16;
  const height = Math.floor(Number(match[2]) / 16) * 16;
  if (width < 16 || height < 16 || width / height < 1 / 3 || width / height > 3) return 'auto';
  if (width > GPT_IMAGE_2_MAX_EDGE || height > GPT_IMAGE_2_MAX_EDGE) return 'auto';
  if (width * height > GPT_IMAGE_2_MAX_PIXELS) return 'auto';
  return `${width}x${height}`;
}

function gptImage2Quality(request, config) {
  const requested = String(request && request.quality || '').trim().toLowerCase();
  if (GPT_IMAGE_2_QUALITIES.has(requested)) return requested;
  return GPT_IMAGE_2_QUALITIES.has(config && config.imageQuality) ? config.imageQuality : 'auto';
}

function invalidGptImageReference(message, code = 'invalid-reference-image') {
  const error = new Error(message);
  error.code = code;
  error.status = code === 'reference-image-too-large' ? 413 : 400;
  return error;
}

function isSeedreamModel(model) {
  return /(?:^|[-_.])seedream(?:[-_.]|$)/i.test(String(model || ''));
}

function isSeedEditModel(model) {
  return /(?:^|[-_.])seededit(?:[-_.]|$)/i.test(String(model || ''));
}

function isDoubaoImageGenerationModel(model) {
  return isSeedreamModel(model) || isSeedEditModel(model);
}

function requestedAspectRatio(request, fallback = 1) {
  const width = Number(request.sourceWidth);
  const height = Number(request.sourceHeight);
  if (width > 0 && height > 0) return width / height;
  const match = String(request.aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return fallback;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
}

function seedreamImageSize(request) {
  const ratio = Math.max(1 / 16, Math.min(16, requestedAspectRatio(request, 1)));
  const edge = String(request.size || '').toUpperCase() === '4K' ? 4096 : 2048;
  // Keep the requested square-resolution pixel area while aligning both
  // edges for the image encoder.  Align down so 4K never exceeds Seedream's
  // documented 16,777,216-pixel upper bound.
  const area = edge * edge;
  let width = Math.max(32, Math.floor(Math.sqrt(area * ratio) / 32) * 32);
  let height = Math.max(32, Math.floor(Math.sqrt(area / ratio) / 32) * 32);
  while (width * height > area) {
    if (width >= height) width -= 32;
    else height -= 32;
  }
  return `${width}x${height}`;
}

function documentedSeedreamSize(model, request) {
  const normalizedModel = String(model || '').trim().toLowerCase();
  const requested = String(request && request.size || '').trim();
  const upper = requested.toUpperCase();
  if (/seedream-(?:5-0|4-5)/.test(normalizedModel)) {
    return ['2K', '4K'].includes(upper) ? upper : '2K';
  }
  if (/seedream-4-0/.test(normalizedModel)) {
    return ['1K', '2K', '4K'].includes(upper) ? upper : '2K';
  }
  if (/seedream-3-0/.test(normalizedModel)) return '1024x1024';
  return seedreamImageSize(request);
}

function jimengDrawingDimensions(request) {
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(String(request && request.size || '').trim());
  const width = match ? Number(match[1]) : 1024;
  const height = match ? Number(match[2]) : 1024;
  if (![512, 1024].includes(width) || ![512, 1024].includes(height)) {
    return { width: 1024, height: 1024 };
  }
  return { width, height };
}

function withMidjourneyAspectRatio(prompt, aspectRatio) {
  const text = String(prompt || '').trim();
  if (!IMAGE_RATIOS.has(aspectRatio) || aspectRatio === 'auto' || /(?:^|\s)--ar(?:\s|=)/i.test(text)) {
    return text;
  }
  return `${text} --ar ${aspectRatio}`;
}

// Legnext accepts Midjourney controls inside a single text field. V8.1/V8.2
// reject several legacy flags, so conflicting values are removed before the
// selected model and resolution are appended.
function withLegnextMidjourneyParameters(prompt, model, aspectRatio, size) {
  let text = String(prompt || '').trim();
  text = text
    .replace(/(?:^|\s)--(?:v|version|ar|aspect|q|quality|oref|ow|cref|cw)(?:=|\s+)[^\s]+/gi, ' ')
    .replace(/(?:^|\s)--(?:turbo|sd|hd)(?=\s|$)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const version = /8\.1/.test(String(model || '')) ? '8.1' : '8.2';
  const ratio = String(aspectRatio || '').trim();
  const flags = [`--v ${version}`];
  const ratioMatch = /^(\d+):(\d+)$/.exec(ratio);
  const ratioValue = ratioMatch ? Number(ratioMatch[1]) / Number(ratioMatch[2]) : 0;
  if (ratioMatch && Number.isFinite(ratioValue) && ratioValue >= 0.25 && ratioValue <= 4) {
    flags.push(`--ar ${ratio}`);
  }
  if (String(size || '').trim().toUpperCase() === '2K') flags.push('--hd');
  return [text, ...flags].filter(Boolean).join(' ');
}

function buildOpenAiImageBody(request, config) {
  const model = String(config.imageModel || '').trim() || endpointModel(config.imageEndpoint, 'gpt-image-1');
  if (isSeedreamModel(model)) {
    const images = cleanPublicUrls(request.urls, 14);
    return {
      model,
      prompt: String(request.prompt || '').trim(),
      ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
      size: documentedSeedreamSize(model, request),
      sequential_image_generation: 'disabled',
      response_format: 'url',
      watermark: false
    };
  }
  if (isSeedEditModel(model)) {
    const images = cleanPublicUrls(request.urls, 1);
    return {
      model,
      prompt: String(request.prompt || '').trim(),
      ...(images.length ? { image: images[0] } : {}),
      size: 'adaptive',
      response_format: 'url',
      watermark: false
    };
  }
  if (isGptImage2Model(model)) {
    return {
      model,
      prompt: String(request.prompt || '').trim(),
      n: 1,
      size: gptImage2Size(request),
      quality: gptImage2Quality(request, config),
      output_format: 'png'
    };
  }
  return {
    model,
    prompt: String(request.prompt || '').trim(),
    n: 1,
    size: closestOpenAiImageSize(request)
  };
}

function buildOpenAiImageEditForm(request, config) {
  const model = String(config.imageModel || '').trim() || endpointModel(config.imageEndpoint, 'gpt-image-1');
  if (isDoubaoImageGenerationModel(model)) return null;
  const isGptImage2 = isGptImage2Model(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', String(request.prompt || '').trim());
  form.append('n', '1');
  form.append('size', isGptImage2 ? gptImage2Size(request) : closestOpenAiImageSize(request));
  if (isGptImage2) {
    form.append('quality', gptImage2Quality(request, config));
    form.append('output_format', 'png');
  }
  const referenceValues = isGptImage2
    ? (Array.isArray(request.urls) ? request.urls.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 14) : [])
    : cleanPublicUrls(request.urls, 14);
  const images = referenceValues
    .map((value) => {
      const image = dataUrlImageFile(value, 'reference', isGptImage2 ? {
        allowedMimeTypes: GPT_IMAGE_2_REFERENCE_MIME_TYPES,
        exclusiveMaxBytes: 25 * 1024 * 1024
      } : {});
      if (isGptImage2 && !image) {
        throw invalidGptImageReference('GPT Image 2 references must be PNG, JPEG, or WebP data URLs.');
      }
      return image;
    })
    .filter(Boolean);
  images.forEach((image, index) => {
    form.append(images.length > 1 ? 'image[]' : 'image', image.blob, `reference-${index + 1}-${image.name}`);
  });
  return images.length ? form : null;
}

function buildOpenAiChatImageBody(request, config) {
  const content = [{ type: 'text', text: String(request.prompt || '').trim() }];
  cleanPublicUrls(request.urls, 14).forEach((url) => {
    content.push({ type: 'image_url', image_url: { url } });
  });
  return {
    model: endpointModel(config.imageEndpoint, 'gemini-2.5-flash-image-preview'),
    messages: [{ role: 'user', content }],
    stream: false
  };
}

function buildOpenAiVideoBody(request, config) {
  const width = Number(request.sourceWidth);
  const height = Number(request.sourceHeight);
  const landscape = width > 0 && height > 0
    ? width >= height
    : !String(request.aspectRatio || config.videoAspectRatio).startsWith('9:16');
  const model = endpointModel(config.videoEndpoint, 'sora-2');
  const isPro = /(?:^|[-_.])pro(?:$|[-_.])/i.test(model);
  return {
    model,
    prompt: String(request.prompt || '').trim(),
    seconds: String(openAiVideoDuration(request.duration || config.videoDuration)),
    size: isPro
      ? (landscape ? '1792x1024' : '1024x1792')
      : (landscape ? '1280x720' : '720x1280')
  };
}

function dataUrlImageFile(value, fallbackName = 'reference', options = {}) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (options.allowedMimeTypes && !options.allowedMimeTypes.has(mimeType)) {
    throw invalidGptImageReference('GPT Image 2 references must be PNG, JPEG, or WebP images.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (Number(options.exclusiveMaxBytes) > 0 && buffer.length >= Number(options.exclusiveMaxBytes)) {
    throw invalidGptImageReference(
      'Each GPT Image 2 reference must be smaller than 25 MB.',
      'reference-image-too-large'
    );
  }
  const extension = mimeType.split('/')[1]
    .replace('jpeg', 'jpg')
    .replace(/[^a-z0-9]/gi, '') || 'png';
  return {
    blob: new Blob([buffer], { type: mimeType }),
    name: `${fallbackName}.${extension}`
  };
}

function buildOpenAiVideoForm(request, config) {
  const reference = cleanPublicUrls(request.urls, 1)
    .map((value) => dataUrlImageFile(value, 'input-reference'))
    .find(Boolean);
  if (!reference) return null;
  const body = buildOpenAiVideoBody(request, config);
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => form.append(key, String(value)));
  form.append('input_reference', reference.blob, reference.name);
  return form;
}

function resolveQuickRouterUnifiedVideoEndpoint(endpoint, mode = 'create', taskId = '') {
  const url = new URL(endpoint);
  url.pathname = `/v1/video/${mode === 'query' ? 'query' : 'create'}`;
  url.search = '';
  if (mode === 'query' && taskId) url.searchParams.set('id', taskId);
  url.hash = '';
  return url.toString();
}

function buildQuickRouterUnifiedVideoBody(request, config) {
  const model = endpointModel(config.videoEndpoint, 'sora-2-all');
  const images = cleanPublicUrls(request.urls, 3);
  const aspectRatio = VIDEO_RATIOS.has(request.aspectRatio)
    ? request.aspectRatio
    : config.videoAspectRatio;
  const body = {
    model,
    prompt: String(request.prompt || '').trim()
  };
  if (images.length) body.images = images;
  if (/^veo/i.test(model)) {
    body.aspect_ratio = aspectRatio;
    body.enhance_prompt = true;
    body.enable_upsample = true;
  } else {
    body.orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
    body.size = 'large';
    body.duration = Math.min(15, Math.max(5, Number(request.duration) || config.videoDuration));
    body.watermark = false;
  }
  return body;
}

function isQuickRouterEndpoint(endpoint) {
  try {
    return new URL(String(endpoint || '')).hostname.toLowerCase() === 'api.quickrouter.ai';
  } catch (err) {
    return false;
  }
}

function is302GoogleGeminiEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint || ''));
    return /^\/google\/v1\/models\/[^/]+\/?$/i.test(url.pathname);
  } catch (err) {
    return false;
  }
}

function buildGeminiImageBody(request, endpoint = '') {
  const parts = [{ text: String(request.prompt || '').trim() }];
  cleanPublicUrls(request.urls, 14).forEach((value) => {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    } else {
      parts.push({ fileData: { fileUri: value } });
    }
  });
  const imageConfig = {
    ...(IMAGE_RATIOS.has(request.aspectRatio) && request.aspectRatio !== 'auto'
      ? { aspectRatio: request.aspectRatio }
      : {}),
    ...(IMAGE_SIZES.has(request.size) && !is302GoogleGeminiEndpoint(endpoint)
      ? { imageSize: request.size }
      : {})
  };
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {})
    }
  };
}

function resolveGeminiMediaEndpoint(endpoint) {
  const url = new URL(endpoint);
  let pathname = url.pathname.replace(/\/$/, '');
  // 302 exposes the Google request shape under /google/v1.  Its documented
  // path is already the complete operation endpoint, so adding the native
  // `:generateContent` suffix would route the request to a different URL.
  if (is302GoogleGeminiEndpoint(url.toString())) {
    url.pathname = pathname;
    url.hash = '';
    return url.toString();
  }
  if (url.hostname.toLowerCase() === 'api.quickrouter.ai') {
    pathname = pathname.replace(
      /\/models\/gemini-2\.5-flash-image-preview(?=:(?:stream)?generatecontent$|$)/i,
      '/models/gemini-2.5-flash-image'
    );
  }
  if (/:streamgeneratecontent$/i.test(pathname)) {
    pathname = pathname.replace(/:streamgeneratecontent$/i, ':generateContent');
  } else if (!/:generatecontent$/i.test(pathname)) {
    if (/\/models\/[^/]+$/i.test(pathname)) {
      pathname += ':generateContent';
    } else {
      if (!pathname) pathname = '/v1beta';
      if (/\/models$/i.test(pathname)) {
        pathname += '/gemini-2.5-flash-image';
      } else {
        pathname += '/models/gemini-2.5-flash-image';
      }
      pathname += ':generateContent';
    }
  }
  url.pathname = pathname;
  url.hash = '';
  return url.toString();
}

function extractInlineMediaData(value, seen = new Set(), depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractInlineMediaData(item, seen, depth + 1);
      if (result) return result;
    }
    return '';
  }
  if (typeof value.b64_json === 'string' && value.b64_json.trim()) {
    return `data:image/png;base64,${value.b64_json.trim()}`;
  }
  const inlineData = value.inlineData || value.inline_data;
  if (inlineData && typeof inlineData.data === 'string' && inlineData.data.trim()) {
    const mimeType = String(inlineData.mimeType || inlineData.mime_type || 'image/png').trim();
    if (/^image\//i.test(mimeType)) {
      return `data:${mimeType};base64,${inlineData.data.trim()}`;
    }
  }
  const priorityKeys = [
    'candidates', 'choices', 'content', 'message', 'parts',
    'images', 'image', 'data', 'result', 'output'
  ];
  for (const key of priorityKeys) {
    if (value[key] !== undefined) {
      const result = extractInlineMediaData(value[key], seen, depth + 1);
      if (result) return result;
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (!priorityKeys.includes(key) && key !== 'inlineData' && key !== 'inline_data') {
      const result = extractInlineMediaData(item, seen, depth + 1);
      if (result) return result;
    }
  }
  return '';
}

async function readJsonResponse(response, fallbackMessage, endpoint = '') {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (err) {
    if (response.ok && /^(?:https?:\/\/|data:(?:image|video)\/)/i.test(text.trim())) {
      return { url: text.trim() };
    }
    const error = new Error(
      /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text)
        ? `接口返回了网页而不是 JSON。当前地址：${endpoint || '未填写'}。请填写 API Base URL 或完整请求 URL，不要填写服务商网站首页。`
        : `${fallbackMessage}：接口没有返回有效 JSON。`
    );
    error.code = 'invalid-response';
    throw error;
  }
  if (!response.ok) {
    const apiMessage = payload && (payload.msg || payload.message || (payload.error && payload.error.message));
    const error = new Error(apiMessage || text || `${fallbackMessage} (HTTP ${response.status})`);
    error.code = 'api-error';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function extractMediaUrls(value, kind = '') {
  const candidates = [];
  const seen = new Set();
  let order = 0;

  function scoreUrl(url, keyPath) {
    const path = String(keyPath || '').toLowerCase();
    const text = String(url || '').toLowerCase();
    let score = 0;
    if (/error|message|prompt|input/.test(path) && !/result|output/.test(path)) score -= 100;
    // Async APIs often return control-plane URLs next to their task ID. They
    // are polling endpoints, not generated media, even when the last path
    // segment is named "result". In particular, Nano Banana v3 returns this
    // value as data.urls.get while the task is still in the created state.
    if (/(?:^|\.)(?:urls?\.)?(?:get|poll_url|pollurl|status_url|statusurl|query_url|queryurl)(?:\.|$)/.test(path)) {
      score -= 200;
    }
    if (/\/ws\/api\/v3\/predictions\/[^/?#]+\/result(?:[?#]|$)/.test(text)) score -= 200;
    if (kind === 'video') {
      if (/video|upsample|output|result|media/.test(path)) score += 40;
      if (/image|reference|thumbnail|poster/.test(path)) score -= 35;
      if (/^data:video\//.test(text) || /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/.test(text)) score += 80;
      if (/^data:image\//.test(text) || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/.test(text)) score -= 60;
    } else if (kind === 'image') {
      if (/image|output|result|media/.test(path)) score += 40;
      if (/video|thumbnail/.test(path)) score -= 30;
      if (/^data:image\//.test(text) || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/.test(text)) score += 80;
      if (/^data:video\//.test(text) || /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/.test(text)) score -= 60;
    }
    return score;
  }

  function addUrl(url, keyPath) {
    const text = String(url || '').trim().replace(/[),.;]+$/, '');
    if (!text) return;
    candidates.push({
      url: text,
      score: scoreUrl(text, keyPath),
      order: order++
    });
  }

  function visit(current, depth, keyPath = '') {
    if (depth > 8 || current === null || current === undefined) return;
    if (typeof current === 'string') {
      const text = current.trim();
      if (!text) return;
      if (/b64_json$/i.test(keyPath) && /^[a-z0-9+/=\s]+$/i.test(text)) {
        addUrl(`data:image/png;base64,${text.replace(/\s+/g, '')}`, keyPath);
        return;
      }
      if (/^data:(image|video)\//i.test(text) || /^https?:\/\//i.test(text)) {
        addUrl(text, keyPath);
        return;
      }
      if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try {
          visit(JSON.parse(text), depth + 1, keyPath);
          return;
        } catch (err) {}
      }
      const inlineData = text.match(/data:(?:image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/i);
      if (inlineData) addUrl(inlineData[0], keyPath);
      const embeddedUrls = text.match(/https?:\/\/[^\s"'<>()[\]]+/gi) || [];
      embeddedUrls.forEach((url) => addUrl(url, keyPath));
      return;
    }
    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, depth + 1, `${keyPath}[${index}]`));
      return;
    }
    const priorityKeys = [
      'video_url', 'videoUrl', 'upsample_video_url', 'upsampleVideoUrl',
      'image_url', 'imageUrl', 'b64_json',
      'url', 'urls', 'video', 'videos', 'image', 'images',
      'output', 'outputs', 'result', 'results', 'data'
    ];
    for (const key of priorityKeys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        visit(current[key], depth + 1, keyPath ? `${keyPath}.${key}` : key);
      }
    }
    for (const [key, item] of Object.entries(current)) {
      if (!priorityKeys.includes(key)) {
        visit(item, depth + 1, keyPath ? `${keyPath}.${key}` : key);
      }
    }
  }

  visit(value, 0);
  return candidates
    .filter((candidate) => candidate.score > -80)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((candidate) => candidate.url)
    .filter((url, index, list) => list.indexOf(url) === index);
}

function cleanPublicUrls(urls, limit) {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((item) => String(item || '').trim())
    .filter((item) => /^https?:\/\//i.test(item) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(item))
    .slice(0, limit);
}

function buildRequestBody(kind, request, config, endpoint) {
  const prompt = String(request.prompt || '').trim();
  const protocol = detectMediaProtocol(endpoint || (kind === 'video' ? config.videoEndpoint : config.imageEndpoint));
  if (kind === 'video' && protocol === 'quickrouter-kling') {
    return buildQuickRouterKlingBody(request, config);
  }
  if (kind === 'video' && protocol === 'quickrouter-unified-video') {
    return buildQuickRouterUnifiedVideoBody(request, config);
  }
  if (kind === 'image' && protocol === 'openai-images') {
    return buildOpenAiImageBody(request, config);
  }
  if (kind === 'image' && protocol === 'openai-chat-media') {
    return buildOpenAiChatImageBody(request, config);
  }
  if (kind === 'image' && protocol === 'gemini-native') {
    return buildGeminiImageBody(request, endpoint);
  }
  if (kind === 'image' && (protocol === 'ai302-nano-banana-v3' || protocol === 'ai302-nano-banana-legacy')) {
    return buildAi302NanoBananaBody(request, endpoint || config.imageEndpoint);
  }
  if (kind === 'image' && protocol === 'ai302-kling-image') {
    return buildAi302KlingImageBody(request, config, endpoint || config.imageEndpoint);
  }
  if (kind === 'image' && protocol === 'ai302-jimeng-drawing') {
    const dimensions = jimengDrawingDimensions(request);
    return {
      prompt,
      model_version: String(config.imageModel || 'general_v3.0').trim() || 'general_v3.0',
      llm_seed: -1,
      seed: Number.isInteger(Number(request.seed)) ? Number(request.seed) : -1,
      scale: 3.5,
      ddim_steps: 25,
      width: dimensions.width,
      height: dimensions.height,
      use_pre_llm: true,
      use_sr: dimensions.width >= 1024 || dimensions.height >= 1024,
      sr_seed: -1,
      sr_strength: 0.4,
      sr_scale: 3.5,
      sr_steps: 20,
      is_only_sr: false,
      return_url: true,
      logo_info: { add_logo: false, position: 0, language: 0, opacity: 0.3, logo_text_content: '' }
    };
  }
  if (kind === 'image' && protocol === 'legnext-midjourney') {
    return {
      text: withLegnextMidjourneyParameters(
        prompt,
        config.imageModel,
        request.aspectRatio,
        request.size
      )
    };
  }
  if (kind === 'image' && protocol === 'midjourney-imagine') {
    return {
      botType: 'MID_JOURNEY',
      prompt: withMidjourneyAspectRatio(prompt, request.aspectRatio),
      base64Array: cleanPublicUrls(request.urls, 8)
        .map((value) => {
          const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(value);
          return match ? match[1] : '';
        })
        .filter(Boolean),
      notifyHook: '',
      state: ''
    };
  }
  if (kind === 'image' && protocol === 'higgsfield-soul-standard') {
    return buildHiggsfieldSoulStandardBody(request);
  }
  if (kind === 'image' && protocol === 'higgsfield-soul') {
    return buildHiggsfieldSoulBody(request);
  }
  if (kind === 'image' && protocol === 'openai-compatible') {
    return buildOpenAiImageBody(request, config);
  }
  if (kind === 'video' && (protocol === 'openai-videos' || protocol === 'openai-compatible')) {
    return buildOpenAiVideoBody(request, config);
  }
  if (kind === 'video') {
    const imageUrls = cleanPublicUrls(request.urls, 4);
    return {
      prompt,
      duration: String(Math.min(15, Math.max(6, Number(request.duration) || config.videoDuration))),
      aspect_ratio: VIDEO_RATIOS.has(request.aspectRatio) ? request.aspectRatio : config.videoAspectRatio,
      ...(imageUrls.length ? { image_urls: imageUrls } : {})
    };
  }
  const imageUrls = cleanPublicUrls(request.urls, 14);
  return {
    prompt,
    size: request.size === 'original'
      ? 'original'
      : (IMAGE_SIZES.has(request.size) ? request.size : config.imageSize),
    aspectRatio: /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.test(String(request.aspectRatio || ''))
      ? request.aspectRatio
      : config.imageAspectRatio,
    ...(Number(request.sourceWidth) > 0 && Number(request.sourceHeight) > 0
      ? { width: Math.round(Number(request.sourceWidth)), height: Math.round(Number(request.sourceHeight)) }
      : {}),
    ...(imageUrls.length ? { urls: imageUrls } : {})
  };
}

function resolveAi302NanoBananaEndpoint(endpoint, hasReferenceImages = false) {
  const url = new URL(endpoint);
  if (/^\/ws\/api\/v3\/google\/nano-banana-/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(?:text-to-image|edit)\/?$/i, hasReferenceImages ? '/edit' : '/text-to-image');
  } else {
    url.pathname = hasReferenceImages
      ? '/302/submit/gemini-2.5-flash-image-edit-async'
      : '/302/submit/gemini-2.5-flash-image-async';
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveAi302NanoBananaPollEndpoint(endpoint, taskId) {
  const url = new URL(endpoint);
  const id = String(taskId || '').trim();
  if (/^\/ws\/api\/v3\/google\/nano-banana-/i.test(url.pathname)) {
    url.pathname = `/ws/api/v3/predictions/${encodeURIComponent(id)}/result`;
    url.search = '';
  } else {
    url.pathname = '/302/submit/gemini-2.5-flash-image-async';
    url.search = '';
    url.searchParams.set('request_id', id);
  }
  url.hash = '';
  return url.toString();
}

function buildAi302NanoBananaBody(request, endpoint) {
  const images = cleanPublicUrls(request.urls, 14);
  const hasReferences = images.length > 0;
  const prompt = String(request.prompt || '').trim();
  const protocol = detectMediaProtocol(endpoint);
  if (protocol === 'ai302-nano-banana-legacy') {
    if (hasReferences) return { prompt, image_urls: images };
    const ratio = String(request.aspectRatio || '').trim();
    if (!IMAGE_RATIOS.has(ratio) || ratio === 'auto') {
      const error = new Error('The selected Nano Banana aspect ratio is not supported.');
      error.code = 'invalid-aspect-ratio';
      throw error;
    }
    return { prompt, aspect_ratio: ratio };
  }
  const lite = /\/nano-banana-2-lite\//i.test(new URL(endpoint).pathname);
  const ratio = String(request.aspectRatio || '').trim();
  if (!IMAGE_RATIOS.has(ratio) || ratio === 'auto') {
    const error = new Error('The selected Nano Banana aspect ratio is not supported.');
    error.code = 'invalid-aspect-ratio';
    throw error;
  }
  const requestedResolution = String(request.size || '').trim().toLowerCase();
  if (!lite && !['1k', '2k', '4k'].includes(requestedResolution)) {
    const error = new Error('The selected Nano Banana resolution is not supported.');
    error.code = 'invalid-size';
    throw error;
  }
  return {
    ...(lite ? { size: ratio } : { aspect_ratio: ratio, resolution: requestedResolution }),
    enable_base64_output: false,
    enable_sync_mode: false,
    ...(hasReferences ? { images } : {}),
    prompt
  };
}

const HIGGSFIELD_RATIOS = Object.freeze({
  '9:16': '1152x2048',
  '16:9': '2048x1152',
  '4:3': '2048x1536',
  '3:4': '1536x2048',
  '1:1': '1536x1536',
  '2:3': '1120x1680',
  '3:2': '1680x1120'
});

function higgsfieldOptions(request = {}) {
  const resolution = String(request.size || '720p').trim().toLowerCase() === '1080p' ? '1080p' : '720p';
  const aspectRatio = Object.hasOwn(HIGGSFIELD_RATIOS, String(request.aspectRatio || ''))
    ? String(request.aspectRatio)
    : '4:3';
  const seed = Math.round(Number(request.seed));
  const styleId = String(request.styleId || '').trim();
  const styleStrength = Math.max(0, Math.min(1, Number(request.styleStrength ?? 1)));
  return {
    resolution,
    aspectRatio,
    enhancePrompt: request.enhancePrompt !== false,
    ...(Number.isInteger(seed) && seed >= 1 && seed <= 1_000_000 ? { seed } : {}),
    ...(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(styleId) ? { styleId } : {}),
    styleStrength
  };
}

function buildHiggsfieldSoulStandardBody(request = {}) {
  const options = higgsfieldOptions(request);
  return {
    prompt: String(request.prompt || '').trim(),
    aspect_ratio: options.aspectRatio,
    resolution: options.resolution,
    batch_size: 1,
    enhance_prompt: options.enhancePrompt,
    style_strength: options.styleStrength,
    ...(options.seed ? { seed: options.seed } : {}),
    ...(options.styleId ? { style_id: options.styleId } : {})
  };
}

function buildHiggsfieldSoulBody(request = {}) {
  const options = higgsfieldOptions(request);
  return {
    params: {
      quality: options.resolution,
      prompt: String(request.prompt || '').trim(),
      enhance_prompt: options.enhancePrompt,
      width_and_height: HIGGSFIELD_RATIOS[options.aspectRatio],
      batch_size: 1,
      style_strength: options.styleStrength,
      ...(options.seed ? { seed: options.seed } : {}),
      ...(options.styleId ? { style_id: options.styleId } : {})
    }
  };
}

function extractMediaTaskId(value, seen = new Set(), depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = extractMediaTaskId(item, seen, depth + 1);
      if (id) return id;
    }
    return '';
  }
  for (const key of ['job_id', 'jobId', 'job_set_id', 'jobSetId', 'request_id', 'requestId', 'task_id', 'taskId', 'id']) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) {
      return String(value[key]).trim();
    }
  }
  for (const key of ['data', 'task_info', 'result', 'output']) {
    if (value[key] !== undefined) {
      const id = extractMediaTaskId(value[key], seen, depth + 1);
      if (id) return id;
    }
  }
  return '';
}

function extractPollUrl(value, seen = new Set(), depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return /^https?:\/\//i.test(text) ? text : '';
  }
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractPollUrl(item, seen, depth + 1);
      if (url) return url;
    }
    return '';
  }
  for (const key of ['poll_url', 'pollUrl', 'status_url', 'statusUrl', 'query_url', 'queryUrl', 'task_url', 'taskUrl']) {
    if (value[key] !== undefined) {
      const url = extractPollUrl(value[key], seen, depth + 1);
      if (url) return url;
    }
  }
  for (const key of ['data', 'task_info', 'result', 'output']) {
    if (value[key] !== undefined) {
      const url = extractPollUrl(value[key], seen, depth + 1);
      if (url) return url;
    }
  }
  return '';
}

async function submitMediaTask(fetchImpl, config, kind, request, signal) {
  const endpoint = kind === 'video' ? config.videoEndpoint : config.imageEndpoint;
  const protocol = detectMediaProtocol(endpoint);
  if (kind === 'image' && (protocol === 'ai302-nano-banana-v3' || protocol === 'ai302-nano-banana-legacy')) {
    const hasReferences = cleanPublicUrls(request.urls, 14).length > 0;
    const submitEndpoint = resolveAi302NanoBananaEndpoint(endpoint, hasReferences);
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildAi302NanoBananaBody(request, submitEndpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Nano Banana image request failed', submitEndpoint);
    const mediaUrl = extractMediaUrls(payload, 'image')[0] || extractInlineMediaData(payload);
    if (mediaUrl) return { mediaUrl };
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error(
        (payload && (payload.message || payload.msg || payload.error)) ||
        'Nano Banana did not return a task ID.'
      );
      error.code = 'api-error';
      throw error;
    }
    return {
      taskId,
      pollUrl: resolveAi302NanoBananaPollEndpoint(endpoint, taskId)
    };
  }
  if (kind === 'image' && protocol === 'ai302-kling-image') {
    const referenceCount = cleanPublicUrls(request.urls, 4).length;
    const submitEndpoint = resolveAi302KlingImageEndpoint(endpoint, referenceCount);
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildAi302KlingImageBody(request, config, submitEndpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Kling image request failed', submitEndpoint);
    if (Number(payload && payload.code) !== 0) {
      const error = new Error(payload && payload.message || 'Kling rejected the image request.');
      error.code = 'api-error';
      throw error;
    }
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error('Kling did not return an image task ID.');
      error.code = 'api-error';
      throw error;
    }
    return { taskId, pollUrl: `${submitEndpoint.replace(/\/$/, '')}/${encodeURIComponent(taskId)}` };
  }
  if (kind === 'image' && protocol === 'ai302-jimeng-drawing') {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Jimeng image request failed', endpoint);
    if (Number(payload && (payload.code ?? payload.status)) !== 10000) {
      const error = new Error(payload && payload.message || 'Jimeng rejected the image request.');
      error.code = 'api-error';
      throw error;
    }
    const mediaUrl = extractMediaUrls(payload, 'image')[0];
    if (!mediaUrl) {
      const error = new Error('Jimeng did not return a generated image.');
      error.code = 'empty-media';
      throw error;
    }
    return { mediaUrl };
  }
  if (kind === 'image' && (protocol === 'higgsfield-soul-standard' || protocol === 'higgsfield-soul')) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Higgsfield image request failed', endpoint);
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error((payload && (payload.message || payload.msg)) || 'Higgsfield did not return a task ID.');
      error.code = 'api-error';
      throw error;
    }
    const pollUrl = new URL(endpoint);
    pollUrl.pathname = `/higgsfield/v1/job-sets/${encodeURIComponent(taskId)}`;
    pollUrl.search = '';
    pollUrl.hash = '';
    return { taskId, pollUrl: pollUrl.toString() };
  }
  if (kind === 'image' && protocol === 'legnext-midjourney') {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': formatMidjourneySecret(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Legnext Midjourney request failed', endpoint);
    const mediaUrl = extractMediaUrls(payload, 'image')[0] || extractInlineMediaData(payload);
    const taskStatus = extractTaskStatus(payload);
    if (mediaUrl && /^(?:completed|succeeded|success|done|finished)$/i.test(taskStatus)) {
      return { mediaUrl };
    }
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error(extractTaskErrorMessage(payload) || 'Legnext did not return a job ID.');
      error.code = 'api-error';
      throw error;
    }
    const pollUrl = extractPollUrl(payload) || (() => {
      const url = new URL(endpoint);
      url.pathname = `/api/v1/job/${encodeURIComponent(taskId)}`;
      url.search = '';
      url.hash = '';
      return url.toString();
    })();
    return { taskId, pollUrl };
  }
  if (kind === 'image' && protocol === 'midjourney-imagine') {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'mj-api-secret': formatMidjourneySecret(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Midjourney request failed', endpoint);
    const taskId = String(payload && payload.result || '').trim();
    if (Number(payload && payload.code) !== 1 || !taskId) {
      const error = new Error(payload && payload.description || 'Midjourney did not return a task ID.');
      error.code = 'api-error';
      throw error;
    }
    const pollUrl = new URL(endpoint);
    pollUrl.pathname = pollUrl.pathname.startsWith('/mj-turbo/')
      ? `/mj-turbo/task/${encodeURIComponent(taskId)}/fetch`
      : `/mj/task/${encodeURIComponent(taskId)}/fetch`;
    pollUrl.search = '';
    pollUrl.hash = '';
    return { taskId, pollUrl: pollUrl.toString() };
  }
  if (kind === 'image' && (protocol === 'openai-images' || protocol === 'openai-compatible')) {
    const editForm = buildOpenAiImageEditForm(request, config);
    const response = await fetchImpl(
      editForm ? resolveOpenAiImageEditsEndpoint(endpoint) : resolveOpenAiImagesEndpoint(endpoint),
      {
      method: 'POST',
      headers: editForm
        ? { Authorization: formatAuthorization(config.apiKey), Accept: 'application/json' }
        : {
          Authorization: formatAuthorization(config.apiKey),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
      body: editForm || JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'AI image request failed', endpoint);
    const mediaUrl = extractMediaUrls(payload, 'image')[0] || extractInlineMediaData(payload);
    if (!mediaUrl) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) || 'The image service did not return an image.'
      );
      error.code = 'api-error';
      throw error;
    }
    return { mediaUrl };
  }
  if (kind === 'image' && protocol === 'openai-chat-media') {
    const submitEndpoint = resolveOpenAiChatMediaEndpoint(endpoint);
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildOpenAiChatImageBody(request, config)),
      signal
    });
    const payload = await readJsonResponse(response, 'AI image request failed', submitEndpoint);
    const mediaUrl = extractMediaUrls(payload, 'image')[0] || extractInlineMediaData(payload);
    if (!mediaUrl) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) ||
        'The chat-compatible image service did not return image data.'
      );
      error.code = 'api-error';
      throw error;
    }
    return { mediaUrl };
  }
  if (kind === 'image' && protocol === 'gemini-native') {
    const submitEndpoint = resolveGeminiMediaEndpoint(endpoint);
    const submitHost = new URL(submitEndpoint).hostname.toLowerCase();
    const officialGemini = submitHost === 'generativelanguage.googleapis.com';
    const quickRouter = submitHost === 'api.quickrouter.ai';
    const response = await fetchImpl(officialGemini
      ? withQuery(submitEndpoint, { key: config.apiKey })
      : submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        // QuickRouter and 302 authenticate their Gemini-compatible endpoints
        // with Bearer. Keep the Google-specific header for other compatible
        // relays and the official Google endpoint only.
        ...(officialGemini || (!quickRouter && !is302GoogleGeminiEndpoint(submitEndpoint))
          ? { 'x-goog-api-key': config.apiKey }
          : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildGeminiImageBody(request, submitEndpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'Gemini image request failed', submitEndpoint);
    const mediaUrl = extractMediaUrls(payload, 'image')[0] || extractInlineMediaData(payload);
    if (!mediaUrl) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) || 'Gemini did not return image data.'
      );
      error.code = 'api-error';
      throw error;
    }
    return { mediaUrl };
  }
  if (kind === 'video' && (protocol === 'openai-videos' || protocol === 'openai-compatible')) {
    const submitEndpoint = resolveOpenAiVideosEndpoint(endpoint);
    const videoForm = buildOpenAiVideoForm(request, config);
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: videoForm
        ? {
          Authorization: formatAuthorization(config.apiKey),
          Accept: 'application/json'
        }
        : {
          Authorization: formatAuthorization(config.apiKey),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
      body: videoForm || JSON.stringify(buildOpenAiVideoBody(request, config)),
      signal
    });
    const payload = await readJsonResponse(response, 'AI video request failed', submitEndpoint);
    const mediaUrl = extractMediaUrls(payload, 'video')[0] || extractInlineMediaData(payload);
    if (mediaUrl) return { mediaUrl };
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) || 'The video service did not return a task ID.'
      );
      error.code = 'api-error';
      throw error;
    }
    return {
      taskId,
      pollUrl: extractPollUrl(payload) ||
        `${submitEndpoint.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`
    };
  }
  if (protocol === 'quickrouter-kling') {
    const hasReferenceImage = cleanPublicUrls(request.urls, 2).length > 0;
    const submitEndpoint = resolveQuickRouterKlingEndpoint(endpoint, hasReferenceImage);
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
      signal
    });
    const payload = await readJsonResponse(response, 'AI generation request failed', submitEndpoint);
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) || 'The service did not return a video task ID.'
      );
      error.code = 'api-error';
      throw error;
    }
    return taskId;
  }
  if (kind === 'video' && protocol === 'quickrouter-unified-video') {
    const submitEndpoint = resolveQuickRouterUnifiedVideoEndpoint(endpoint, 'create');
    const response = await fetchImpl(submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(buildQuickRouterUnifiedVideoBody(request, config)),
      signal
    });
    const payload = await readJsonResponse(response, 'AI video request failed', submitEndpoint);
    const mediaUrl = extractMediaUrls(payload, 'video')[0] || extractInlineMediaData(payload);
    if (mediaUrl) return { mediaUrl };
    const taskId = extractMediaTaskId(payload);
    if (!taskId) {
      const error = new Error(
        (payload && (payload.message || payload.msg)) ||
        'The video service did not return a task ID.'
      );
      error.code = 'api-error';
      throw error;
    }
    return {
      taskId,
      pollUrl: extractPollUrl(payload) ||
        resolveQuickRouterUnifiedVideoEndpoint(endpoint, 'query', taskId)
    };
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: formatAuthorization(config.apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildRequestBody(kind, request, config, endpoint)),
    signal
  });
  const payload = await readJsonResponse(response, 'AI generation request failed', endpoint);
  const mediaUrl = extractMediaUrls(payload, kind)[0] || extractInlineMediaData(payload);
  if (mediaUrl) return { mediaUrl };
  const taskId = extractMediaTaskId(payload);
  if (!payload || (payload.code !== undefined && Number(payload.code) !== 200) || !taskId) {
    const error = new Error((payload && payload.msg) || 'The service did not return a task ID.');
    error.code = 'api-error';
    throw error;
  }
  return { taskId, pollUrl: extractPollUrl(payload) };
}

function extractTaskStatus(value, seen = new Set(), depth = 0) {
  if (depth > 6 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  for (const key of ['task_status', 'taskStatus', 'status', 'state']) {
    if (value[key] !== undefined && value[key] !== null) {
      const status = extractTaskStatus(value[key], seen, depth + 1);
      if (status) return status;
    }
  }
  for (const key of ['data', 'task_info', 'result']) {
    if (value[key] !== undefined) {
      const status = extractTaskStatus(value[key], seen, depth + 1);
      if (status) return status;
    }
  }
  return '';
}

function extractTaskErrorMessage(value, seen = new Set(), depth = 0) {
  if (depth > 7 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractTaskErrorMessage(item, seen, depth + 1);
      if (message) return message;
    }
    return '';
  }
  for (const key of [
    'task_status_msg', 'taskStatusMsg', 'error_message', 'errorMessage',
    'failure_reason', 'failureReason', 'video_generation_error',
    'message', 'msg', 'error'
  ]) {
    if (value[key] !== undefined && value[key] !== null) {
      const message = extractTaskErrorMessage(value[key], seen, depth + 1);
      if (message) return message;
    }
  }
  for (const key of ['data', 'detail', 'task_info', 'result', 'output']) {
    if (value[key] !== undefined) {
      const message = extractTaskErrorMessage(value[key], seen, depth + 1);
      if (message) return message;
    }
  }
  return '';
}

async function pollMediaTask(fetchImpl, config, taskId, signal, sleepImpl, context = {}) {
  const startedAt = Date.now();
  const sleep = sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const protocol = detectMediaProtocol(context.endpoint || (context.kind === 'video'
    ? config.videoEndpoint
    : config.imageEndpoint));
  const quickRouterQueryEndpoint = protocol === 'quickrouter-kling'
    ? resolveQuickRouterKlingEndpoint(
      context.endpoint || config.videoEndpoint,
      cleanPublicUrls(context.request && context.request.urls, 2).length > 0
    ).replace(/\/$/, '') + `/${encodeURIComponent(taskId)}`
    : '';
  const quickRouterUnifiedQueryEndpoint = protocol === 'quickrouter-unified-video'
    ? (context.pollUrl || resolveQuickRouterUnifiedVideoEndpoint(
      context.endpoint || config.videoEndpoint,
      'query',
      taskId
    ))
    : '';
  const openAiVideoQueryEndpoint = protocol === 'openai-videos' || protocol === 'openai-compatible'
    ? (context.pollUrl || `${resolveOpenAiVideosEndpoint(
      context.endpoint || config.videoEndpoint
    ).replace(/\/$/, '')}/${encodeURIComponent(taskId)}`)
    : '';
  const midjourneyQueryEndpoint = protocol === 'midjourney-imagine'
    ? (context.pollUrl || (() => {
      const url = new URL(context.endpoint || config.imageEndpoint);
      url.pathname = url.pathname.startsWith('/mj-turbo/')
        ? `/mj-turbo/task/${encodeURIComponent(taskId)}/fetch`
        : `/mj/task/${encodeURIComponent(taskId)}/fetch`;
      url.search = '';
      url.hash = '';
      return url.toString();
    })())
    : '';
  const legnextQueryEndpoint = protocol === 'legnext-midjourney'
    ? (context.pollUrl || (() => {
      const url = new URL(context.endpoint || config.imageEndpoint);
      url.pathname = `/api/v1/job/${encodeURIComponent(taskId)}`;
      url.search = '';
      url.hash = '';
      return url.toString();
    })())
    : '';

  while (Date.now() - startedAt < config.timeoutMs) {
    await sleep(config.pollIntervalMs);
    if (signal && signal.aborted) {
      const error = new Error('AI generation was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    const resultEndpoint = quickRouterQueryEndpoint ||
      quickRouterUnifiedQueryEndpoint ||
      openAiVideoQueryEndpoint ||
      midjourneyQueryEndpoint ||
      legnextQueryEndpoint ||
      context.pollUrl ||
      withQuery(config.resultEndpoint, { id: taskId });
    const response = await fetchImpl(resultEndpoint, {
      headers: midjourneyQueryEndpoint
        ? { 'mj-api-secret': formatMidjourneySecret(config.apiKey), Accept: 'application/json' }
        : legnextQueryEndpoint
        ? { Accept: 'application/json' }
        : protocol === 'quickrouter-kling' ||
        protocol === 'quickrouter-unified-video' ||
        openAiVideoQueryEndpoint ||
        context.pollUrl
        ? {
          Authorization: formatAuthorization(config.apiKey),
          Accept: 'application/json'
        }
        : { Authorization: formatAuthorization(config.apiKey), Accept: 'application/json' },
      signal
    });
    const payload = await readJsonResponse(response, 'Could not read the AI task result', resultEndpoint);
    if (
      payload &&
      payload.code !== undefined &&
      Number.isFinite(Number(payload.code)) &&
      Number(payload.code) !== 200 && !(protocol === 'ai302-kling-image' && Number(payload.code) === 0)
    ) {
      const error = new Error(payload.msg || 'The AI task failed.');
      error.code = 'api-error';
      throw error;
    }
    const data = payload && payload.data;
    const higgsfieldJobs = protocol.startsWith('higgsfield-') && Array.isArray(payload && payload.jobs)
      ? payload.jobs
      : null;
    if (higgsfieldJobs) {
      const statuses = higgsfieldJobs.map((job) => String(job && job.status || '').trim().toLowerCase());
      if (statuses.some((statusValue) => /^(?:failed?|failure|error|cancel(?:led|ed)|rejected|expired)$/.test(statusValue))) {
        const error = new Error(extractTaskErrorMessage(payload) || 'Higgsfield image generation failed.');
        error.code = 'generation-failed';
        error.taskId = taskId;
        throw error;
      }
      if (higgsfieldJobs.length && statuses.every((statusValue) => ['completed', 'succeeded', 'success'].includes(statusValue))) {
        const resultUrl = higgsfieldJobs
          .map((job) => job && job.results && job.results.raw && job.results.raw.url)
          .find((url) => /^https:\/\//i.test(String(url || '')));
        if (!resultUrl) {
          const error = new Error('Higgsfield completed the task without a downloadable image.');
          error.code = 'empty-media';
          throw error;
        }
        return resultUrl;
      }
    }
    const status = Number(
      data && data.status !== undefined
        ? data.status
        : payload && payload.status
    );
    const taskStatus = extractTaskStatus(payload);
    const failed = status === 3 ||
      /^(?:failed?|failure|error|cancel(?:led|ed)|rejected|timed?_?out)$/.test(taskStatus);
    if (failed) {
      const error = new Error(
        extractTaskErrorMessage(payload) ||
        'The AI task failed.'
      );
      error.code = 'generation-failed';
      error.taskId = taskId;
      error.taskStatus = taskStatus;
      throw error;
    }
    const urls = extractMediaUrls(payload, context.kind);
    const completed = status === 2 || /^(?:succeed(?:ed)?|success|completed?|done|finished)$/.test(taskStatus);
    if (completed || (Number.isNaN(status) && !taskStatus && urls.length)) {
      if (!urls.length) {
        if (openAiVideoQueryEndpoint) {
          return `${openAiVideoQueryEndpoint.replace(/\/$/, '')}/content`;
        }
        const error = new Error('The task completed but no downloadable media URL was returned.');
        error.code = 'empty-media';
        throw error;
      }
      return urls[0];
    }
  }
  const error = new Error('The AI generation request timed out. Please retry.');
  error.code = 'timeout';
  throw error;
}

async function downloadMedia(fetchImpl, mediaUrl, signal, config) {
  const maxDownloadBytes = Math.max(1, Number(config && config.maxDownloadBytes) || 512 * 1024 * 1024);
  if (/^data:(image|video)\//i.test(mediaUrl)) {
    const comma = mediaUrl.indexOf(',');
    if (comma === -1) throw new Error('Invalid generated media data.');
    const buffer = Buffer.from(mediaUrl.slice(comma + 1), 'base64');
    if (buffer.length > maxDownloadBytes) {
      throw Object.assign(new Error('The generated media exceeds the download size limit.'), { code: 'media-too-large' });
    }
    return buffer;
  }
  let headers;
  try {
    const media = new URL(mediaUrl);
    const endpoints = [config && config.imageEndpoint, config && config.videoEndpoint]
      .filter(Boolean)
      .map((endpoint) => new URL(endpoint));
    if (
      /\/videos\/[^/]+\/content\/?$/i.test(media.pathname) &&
      endpoints.some((endpoint) => endpoint.origin === media.origin)
    ) {
      headers = { Authorization: formatAuthorization(config.apiKey) };
    }
  } catch (err) {}
  const response = await fetchImpl(mediaUrl, { signal, ...(headers ? { headers } : {}) });
  if (!response.ok) {
    const error = new Error(`The media was generated, but the download failed (HTTP ${response.status}).`);
    error.code = 'media-download-failed';
    error.upstreamStatus = response.status;
    throw error;
  }
  const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (declaredLength > maxDownloadBytes) {
    throw Object.assign(new Error('The generated media exceeds the download size limit.'), { code: 'media-too-large' });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    const error = new Error('The downloaded media file is empty.');
    error.code = 'empty-media';
    throw error;
  }
  if (buffer.length > maxDownloadBytes) {
    throw Object.assign(new Error('The generated media exceeds the download size limit.'), { code: 'media-too-large' });
  }
  return buffer;
}

function isLikelyImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return (
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    buffer.toString('ascii', 0, 4) === 'GIF8' ||
    (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ||
    buffer.toString('ascii', 4, 12).includes('ftypavif')
  );
}

function isLikelyVideoBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  return (
    (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) ||
    buffer.toString('ascii', 4, 8) === 'ftyp'
  );
}

function generatedImageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 1;
        continue;
      }
      if (offset + 2 >= buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset + 1);
      if (startOfFrame.has(marker) && segmentLength >= 7 && offset + 7 < buffer.length) {
        const height = buffer.readUInt16BE(offset + 4);
        const width = buffer.readUInt16BE(offset + 6);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (segmentLength < 2) break;
      offset += segmentLength + 1;
    }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
  }
  return null;
}

function validateGeneratedImageResolution(buffer, requestedSize) {
  const resolution = String(requestedSize || '').trim().toUpperCase();
  const minimumLongEdge = resolution === '4K' ? 3072 : (resolution === '2K' ? 1536 : 0);
  if (!minimumLongEdge) return buffer;
  const dimensions = generatedImageDimensions(buffer);
  if (!dimensions) {
    const error = new Error(`Could not verify the generated ${resolution} image dimensions.`);
    error.code = 'image-resolution-unverified';
    throw error;
  }
  if (Math.max(dimensions.width, dimensions.height) < minimumLongEdge) {
    const error = new Error(
      `${resolution} was requested, but the provider returned ${dimensions.width}x${dimensions.height}. The result was rejected and will not be charged.`
    );
    error.code = 'image-resolution-mismatch';
    error.requestedResolution = resolution;
    error.actualWidth = dimensions.width;
    error.actualHeight = dimensions.height;
    throw error;
  }
  return buffer;
}

function validateGeneratedMediaBuffer(kind, buffer) {
  const valid = kind === 'video' ? isLikelyVideoBuffer(buffer) : isLikelyImageBuffer(buffer);
  if (valid) return buffer;
  const error = new Error('The provider returned an invalid image or video file. The damaged result was not saved.');
  error.code = 'invalid-media';
  throw error;
}

async function generateMediaBuffer(fetchImpl, rawConfig, kind, request, signal, sleepImpl) {
  const config = normalizeConfig(rawConfig);
  if (!config.apiKey) {
    const error = new Error('请先在设置中保存速创 API 接口密钥。');
    error.code = 'missing-api-key';
    throw error;
  }
  const submission = await submitMediaTask(fetchImpl, config, kind, request, signal);
  const taskId = typeof submission === 'string' ? submission : submission && submission.taskId;
  try {
    const mediaUrl = submission && submission.mediaUrl
      ? submission.mediaUrl
      : await pollMediaTask(fetchImpl, config, taskId, signal, sleepImpl, {
        kind,
        request,
        endpoint: kind === 'video' ? config.videoEndpoint : config.imageEndpoint,
        pollUrl: submission && submission.pollUrl
      });
    const buffer = validateGeneratedMediaBuffer(
      kind,
      await downloadMedia(fetchImpl, mediaUrl, signal, config)
    );
    if (
      kind === 'image' &&
      (
        (
          detectMediaProtocol(config.imageEndpoint) === 'ai302-nano-banana-v3' &&
          !/\/nano-banana-2-lite\//i.test(new URL(config.imageEndpoint).pathname)
        ) ||
        (detectMediaProtocol(config.imageEndpoint) === 'gemini-native' && isQuickRouterEndpoint(config.imageEndpoint)) ||
        isSeedreamModel(config.imageModel) ||
        detectMediaProtocol(config.imageEndpoint) === 'ai302-kling-image' ||
        detectMediaProtocol(config.imageEndpoint) === 'legnext-midjourney'
      )
    ) {
      return validateGeneratedImageResolution(buffer, request.size);
    }
    return buffer;
  } catch (error) {
    if (taskId && !error.taskId) error.taskId = taskId;
    throw error;
  }
}

module.exports = {
  DEFAULT_IMAGE_ENDPOINT,
  DEFAULT_VIDEO_ENDPOINT,
  DEFAULT_RESULT_ENDPOINT,
  IMAGE_SIZES,
  GPT_IMAGE_2_SIZES,
  GPT_IMAGE_2_RESOLUTION_AREAS,
  GPT_IMAGE_2_MAX_EDGE,
  GPT_IMAGE_2_MAX_PIXELS,
  GPT_IMAGE_2_QUALITIES,
  GPT_IMAGE_2_REFERENCE_MIME_TYPES,
  GPT_IMAGE_2_MAX_REFERENCE_BYTES,
  IMAGE_RATIOS,
  VIDEO_RATIOS,
  normalizeConfig,
  detectMediaProtocol,
  deriveKlingModel,
  resolveAi302KlingImageEndpoint,
  resolveQuickRouterKlingEndpoint,
  resolveQuickRouterUnifiedVideoEndpoint,
  resolveOpenAiImagesEndpoint,
  resolveOpenAiImageEditsEndpoint,
  resolveOpenAiChatMediaEndpoint,
  resolveOpenAiVideosEndpoint,
  extractMediaUrls,
  extractMediaTaskId,
  extractPollUrl,
  extractTaskStatus,
  extractTaskErrorMessage,
  buildRequestBody,
  buildQuickRouterKlingBody,
  buildAi302KlingImageBody,
  buildQuickRouterUnifiedVideoBody,
  buildOpenAiImageBody,
  buildOpenAiImageEditForm,
  buildOpenAiChatImageBody,
  buildOpenAiVideoBody,
  buildOpenAiVideoForm,
  seedreamImageSize,
  gptImage2Size,
  withMidjourneyAspectRatio,
  withLegnextMidjourneyParameters,
  buildGeminiImageBody,
  buildAi302NanoBananaBody,
  buildHiggsfieldSoulStandardBody,
  buildHiggsfieldSoulBody,
  resolveGeminiMediaEndpoint,
  resolveAi302NanoBananaEndpoint,
  resolveAi302NanoBananaPollEndpoint,
  submitMediaTask,
  pollMediaTask,
  generatedImageDimensions,
  validateGeneratedImageResolution,
  validateGeneratedMediaBuffer,
  generateMediaBuffer
};
