import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateMediaBuffer } = require('../../lib/ai-media-provider');
const { requestChat, discoverChatModels } = require('../../lib/ai-chat-provider');

const QUICKROUTER_BASE_URL = 'https://api.quickrouter.ai';
const DEFAULT_RESULT_ENDPOINT = `${QUICKROUTER_BASE_URL}/v1/videos`;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROVIDER_KEY_ENV = /^[A-Z][A-Z0-9_]{1,80}$/;
const MAX_PROVIDERS = 100;

function safeServerEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') return '';
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return '';
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function builtinProviders() {
  return [
    {
      id: 'image-1', kind: 'image', name: 'Nano Banana Pro',
      endpoint: `${QUICKROUTER_BASE_URL}/v1beta/models/gemini-3-pro-image:generateContent`,
      resultEndpoint: DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'image-2', kind: 'image', name: 'Nano Banana ProSE',
      endpoint: `${QUICKROUTER_BASE_URL}/v1beta/models/gemini-3-pro-image-preview:generateContent`,
      resultEndpoint: DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'image-3', kind: 'image', name: 'Seedream5.0lite',
      endpoint: `${QUICKROUTER_BASE_URL}/v1/images/generations?model=seedream-5.0-lite`,
      resultEndpoint: DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'video-1', kind: 'video', name: 'QuickRouter Sora 2',
      endpoint: process.env.QUICKROUTER_VIDEO_ENDPOINT || `${QUICKROUTER_BASE_URL}/v1/videos?model=sora-2`,
      resultEndpoint: DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'video-2', kind: 'video', name: 'QuickRouter Veo 3.1 Fast',
      endpoint: `${QUICKROUTER_BASE_URL}/v1/video/create?model=veo3.1-fast`,
      resultEndpoint: `${QUICKROUTER_BASE_URL}/v1/video/query`,
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'video-3', kind: 'video', name: 'MiniMax-H3',
      endpoint: 'https://api.minimaxi.com/v2/video_generation',
      resultEndpoint: 'https://api.minimaxi.com/v2/query/video_generation',
      protocol: 'minimax-video-v2',
      capabilities: { resolutions: ['768P', '2K'], durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
      keyEnv: 'MINIMAX_API_KEY'
    },
    {
      id: 'chat-1', kind: 'chat', name: 'Gemini 3 Pro Preview',
      endpoint: `${QUICKROUTER_BASE_URL}/v1beta/models/gemini-3-pro-preview:generateContent`,
      models: ['gemini-3-pro-preview'],
      keyEnv: 'QUICKROUTER_API_KEY'
    },
    {
      id: 'chat-2', kind: 'chat', name: 'DeepSeek V4 Pro',
      endpoint: `${QUICKROUTER_BASE_URL}/v1/chat/completions?model=deepseek-v4-pro`,
      models: ['deepseek-v4-pro'],
      keyEnv: 'QUICKROUTER_API_KEY'
    }
  ];
}

function configuredProviders() {
  let extra = [];
  try {
    const parsed = JSON.parse(process.env.AI_PROVIDERS_JSON || '[]');
    if (Array.isArray(parsed)) extra = parsed;
  } catch (error) {
    throw new Error('AI_PROVIDERS_JSON is not valid JSON.');
  }
  const byId = new Map();
  for (const raw of [...builtinProviders(), ...extra].slice(0, MAX_PROVIDERS)) {
    const id = String(raw.id || '').trim().toLowerCase();
    const kind = ['chat', 'image', 'video'].includes(raw.kind) ? raw.kind : '';
    const endpoint = safeServerEndpoint(raw.endpoint);
    const keyEnv = String(raw.keyEnv || '').trim();
    if (!PROVIDER_ID.test(id) || !kind || !endpoint || !PROVIDER_KEY_ENV.test(keyEnv)) continue;
    byId.set(id, {
      id, kind,
      name: String(raw.name || id).trim().slice(0, 80),
      endpoint,
      resultEndpoint: safeServerEndpoint(raw.resultEndpoint) || DEFAULT_RESULT_ENDPOINT,
      models: Array.isArray(raw.models) ? raw.models.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 30) : [],
      protocol: String(raw.protocol || '').trim().slice(0, 40),
      capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : null,
      keyEnv
    });
  }
  return [...byId.values()];
}

function providerApiKey(provider) {
  const direct = String(process.env[provider.keyEnv] || '').trim();
  if (direct) return direct;
  if (provider.keyEnv === 'QUICKROUTER_API_KEY') {
    return String(process.env.QUICK_API_KEY || process.env.Quick_API_KEY || '').trim();
  }
  return '';
}

