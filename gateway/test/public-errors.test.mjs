import assert from 'node:assert/strict';
import test from 'node:test';
import { publicGatewayError, sanitizePublicGatewayMessage } from '../src/public-errors.js';

test('provider authentication errors are isolated from user sessions', () => {
  const error = Object.assign(new Error('Invalid token (request id: secret-upstream-id)'), {
    status: 401,
    code: 'api-error'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 502,
    code: 'provider-auth-failed',
    message: 'The selected AI service rejected its server credential.'
  });
});

test('user session errors keep their authentication semantics', () => {
  const error = Object.assign(new Error('A valid Supabase session is required.'), {
    status: 401,
    code: 'invalid-session'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 401,
    code: 'invalid-session',
    message: 'A valid Supabase session is required.'
  });
});

test('gateway account authorization errors are not mislabeled as provider failures', () => {
  const error = Object.assign(new Error('This AI account is suspended.'), {
    status: 403,
    code: 'account-suspended'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 403,
    code: 'account-suspended',
    message: 'This AI account is suspended.'
  });
});

test('provider timeouts never leak numeric DOMException codes', () => {
  const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.equal(error.code, 23);
  assert.deepEqual(publicGatewayError(error), {
    status: 504,
    code: 'provider-timeout',
    message: 'The generation service took too long to respond. Points are temporarily held while the task is verified; please retry shortly.'
  });
});

test('unexpected aborts are exposed as retryable provider interruptions', () => {
  const error = new DOMException('This operation was aborted', 'AbortError');
  assert.deepEqual(publicGatewayError(error), {
    status: 503,
    code: 'provider-temporarily-unavailable',
    message: 'The generation service is temporarily unavailable. No points were charged; please retry shortly.'
  });
});

test('reference policy rejections preserve their dedicated safe code', () => {
  const error = Object.assign(new Error('The reference image may contain copyrighted or restricted content.'), {
    status: 400,
    code: 'reference-policy-rejected'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 400,
    code: 'reference-policy-rejected',
    message: 'The reference media may contain copyrighted or restricted content. Choose another file. No points were charged.'
  });
});

test('supplier and relay names are removed from public gateway messages', () => {
  const message = sanitizePublicGatewayMessage('QuickRouter forwarded a Gemini error from Atlas Cloud (HTTP 502).');
  assert.doesNotMatch(message, /quickrouter|gemini|atlas|502/i);
  assert.equal(message, 'AI service forwarded an AI service error from AI service.');
});

test('unknown upstream errors are reduced to stable public categories', () => {
  const error = Object.assign(new Error('seedance-2-5 vendor task failed at private endpoint'), {
    status: 502,
    code: 'seedance-provider-internal'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 502,
    code: 'provider-temporarily-unavailable',
    message: 'The generation service is temporarily unavailable. No points were charged; please retry shortly.'
  });
});

test('accepted tasks always use the recovery category', () => {
  const error = Object.assign(new Error('private task id 123'), {
    status: 504,
    code: 'provider-timeout',
    providerTaskAccepted: true
  });
  assert.equal(publicGatewayError(error).code, 'provider-task-recovery-pending');
  assert.doesNotMatch(publicGatewayError(error).message, /provider|supplier|task id|123/i);
});

test('tool failures keep concrete safe categories without exposing upstream details', () => {
  const cases = [
    ['ai302-rate-limited', 429, 'Too many users are generating right now. No points were charged; please retry shortly.'],
    ['ai302-balance-exhausted', 402, 'The generation service is temporarily unavailable. No points were charged; please retry shortly.'],
    ['ai302-upstream-error', 502, 'The generation request was not accepted. No points were charged; please check the settings and retry.'],
    ['image-tool-failed', 502, 'Image processing failed. No points were charged; please try again.'],
    ['three-d-generation-failed', 502, '3D generation failed. No points were charged; please try again.']
  ];
  for (const [code, status, message] of cases) {
    const result = publicGatewayError(Object.assign(new Error('private upstream task id 123'), { code, status }));
    assert.equal(result.code, code === 'ai302-rate-limited' ? 'provider-rate-limited'
      : code === 'ai302-balance-exhausted' ? 'provider-temporarily-unavailable'
        : code === 'ai302-upstream-error' ? 'provider-request-failed' : code);
    assert.equal(result.message, message);
    assert.doesNotMatch(result.message, /302|atlas|quickrouter|task id|123|https?:/i);
  }
});

test('accepted or ambiguous tool errors stay in recovery and never claim a refund', () => {
  const result = publicGatewayError(Object.assign(new Error('private endpoint task id'), {
    code: 'ai302-upstream-error',
    status: 502,
    submissionAmbiguous: true
  }));
  assert.deepEqual(result, {
    status: 503,
    code: 'provider-task-recovery-pending',
    message: 'The generated result is being recovered safely. Points are temporarily held until delivery is confirmed; please retry shortly.'
  });
});
