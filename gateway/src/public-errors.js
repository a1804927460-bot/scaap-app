const PROVIDER_AUTH_STATUSES = new Set([401, 403]);
const USER_AUTH_CODES = new Set(['invalid-session', 'auth-required']);
const PROVIDER_ERROR_CODES = new Set(['api-error', 'provider-request-failed', 'ai302-unauthorized']);
const SUPPLIER_NAME_RE = /\b(?:api\.atlascloud\.ai|atlas\s*cloud|atlascloud|302(?:\.ai)?|ai302|quick\s*router|topaz(?:\s+labs)?|higgsfield|google|gemini|kling|jimeng|dreamina|minimax|doubao|seedream|seedance|hyper3d|tripo(?:3d)?|hunyuan|qwen|clipdrop|legnext|rodin|openai|anthropic|volcengine|bytedance|kwaivgi|replicate|siliconflow|aliyun|deepseek)\b/gi;
const KNOWN_PUBLIC_CODES = new Set([
  'invalid-session', 'auth-required', 'account-suspended', 'request-id-conflict', 'delivery-status-conflict',
  'invalid-delivery-confirmation', 'quota-not-configured', 'quota-service-failed',
  'credit-service-not-configured', 'credit-schema-missing', 'credit-service-failed',
  'credit-settlement-failed', 'credit-settlement-conflict', 'redemption-service-failed',
  'provider-not-configured', 'provider-secret-missing', 'provider-auth-failed',
  'api-error', 'provider-request-failed', 'reference-policy-rejected',
  'provider-invalid-response', 'provider-result-missing', 'provider-download-failed',
  'media-download-failed', 'invalid-media', 'provider-task-recovery-pending',
  'image-job-schema-missing', 'image-job-record-failed', 'provider-rate-limited',
  'provider-timeout', 'provider-channel-unavailable', 'provider-temporarily-unavailable',
  'video-job-service-not-configured', 'video-job-schema-missing', 'video-job-service-failed',
  'video-job-finalization-failed', 'gateway-queue-full', 'gateway-queue-timeout',
  'ai302-not-configured', 'ai302-unavailable', 'ai302-timeout', 'ai302-invalid-response',
  'ai302-upstream-error', 'ai302-unauthorized', 'ai302-balance-exhausted', 'ai302-rate-limited',
  'ai302-route-unavailable', 'image-tool-failed', 'unsafe-tool-result-url', 'tool-download-failed',
  'tool-result-too-large', 'invalid-video-result', 'video-upscale-failed',
  'video-upscale-request-rejected', 'video-upload-not-found', 'video-upload-incomplete',
  'invalid-video-upload-chunk', 'video-upload-chunk-conflict', 'video-tool-task-not-ready',
  'video-tool-task-not-found', 'insufficient-credits', 'invalid-png-result',
  'invalid-glb-result', 'three-d-result-invalid', 'tool-public-url-not-configured',
  'tool-asset-capacity-exceeded', 'tool-disabled', 'tool-asset-not-found',
  'invalid-image-tool', 'invalid-image-tool-options', 'invalid-image-result-index',
  'invalid-mask-image', 'image-tool-task-not-found', 'image-tool-task-not-ready',
  'three-d-task-not-found', 'three-d-task-not-ready', 'three-d-generation-failed',
  'invalid-json', 'invalid-request', 'invalid-option', 'unsupported-file-type',
  'file-not-found', 'privacy-blocked', 'local-delivery-failed', 'invalid-ai-delivery-confirmation'
]);
const PUBLIC_CODE_ALIASES = Object.freeze({
  'ai302-unauthorized': 'provider-auth-failed',
  'ai302-balance-exhausted': 'provider-temporarily-unavailable',
  'ai302-rate-limited': 'provider-rate-limited',
  'ai302-route-unavailable': 'provider-channel-unavailable',
  'ai302-upstream-error': 'provider-request-failed',
  'ai302-timeout': 'provider-timeout',
  'ai302-unavailable': 'provider-temporarily-unavailable',
  'ai302-invalid-response': 'provider-invalid-response'
});
const PUBLIC_MESSAGES = Object.freeze({
  'reference-policy-rejected': 'The reference media may contain copyrighted or restricted content. Choose another file. No points were charged.',
  'provider-rate-limited': 'Too many users are generating right now. No points were charged; please retry shortly.',
  'provider-channel-unavailable': 'The generation service is temporarily busy. No points were charged; please retry shortly.',
  'provider-temporarily-unavailable': 'The generation service is temporarily unavailable. No points were charged; please retry shortly.',
  'provider-timeout': 'The generation service took too long to respond. Points are temporarily held while the task is verified; please retry shortly.',
  'provider-invalid-response': 'The generation service returned an incomplete response. Points are temporarily held while the task is verified; please retry.',
  'provider-result-missing': 'Generation completed without a usable result. Points are temporarily held while delivery is verified; please retry.',
  'provider-download-failed': 'The result was generated but could not be downloaded safely. Points are temporarily held while delivery is recovered; please retry.',
  'media-download-failed': 'The result was generated but could not be downloaded safely. Points are temporarily held while delivery is recovered; please retry.',
  'invalid-media': 'The generated file could not be verified or added to the canvas. Points are temporarily held while the result is checked.',
  'video-provider-result-invalid': 'The generated video result could not be verified. Points are temporarily held while the result is checked; please retry.',
  'provider-request-failed': 'The generation request was not accepted. No points were charged; please check the settings and retry.',
  'provider-auth-failed': 'The generation service credential was rejected. No points were charged; please try again later.',
  'provider-task-recovery-pending': 'The generated result is being recovered safely. Points are temporarily held until delivery is confirmed; please retry shortly.',
  'ai302-timeout': 'The generation service took too long to respond. Points are temporarily held while we verify the task; please retry shortly.',
  'ai302-unavailable': 'The generation service is temporarily unavailable. Points are temporarily held while we verify the task; please retry shortly.',
  'ai302-invalid-response': 'The generation service returned an incomplete response. Points are temporarily held while we verify the task; please retry shortly.',
  'ai302-unauthorized': 'The generation service credential was rejected. No points were charged; please try again later.',
  'ai302-balance-exhausted': 'The generation service is temporarily unavailable. No points were charged; please try again later.',
  'ai302-rate-limited': 'Too many users are generating right now. No points were charged; please retry shortly.',
  'ai302-route-unavailable': 'The generation service is temporarily unavailable. No points were charged; please retry shortly.',
  'image-tool-failed': 'Image processing failed. No points were charged; please try again.',
  'three-d-generation-failed': '3D generation failed. No points were charged; please try again.',
  'video-upscale-failed': 'Video enhancement failed. No points were charged; please try again.',
  'ai302-upstream-error': 'The generation request was not accepted. No points were charged; please check the settings and retry.',
  'image-job-schema-missing': 'Safe image recovery is not ready yet. This generation was not started; please retry shortly.',
  'image-job-record-failed': 'The generated result could not be recorded safely. Points are temporarily held; please retry shortly.'
});