export function publicProviderConfig() {
  const providers = configuredProviders().filter((provider) => Boolean(providerApiKey(provider)));
  return {
    providers: providers.map(({ keyEnv, endpoint, resultEndpoint, ...provider }) => provider)
  };
}

function providerFor(kind, id) {
  const candidates = configuredProviders().filter((provider) => provider.kind === kind);
  const requestedId = String(id || '').trim().toLowerCase();
  const selected = requestedId
    ? candidates.find((provider) => provider.id === requestedId)
    : candidates[0];
  if (!selected) throw Object.assign(new Error(`No ${kind} provider is configured.`), { code: 'provider-not-configured' });
  const apiKey = providerApiKey(selected);
  if (!apiKey) throw Object.assign(new Error(`The server secret ${selected.keyEnv} is missing.`), { code: 'provider-secret-missing' });
  return { ...selected, apiKey };
}

export async function generateMedia(kind, body, signal) {
  const provider = providerFor(kind, String(body.providerId || ''));
  if (kind === 'video' && provider.protocol === 'minimax-video-v2') {
    return generateMiniMaxVideo(provider, body, signal);
  }
  const config = {
    apiKey: provider.apiKey,
    resultEndpoint: provider.resultEndpoint,
    imageEndpoint: kind === 'image' ? provider.endpoint : undefined,
    videoEndpoint: kind === 'video' ? provider.endpoint : undefined,
    maxDownloadBytes: kind === 'video' ? 256 * 1024 * 1024 : 64 * 1024 * 1024,
    timeoutMs: 20 * 60_000,
    pollIntervalMs: 2_000
  };
  return generateMediaBuffer(fetch, config, kind, body, signal);
}

async function responseJson(response) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (error) {}
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message || payload.message || `MiniMax request failed (HTTP ${response.status}).`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return payload;
}

function delayWithSignal(ms, signal) {
  if (signal && signal.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new Error('Aborted'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}

async function generateMiniMaxVideo(provider, body, signal) {
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean).slice(0, 2) : [];
  const ratio = urls.length ? 'adaptive' : (provider.capabilities.ratios.includes(body.aspectRatio) ? body.aspectRatio : '16:9');
  const resolution = provider.capabilities.resolutions.includes(body.resolution) ? body.resolution : '768P';
  const duration = Math.max(4, Math.min(15, Math.round(Number(body.duration) || 6)));
  const content = [{ type: 'text', text: String(body.prompt || '').trim() }];
  urls.forEach((url, index) => content.push({
    type: 'image_url',
    image_url: { url: String(url) },
    role: index === 0 ? 'first_frame' : 'last_frame'
  }));
  const headers = { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' };
  const created = await responseJson(await fetch(provider.endpoint, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ model: 'MiniMax-H3', content, resolution, duration, ratio, aigc_watermark: false })
  }));
  const taskId = String(created.task_id || '');
  if (!taskId) throw new Error('MiniMax did not return a task ID.');
  const deadline = Date.now() + 20 * 60_000;
  let mediaUrl = '';
  while (Date.now() < deadline) {
    await delayWithSignal(2_000, signal);
    const result = await responseJson(await fetch(`${provider.resultEndpoint}/${encodeURIComponent(taskId)}`, { headers: { Authorization: headers.Authorization }, signal }));
    const task = result && result.task || {};
    const status = String(task.status || '').toLowerCase();
    if (status === 'succeeded') { mediaUrl = String(task.content && task.content.url || ''); break; }
    if (['failed', 'cancelled'].includes(status)) throw new Error(`MiniMax video generation ${status}.`);
  }
  if (!mediaUrl) throw new Error('MiniMax video generation timed out.');
  const download = await fetch(mediaUrl, { signal });
  if (!download.ok) throw Object.assign(new Error(`Could not download MiniMax video (HTTP ${download.status}).`), { status: download.status });
  const length = Number(download.headers.get('content-length')) || 0;
  if (length > 256 * 1024 * 1024) throw Object.assign(new Error('MiniMax video is too large.'), { status: 413 });
  return Buffer.from(await download.arrayBuffer());
}

export async function chat(body, signal) {
  const provider = providerFor('chat', String(body.providerId || ''));
  const requestedModel = String(body.model || '').trim();
  const model = provider.models.includes(requestedModel) ? requestedModel : provider.models[0];
  return requestChat(fetch, {
    apiKey: provider.apiKey,
    chatEndpoint: provider.endpoint,
    chatProviderName: provider.name,
    chatModel: model || requestedModel
  }, { prompt: body.prompt, messages: body.messages }, signal);
}

export async function models(providerId) {
  const provider = providerFor('chat', String(providerId || ''));
  const result = await discoverChatModels(fetch, provider.endpoint, provider.apiKey);
  return { ...result, providerId: provider.id };
}
