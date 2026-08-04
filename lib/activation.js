'use strict';

const {
  ACTIVATION_SCHEMA_VERSION,
  hashRedemptionCode,
  redemptionForCode,
  isRecognizedActivationHash
} = require('./redemption-codes');

function hashActivationCode(code) {
  return hashRedemptionCode(code);
}

function verifyActivationCode(code) {
  return !!redemptionForCode(code);
}

function getActivationStatus(settings) {
  const activation = settings && settings.activation || {};
  // Schema v2 deliberately invalidates a persisted v0.0.3 activation. Users
  // must redeem again in More Settings before overseas providers are exposed.
  const activated = Number(activation.schemaVersion) === ACTIVATION_SCHEMA_VERSION &&
    isRecognizedActivationHash(activation.verifiedHash);
  return {
    activated,
    activatedAt: activated ? activation.activatedAt || null : null,
    grantId: activated ? activation.grantId || null : null
  };
}

function activate(settings, code) {
  const grant = redemptionForCode(code);
  if (!grant) return { ok: false, reason: 'invalid-code', ...getActivationStatus(settings) };
  settings.activation = {
    schemaVersion: ACTIVATION_SCHEMA_VERSION,
    verifiedHash: grant.hash,
    grantId: grant.id,
    activatedAt: new Date().toISOString()
  };
  return {
    ok: true,
    ...getActivationStatus(settings),
    grant: {
      id: grant.id,
      codeHash: grant.hash,
      credits: grant.credits
    }
  };
}

module.exports = { activate, getActivationStatus, hashActivationCode, verifyActivationCode };
