const PROVIDER_AUTH_STATUSES = new Set([401, 403]);
const USER_AUTH_CODES = new Set(['invalid-session', 'auth-required']);
const PROVIDER_ERROR_CODES = new Set(['api-error', 'provider-request-failed']);
const SUPPLIER_NAME_RE = /\b(?:api\.atlascloud\.ai|atlas\s*cloud|atlascloud|302(?:\.ai)?|ai302|quick\s*router|topaz(?:\s+labs)?|higgsfield|google|gemini|kling|jimeng|dreamina|minimax)\b/gi;

export function sanitizePublicGatewayMessage(value) {
  return String(value || '')
    .replace(SUPPLIER_NAME_RE, 'AI service')
    .replace(/\bAI service(?:\s+AI service)+\b/gi, 'AI service')
    .replace(/\b(?:the\s+)?AI service\s+tool service\b/gi, 'The AI tool service')
    .replace(/\bAI service\s+API\b/gi, 'AI service')
    .replace(/\ba\s+AI\b/g, 'an AI')
    .replace(/\s*\(?HTTP\s+\d{3}\)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function publicGatewayError(error) {
  const timeout = error && (
    error.name === 'TimeoutError'
    || Number(error.code) === 23
    || String(error.code || '').toUpperCase() === 'ETIMEDOUT'
  );
  const aborted = !timeout && error && error.name === 'AbortError';
  const originalStatus = timeout
    ? 504
    : aborted
      ? 503
      : Number(error && error.status) || 500;
  const originalCode = timeout
    ? 'provider-timeout'
    : aborted
      ? 'provider-temporarily-unavailable'
    : String(error && error.code || (originalStatus >= 500 ? 'gateway-error' : 'bad-request'));
  const providerAuthFailed = PROVIDER_AUTH_STATUSES.has(originalStatus)
    && PROVIDER_ERROR_CODES.has(originalCode)
    && !USER_AUTH_CODES.has(originalCode);
  if (providerAuthFailed) {
    return {
      status: 502,
      code: 'provider-auth-failed',
      message: 'The selected AI service rejected its server credential.'
    };
  }
  return {
    status: originalStatus,
    code: originalCode,
    message: sanitizePublicGatewayMessage(timeout
      ? 'The selected AI service timed out while accepting the task.'
      : aborted
        ? 'The selected AI service connection was interrupted. Please retry shortly.'
        : String(error && error.message || ''))
  };
}
