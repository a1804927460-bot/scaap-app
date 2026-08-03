'use strict';

const path = require('path');

const BLOCKED_FILE_NAMES = new Set([
  '.env', '.npmrc', '.pypirc', 'wallet.dat', 'login data', 'local state',
  'cookies', 'credentials', 'credentials.json', 'secrets.json', 'known_hosts',
  'authorized_keys', 'id_rsa', 'id_ed25519'
]);
const BLOCKED_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.kdbx', '.ovpn', '.rdp', '.ppk'
]);
const BLOCKED_SEGMENTS = new Set([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
  'password managers', 'browser profiles'
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:ghp|github_pat|glpat|xox[baprs])-[_A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:postgres|postgresql|mysql):\/\/[^\s:/]+:[^\s@]+@/i,
  /\bservice_role\b/i
];

function privacyError(message, reason) {
  const error = new Error(message);
  error.code = 'privacy-blocked';
  error.reason = reason;
  return error;
}

function classifyLocalFile(file) {
  const name = String(file && file.name || '').trim();
  const originalPath = String(file && file.originalPath || '');
  const storedPath = String(file && file.storedPath || '');
  const normalizedName = name.toLowerCase();
  const ext = path.extname(normalizedName);
  if (normalizedName.startsWith('.env') || BLOCKED_FILE_NAMES.has(normalizedName)) {
    return { safe: false, reason: 'sensitive-filename' };
  }
  if (BLOCKED_EXTENSIONS.has(ext)) return { safe: false, reason: 'sensitive-extension' };
  const segments = `${originalPath}\n${storedPath}`.replace(/\\/g, '/').toLowerCase().split('/');
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
    return { safe: false, reason: 'sensitive-location' };
  }
  return { safe: true, reason: null };
}

function assertSafeLocalFile(file) {
  const result = classifyLocalFile(file);
  if (!result.safe) {
    throw privacyError('This file was blocked because it appears to contain private credentials or account data.', result.reason);
  }
  return true;
}

function assertPromptHasNoSecrets(value) {
  const text = String(value || '');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    throw privacyError('The request appears to contain a private key, service credential, or password-bearing connection string.', 'secret-in-text');
  }
}

function validateAiUrls(urls, options = {}) {
  if (!Array.isArray(urls)) return [];
  const limit = Math.max(1, Math.min(14, Number(options.limit) || 14));
  let totalBytes = 0;
  return urls.slice(0, limit).map((value) => {
    const url = String(value || '').trim();
    if (/^https:\/\//i.test(url)) return url;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
    if (!match) throw privacyError('Only sanitized image attachments or HTTPS reference URLs may be sent to AI.', 'unsafe-attachment-url');
    totalBytes += Math.ceil(match[2].length * 0.75);
    if (totalBytes > 20 * 1024 * 1024) {
      throw privacyError('AI attachments exceed the 20 MB privacy and upload limit.', 'attachment-too-large');
    }
    return url;
  });
}

function sanitizeAiRequest(request, options = {}) {
  const prompt = String(request && request.prompt || '').trim().slice(0, 12_000);
  assertPromptHasNoSecrets(prompt);
  const messages = Array.isArray(request && request.messages)
    ? request.messages.slice(-40).map((message) => ({
        role: ['assistant', 'system'].includes(message && message.role) ? message.role : 'user',
        content: String(message && message.content || '').slice(0, 24_000),
        images: validateAiUrls(message && message.images, { limit: 4 })
      }))
    : [];
  messages.forEach((message) => assertPromptHasNoSecrets(message.content));
  return {
    ...request,
    prompt,
    messages,
    urls: validateAiUrls(request && request.urls, options)
  };
}

module.exports = {
  assertSafeLocalFile,
  assertPromptHasNoSecrets,
  classifyLocalFile,
  sanitizeAiRequest,
  validateAiUrls
};
