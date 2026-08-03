'use strict';

const crypto = require('crypto');

const EXPECTED_CODE_HASH = '1083767bbed23a69343cd7a8898907a12780e34eb11936b6482804fc810f9614';

function hashActivationCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim(), 'utf8').digest('hex');
}

function hashesMatch(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || '')) || !/^[a-f0-9]{64}$/i.test(String(right || ''))) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function verifyActivationCode(code) {
  return hashesMatch(hashActivationCode(code), EXPECTED_CODE_HASH);
}

function getActivationStatus(settings) {
  const activation = settings && settings.activation || {};
  const activated = hashesMatch(activation.verifiedHash, EXPECTED_CODE_HASH);
  return {
    activated,
    activatedAt: activated ? activation.activatedAt || null : null
  };
}

function activate(settings, code) {
  if (!verifyActivationCode(code)) return { ok: false, reason: 'invalid-code', ...getActivationStatus(settings) };
  settings.activation = {
    verifiedHash: EXPECTED_CODE_HASH,
    activatedAt: new Date().toISOString()
  };
  return { ok: true, ...getActivationStatus(settings) };
}

module.exports = { activate, getActivationStatus, hashActivationCode, verifyActivationCode };
