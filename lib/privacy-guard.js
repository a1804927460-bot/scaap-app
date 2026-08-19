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
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 14));
  const maximumBytes = Math.max(1, Math.min(64 * 1024 * 1024, Number(options.maxReferenceBytes) || 20 * 1024 * 1024));
  let totalBytes = 0;
  return urls.slice(0, limit).map((value) => {
    const url = String(value || '').trim();
    if (/^https:\/\//i.test(url)) return url;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
    if (!match) throw privacyError('Only sanitized image attachments or HTTPS reference URLs may be sent to AI.', 'unsafe-attachment-url');
    totalBytes += Math.ceil(match[2].length * 0.75);
    if (totalBytes > maximumBytes) {
      throw privacyError(`AI attachments exceed the ${Math.round(maximumBytes / (1024 * 1024))} MB privacy and upload limit.`, 'attachment-too-large');
    }
    return url;
  });
}

function validateAiAttachments(attachments, options = {}) {
  if (!Array.isArray(attachments)) return [];
  const limit = Math.max(1, Math.min(8, Number(options.limit) || 8));
  let totalCharacters = 0;
  return attachments.slice(0, limit).map((attachment) => {
    const name = path.basename(String(attachment && attachment.name || 'attachment')).slice(0, 120);
    const mimeType = String(attachment && attachment.mimeType || 'application/octet-stream').slice(0, 120);
    const kind = ['text', 'document', 'pdf', 'file', 'video', 'audio'].includes(attachment && attachment.kind)
      ? attachment.kind
      : 'file';
    const remaining = Math.max(0, 96_000 - totalCharacters);
    const content = String(attachment && attachment.content || '').slice(0, Math.min(48_000, remaining));
    totalCharacters += content.length;
    assertPromptHasNoSecrets(content);
    return {
      name,
      mimeType,
      kind,
      sizeBytes: Math.max(0, Number(attachment && attachment.sizeBytes) || 0),
      readable: attachment && attachment.readable === true,
      truncated: attachment && attachment.truncated === true,
      content
    };
  });
}

function sanitizeAiRequest(request, options = {}) {
  const prompt = String(request && request.prompt || '').trim().slice(0, 12_000);
  assertPromptHasNoSecrets(prompt);
  const messages = Array.isArray(request && request.messages)
    ? request.messages.slice(-40).map((message) => ({
        role: ['assistant', 'system'].includes(message && message.role) ? message.role : 'user',
        content: String(message && message.content || '').slice(0, 24_000),
        images: validateAiUrls(message && message.images, { limit: 4 }),
        attachments: validateAiAttachments(message && message.attachments, { limit: 8 })
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
  validateAiAttachments,
  validateAiUrls
};