function classifiedProviderCode(code, status, message) {
  const text = `${code} ${message}`;
  if (/copyright|restricted content|sensitive content|policy|moderation|InputImageSensitiveContentDetected/i.test(text)) {
    return 'reference-policy-rejected';
  }
  if (status === 429 || /rate.?limit|too many requests|capacity|overloaded|saturated/i.test(text)) {
    return 'provider-rate-limited';
  }
  if (/channel.{0,40}(?:unavailable|configuration|network|failed|error)/i.test(text)) {
    return 'provider-channel-unavailable';
  }
  if (/provider-result-missing|empty-media|completed.{0,60}(?:without|no).{0,30}(?:result|output|media|url)/i.test(text)) {
    return 'provider-result-missing';
  }
  if (/provider-download-failed|media-download-failed|download.{0,30}(?:failed|interrupted)/i.test(text)) {
    return 'provider-download-failed';
  }
  if (/invalid-media|video-provider-result-invalid/i.test(text)) return 'invalid-media';
  if (/provider-task-recovery-pending|accepted image task|result is being recovered/i.test(text)) {
    return 'provider-task-recovery-pending';
  }
  if (/image-job-schema-missing|durable image task recovery/i.test(text)) return 'image-job-schema-missing';
  if (/image-job-record-failed|could not be recorded safely/i.test(text)) return 'image-job-record-failed';
  return code;
}

function publicErrorCode(code, status) {
  const normalized = String(code || '').trim().toLowerCase();
  if (KNOWN_PUBLIC_CODES.has(normalized)) {
    return PUBLIC_CODE_ALIASES[normalized] || (normalized === 'api-error' ? 'provider-request-failed' : normalized);
  }
  return Number(status) >= 500 ? 'provider-temporarily-unavailable' : 'provider-request-failed';
}

export function sanitizePublicGatewayMessage(value) {
  return String(value || '')
    .replace(SUPPLIER_NAME_RE, 'AI service')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\b(?:task|request|prediction|generation)[-_ ]?id\s*[:=]\s*[A-Za-z0-9._~-]+/gi, '')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?:Bearer\s+)?(?:sk|sb_secret|ghp|github_pat)[-_A-Za-z0-9]{8,}\b/gi, '[redacted]')
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
  const rawCode = timeout
    ? 'provider-timeout'
    : aborted
      ? 'provider-temporarily-unavailable'
    : String(error && error.code || (originalStatus >= 500 ? 'gateway-error' : 'bad-request'));
  const rawMessage = String(error && error.message || '');
  const originalCode = classifiedProviderCode(rawCode, originalStatus, rawMessage);
  if (error && (error.providerTaskAccepted === true || error.submissionAmbiguous === true)
      && error.providerTaskTerminalFailure !== true) {
    return {
      status: 503,
      code: 'provider-task-recovery-pending',
      message: PUBLIC_MESSAGES['provider-task-recovery-pending']
    };
  }
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
  const code = publicErrorCode(originalCode, originalStatus);
  const fixedMessage = PUBLIC_MESSAGES[code];
  return {
    status: originalStatus,
    code,
    message: fixedMessage || sanitizePublicGatewayMessage(timeout
      ? 'The selected AI service timed out while accepting the task.'
      : aborted
        ? 'The selected AI service connection was interrupted. Please retry shortly.'
        : (code === 'provider-temporarily-unavailable'
          ? 'The AI service is temporarily unavailable. Please retry shortly.'
          : code === 'provider-request-failed'
            ? 'The generation request was not accepted. Please check the settings and try again.'
            : rawMessage))
  };
}
