import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateMediaBuffer } = require('../../lib/wuyin-media-provider');
const { requestChat, discoverChatModels } = require('../../lib/wuyin-chat-provider');

const DEFAULT_RESULT_ENDPOINT = 'https://api.wuyinkeji.com/api/async/detail';
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
      endpoint: process.env.WUYIN_IMAGE_ENDPOINT || 'https://api.wuyinkeji.com/api/async/image_nanoBanana_pro',
      resultEndpoint: process.env.WUYIN_RESULT_ENDPOINT || DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'WUYIN_API_KEY'
    },
    {
      id: 'video-1', kind: 'video', name: 'Grok Imagine',
      endpoint: process.env.WUYIN_VIDEO_ENDPOINT || 'https://api.wuyinkeji.com/api/async/video_grok_imagine',
      resultEndpoint: process.env.WUYIN_RESULT_ENDPOINT || DEFAULT_RESULT_ENDPOINT,
      keyEnv: 'WUYIN_API_KEY'
    },
    {
      id: 'chat-1', kind: 'chat', name: process.env.CHAT_PROVIDER_NAME || 'Messs AI',
      endpoint: process.env.CHAT_API_ENDPOINT || '',
      models: String(process.env.CHAT_MODELS || 'gpt-4o-mini').split(',').map((value) => value.trim()).filter(Boolean),
      keyEnv: 'CHAT_API_KEY'
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
  for (const raw of [...builtinProviders(), ...extra]) {
    const id = String(raw.id || '').trim().toLowerCase();
    const kind = ['chat', 'image', 'video'].includes(raw.kind) ? raw.kind : '';
    const endpoint = safeServerEndpoint(raw.endpoint);
    const keyEnv = String(raw.keyEnv || '').trim();
    if (!PROVIDER_ID.test(id) || !kind || !endpoint || !/^[A-Z][A-Z0-9_]{1,80}$/.test(keyEnv)) continue;
    byId.set(id, {
      id, kind,
      name: String(raw.name || id).trim().slice(0, 80),
      endpoint,
      resultEndpoint: safeServerEndpoint(raw.resultEndpoint) || DEFAULT_RESULT_ENDPOINT,
      models: Array.isArray(raw.models) ? raw.models.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 30) : [],
      keyEnv
    });
  }
  return [...byId.values()];
}

export function publicProviderConfig() {
  const providers = configuredProviders().filter((provider) => Boolean(process.env[provider.keyEnv]));
  return {
    providers: providers.map(({ keyEnv, endpoint, resultEndpoint, ...provider }) => provider)
  };
}

function providerFor(kind, id) {
  const candidates = configuredProviders().filter((provider) => provider.kind === kind);
  const selected = candidates.find((provider) => provider.id === id) || candidates[0];
  if (!selected) throw Object.assign(new Error(`No ${kind} provider is configured.`), { code: 'provider-not-configured' });
  const apiKey = String(process.env[selected.keyEnv] || '').trim();
  if (!apiKey) throw Object.assign(new Error(`The server secret ${selected.keyEnv} is missing.`), { code: 'provider-secret-missing' });
  return { ...selected, apiKey };
}

export async function generateMedia(kind, body, signal) {
  const provider = providerFor(kind, String(body.providerId || ''));
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
