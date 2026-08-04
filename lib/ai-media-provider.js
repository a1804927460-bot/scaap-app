'use strict';

const DEFAULT_IMAGE_ENDPOINT = 'https://api.quickrouter.ai/v1beta/models/gemini-3-pro-image:generateContent';
const DEFAULT_VIDEO_ENDPOINT = 'https://api.quickrouter.ai/v1/videos?model=sora-2';
const DEFAULT_RESULT_ENDPOINT = 'https://api.quickrouter.ai/v1/videos';
const IMAGE_SIZES = new Set(['1K', '2K', '4K']);
const IMAGE_RATIOS = new Set([
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4',
  '3:2', '2:3', '5:4', '4:5', '21:9'
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
    videoEndpoint: normalizeEndpoint(config.videoEndpoint, DEFAULT_VIDEO_ENDPOINT),
    resultEndpoint: normalizeEndpoint(config.resultEndpoint, DEFAULT_RESULT_ENDPOINT),
    apiKey: String(config.apiKey || '').trim(),
    imageSize: IMAGE_SIZES.has(config.imageSize) ? config.imageSize : '1K',
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

function detectMediaProtocol(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || '').trim());
  } catch (err) {
    return 'generic-async';
  }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (/\/mj\/submit\/imagine\/?$/.test(pathname)) {
    return 'midjourney-imagine';
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

function buildOpenAiImageBody(request, config) {
  return {
    model: String(config.imageModel || '').trim() || endpointModel(config.imageEndpoint, 'gpt-image-1'),
    prompt: String(request.prompt || '').trim(),
    n: 1,
    size: closestOpenAiImageSize(request)
  };
}

function buildOpenAiImageEditForm(request, config) {
  const form = new FormData();
  form.append('model', endpointModel(config.imageEndpoint, 'gpt-image-1'));
  form.append('prompt', String(request.prompt || '').trim());
  form.append('n', '1');
  form.append('size', closestOpenAiImageSize(request));
  const images = cleanPublicUrls(request.urls, 14)
    .map((value) => {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
      if (!match) return null;
      const extension = match[1].split('/')[1].replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
      return {
        blob: new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }),
        name: `reference.${extension}`
      };
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

function dataUrlImageFile(value, fallbackName = 'reference') {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  const extension = match[1].split('/')[1]
    .replace('jpeg', 'jpg')
    .replace(/[^a-z0-9]/gi, '') || 'png';
  return {
    blob: new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }),
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
    ...(IMAGE_SIZES.has(request.size)
      ? (isQuickRouterEndpoint(endpoint)
        ? { clarity: request.size }
        : { imageSize: request.size })
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
  if (kind === 'image' && protocol === 'midjourney-imagine') {
    return {
      botType: 'MID_JOURNEY',
      prompt,
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
  for (const key of ['task_id', 'taskId', 'id']) {
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
  if (kind === 'image' && protocol === 'midjourney-imagine') {
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
    const payload = await readJsonResponse(response, 'Midjourney request failed', endpoint);
    const taskId = String(payload && payload.result || '').trim();
    if (Number(payload && payload.code) !== 1 || !taskId) {
      const error = new Error(payload && payload.description || 'Midjourney did not return a task ID.');
      error.code = 'api-error';
      throw error;
    }
    const pollUrl = new URL(endpoint);
    pollUrl.pathname = `/mj/task/${encodeURIComponent(taskId)}/fetch`;
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
    const officialGemini = new URL(submitEndpoint).hostname.toLowerCase() === 'generativelanguage.googleapis.com';
    const response = await fetchImpl(officialGemini
      ? withQuery(submitEndpoint, { key: config.apiKey })
      : submitEndpoint, {
      method: 'POST',
      headers: {
        Authorization: formatAuthorization(config.apiKey),
        'x-goog-api-key': config.apiKey,
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
      url.pathname = `/mj/task/${encodeURIComponent(taskId)}/fetch`;
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
      context.pollUrl ||
      withQuery(config.resultEndpoint, { id: taskId });
    const response = await fetchImpl(resultEndpoint, {
      headers: protocol === 'quickrouter-kling' ||
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
      Number(payload.code) !== 200
    ) {
      const error = new Error(payload.msg || 'The AI task failed.');
      error.code = 'api-error';
      throw error;
    }
    const data = payload && payload.data;
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

function validateGeneratedMediaBuffer(kind, buffer) {
  const valid = kind === 'video' ? isLikelyVideoBuffer(buffer) : isLikelyImageBuffer(buffer);
  if (valid) return buffer;
  const error = new Error('接口返回的文件不是有效的图片或视频，已阻止损坏文件写入归档。');
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
    const buffer = await downloadMedia(fetchImpl, mediaUrl, signal, config);
    return validateGeneratedMediaBuffer(kind, buffer);
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
  IMAGE_RATIOS,
  VIDEO_RATIOS,
  normalizeConfig,
  detectMediaProtocol,
  deriveKlingModel,
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
  buildQuickRouterUnifiedVideoBody,
  buildOpenAiImageBody,
  buildOpenAiImageEditForm,
  buildOpenAiChatImageBody,
  buildOpenAiVideoBody,
  buildOpenAiVideoForm,
  buildGeminiImageBody,
  resolveGeminiMediaEndpoint,
  submitMediaTask,
  pollMediaTask,
  validateGeneratedMediaBuffer,
  generateMediaBuffer
};
