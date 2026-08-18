import assert from 'node:assert/strict';
import test from 'node:test';
import { publicGatewayError } from '../src/public-errors.js';

test('provider authentication errors are isolated from user sessions', () => {
  const error = Object.assign(new Error('Invalid token (request id: secret-upstream-id)'), {
    status: 401,
    code: 'api-error'
  });
  assert.deepEqual(publicGatewayError(error), {
    status: 502,
    code: 'provider-auth-failed',
    message: 'The selected AI provider rejected its server credential.'
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
    message: 'The selected AI provider timed out while accepting the task.'
  });
});
