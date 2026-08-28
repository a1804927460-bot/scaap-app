import net from 'node:net';

export const AI302_PRIMARY_ROUTE_ID = 'primary';
export const AI302_PRIMARY_BASE_URL = 'https://api.302.ai';

const ROUTE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
const KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;
const MAX_BACKUP_ROUTES = 8;

function routeError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeSecret(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 169 && parts[1] === 254
      || parts[0] === 192 && parts[1] === 168
      || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  if (ipVersion === 6) {
    return host === '::1'
      || host === '::'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe8')
      || host.startsWith('fe9')
      || host.startsWith('fea')
      || host.startsWith('feb');
  }
  return false;
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (isPrivateHost(url.hostname)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getAi302BackupRoutes() {
  const raw = String(process.env.AI302_BACKUP_ROUTES_JSON || '').trim();
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set([AI302_PRIMARY_ROUTE_ID]);
  const routes = [];
  for (const entry of parsed.slice(0, MAX_BACKUP_ROUTES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = String(entry.id || '').trim().toLowerCase();
    const baseUrl = normalizeBaseUrl(entry.baseUrl);
    const keyEnv = String(entry.keyEnv || '').trim();
    const apiKey = normalizeSecret(process.env[keyEnv]);
    if (!ROUTE_ID_PATTERN.test(id) || seen.has(id) || !baseUrl
        || !KEY_ENV_PATTERN.test(keyEnv) || !apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) {
      continue;
    }
    seen.add(id);
    routes.push(Object.freeze({ id, baseUrl, apiKey }));
  }
  return routes;
}

function primaryRoute(apiKey) {
  const normalizedKey = normalizeSecret(apiKey);
  if (!normalizedKey || normalizedKey.length > 4096 || /[\r\n]/.test(normalizedKey)) {
    throw routeError('ai302-not-configured', 'The tool gateway is not configured.');
  }
  return Object.freeze({
    id: AI302_PRIMARY_ROUTE_ID,
    baseUrl: AI302_PRIMARY_BASE_URL,
    apiKey: normalizedKey
  });
}

export function getAi302Routes({ apiKey, routeId = '' } = {}) {
  const primary = primaryRoute(apiKey);
  const routes = [primary, ...getAi302BackupRoutes()];
  const requestedId = String(routeId || '').trim().toLowerCase();
  if (!requestedId) return routes;
  const selected = routes.find((route) => route.id === requestedId);
  if (!selected) {
    throw routeError('ai302-route-unavailable', 'The accepted tool task route is no longer available.');
  }
  return [selected];
}

export function ai302RouteUrl(route, path) {
  const baseUrl = route && route.baseUrl ? route.baseUrl : AI302_PRIMARY_BASE_URL;
  const suffix = String(path || '').trim();
  if (!suffix.startsWith('/')) throw routeError('ai302-route-unavailable', 'The tool route path is invalid.');
  return `${baseUrl}${suffix}`;
}

export function hasSafeFallbackStatus(status) {
  return [402, 425, 429].includes(Number(status));
}
