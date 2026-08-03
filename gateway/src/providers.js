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
      id: 'image-1', kind: 'image', name: 'QuickRouter GPT Image',
      endpoint: process.env.QUICKROUTER_IMAGE_ENDPOINT || `${QUICKROUTER_BASE_URL}/v1/images/generations?model=gpt-image-1`,
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
      id: 'chat-1', kind: 'chat', name: process.env.QUICKROUTER_CHAT_NAME || 'QuickRouter Chat',
      endpoint: process.env.QUICKROUTER_CHAT_ENDPOINT || `${QUICKROUTER_BASE_URL}/v1`,
      models: String(process.env.QUICKROUTER_CHAT_MODELS || 'gemini-2.5-pro,gemini-2.5-flash,deepseek-chat').split(',').map((value) => value.trim()).filter(Boolean),
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
