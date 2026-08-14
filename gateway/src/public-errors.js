const PROVIDER_AUTH_STATUSES = new Set([401, 403]);
const USER_AUTH_CODES = new Set(['invalid-session', 'auth-required']);
const PROVIDER_ERROR_CODES = new Set(['api-error', 'provider-request-failed']);

export function publicGatewayError(error) {
  const originalStatus = Number(error && error.status) || (error && error.name === 'AbortError' ? 499 : 500);
  const originalCode = String(error && error.code || (originalStatus >= 500 ? 'gateway-error' : 'bad-request'));
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
    message: String(error && error.message || '')
  };
}
