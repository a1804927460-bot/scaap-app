const PROVIDER_AUTH_STATUSES = new Set([401, 403]);
const USER_AUTH_CODES = new Set(['invalid-session', 'auth-required']);
const PROVIDER_ERROR_CODES = new Set(['api-error', 'provider-request-failed']);

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
      message: 'The selected AI provider rejected its server credential.'
    };
  }
  return {
    status: originalStatus,
    code: originalCode,
    message: timeout
      ? 'The selected AI provider timed out while accepting the task.'
      : aborted
        ? 'The selected AI provider connection was interrupted. Please retry shortly.'
        : String(error && error.message || '')
  };
}
