import http from 'node:http';
import crypto from 'node:crypto';
import { authenticate } from './auth.js';
import { catalogVersion, chat, generateMedia, models, publicProviderConfig } from './providers.js';
import { reserveUsage, settleUsage } from './usage.js';

const port = Math.max(1, Number(process.env.PORT) || 3000);
const maxBodyBytes = 70 * 1024 * 1024;
const rateBuckets = new Map();
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:ghp|github_pat|glpat|xox[baprs])-[_A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:postgres|postgresql|mysql):\/\/[^\s:/]+:[^\s@]+@/i,
  /\bservice_role\b/i
];

function send(response, status, payload, headers = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': Buffer.isBuffer(payload) ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...headers
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413, code: 'body-too-large' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400, code: 'invalid-json' }); }
}

function rateAllowed(userId, ip) {
  const key = `${userId}:${ip}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= Math.max(1, Number(process.env.REQUESTS_PER_MINUTE) || 30);
}

function validateBody(body, kind) {
  const prompt = String(body.prompt || '').trim();
  if (!prompt || prompt.length > 12_000) throw Object.assign(new Error('Prompt must contain 1 to 12000 characters.'), { status: 400, code: 'invalid-prompt' });
  if (secretPatterns.some((pattern) => pattern.test(prompt))) {
    throw Object.assign(new Error('The request appears to contain a private credential.'), { status: 400, code: 'privacy-blocked' });
  }
  const messages = kind === 'chat' && Array.isArray(body.messages)
    ? body.messages.slice(-40).map((m) => ({
        role: ['assistant', 'system'].includes(m.role) ? m.role : 'user',
        content: String(m.content || '').slice(0, 24_000),
        images: Array.isArray(m.images) ? m.images.slice(0, 4).filter((url) => /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(String(url))) : []
      }))
    : [];
  if (messages.some((message) => secretPatterns.some((pattern) => pattern.test(message.content)))) {
    throw Object.assign(new Error('The conversation appears to contain a private credential.'), { status: 400, code: 'privacy-blocked' });
  }
  const urls = Array.isArray(body.urls) ? body.urls.slice(0, 14) : [];
  let encodedBytes = 0;
  for (const value of urls) {
    const url = String(value || '');
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) {
      encodedBytes += Math.ceil(url.length * 0.75);
    } else if (!/^https:\/\//i.test(url)) {
      throw Object.assign(new Error('Reference images must be sanitized data URLs or HTTPS URLs.'), { status: 400, code: 'unsafe-reference' });
    }
  }
  if (encodedBytes > 50 * 1024 * 1024) throw Object.assign(new Error('Reference images exceed the upstream request limit.'), { status: 413, code: 'attachments-too-large' });
  return {
    prompt,
    providerId: String(body.providerId || '').slice(0, 64),
    model: String(body.model || '').slice(0, 160),
    messages,
    urls,
    size: ['1K', '2K', '4K', 'original'].includes(body.size) ? body.size : '1K',
    resolution: ['768P', '2K'].includes(body.resolution) ? body.resolution : '768P',
    aspectRatio: String(body.aspectRatio || 'auto').slice(0, 16),
    duration: Math.max(1, Math.min(30, Number(body.duration) || 6)),
    sourceWidth: Math.max(0, Math.min(16384, Number(body.sourceWidth) || 0)),
    sourceHeight: Math.max(0, Math.min(16384, Number(body.sourceHeight) || 0))
  };
}

async function handle(request, response) {
  const requestId = crypto.randomUUID();
  response.setHeader('X-Request-Id', requestId);
  const url = new URL(request.url, 'http://gateway.local');
  if (request.method === 'GET' && url.pathname === '/healthz') return send(response, 200, { ok: true, catalogVersion });
  const origin = String(request.headers.origin || '');
  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { code: 'origin-denied', message: 'Browser origin is not allowed.' });

  const user = await authenticate(request);
  if (!user) return send(response, 401, { code: 'invalid-session', message: 'A valid Supabase session is required.' });
  const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
  if (!rateAllowed(user.id, ip)) return send(response, 429, { code: 'rate-limited', message: 'Too many requests. Please wait before trying again.' }, { 'Retry-After': '60' });

  if (request.method === 'GET' && url.pathname === '/v1/config') return send(response, 200, publicProviderConfig());
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    return send(response, 200, await models(url.searchParams.get('providerId')));
  }

  let kind;
  if (request.method === 'POST' && url.pathname === '/v1/chat') kind = 'chat';
  if (request.method === 'POST' && url.pathname === '/v1/media/image') kind = 'image';
  if (request.method === 'POST' && url.pathname === '/v1/media/video') kind = 'video';
  if (!kind) return send(response, 404, { code: 'not-found', message: 'Route not found.' });

  const body = validateBody(await readJson(request), kind);
  const reserved = await reserveUsage(user.id, kind, requestId);
  if (!reserved) return send(response, 402, { code: 'quota-exceeded', message: 'Your daily AI quota has been reached.' });
  const startedAt = Date.now();
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    if (kind === 'chat') {
      const text = await chat(body, controller.signal);
      await settleUsage(requestId, 'succeeded', Date.now() - startedAt);
      return send(response, 200, { text });
    }
    const media = await generateMedia(kind, body, controller.signal);
    await settleUsage(requestId, 'succeeded', Date.now() - startedAt);
    return send(response, 200, media, {
      'Content-Type': kind === 'video' ? 'video/mp4' : 'application/octet-stream'
    });
  } catch (error) {
    await settleUsage(requestId, 'failed', Date.now() - startedAt);
    throw error;
  }
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    const status = Number(error.status) || (error.name === 'AbortError' ? 499 : 500);
    const code = String(error.code || (status >= 500 ? 'gateway-error' : 'bad-request'));
    const safeMessages = {
      'quota-not-configured': 'AI quota service is not configured.',
      'quota-service-failed': 'AI quota check is temporarily unavailable.',
      'provider-not-configured': 'The selected AI model is not configured on the server.',
      'provider-secret-missing': 'The selected AI model is missing its server credential.'
    };
    // Do not log prompts, attachments, authorization headers, or upstream bodies.
    console.error(JSON.stringify({ level: 'error', requestId: response.getHeader('X-Request-Id'), code, status }));
    if (!response.headersSent) send(response, status, {
      code,
      message: safeMessages[code] || (status >= 500 ? 'The AI gateway could not complete this request.' : error.message)
    });
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 5 * 60_000).unref();

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', event: 'gateway-ready', port }));
});
