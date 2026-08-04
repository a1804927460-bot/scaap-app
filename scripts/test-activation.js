'use strict';

const assert = require('assert');
const { activate, getActivationStatus, verifyActivationCode } = require('../lib/activation');
const { ACTIVATION_SCHEMA_VERSION, BETA_GRANTS } = require('../lib/redemption-codes');

assert.equal(verifyActivationCode('Phaser'), true);
assert.equal(verifyActivationCode('phaser'), false);
assert.equal(verifyActivationCode('wrong'), false);

const legacySettings = {
  activation: {
    verifiedHash: '1083767bbed23a69343cd7a8898907a12780e34eb11936b6482804fc810f9614',
    activatedAt: '2026-08-01T00:00:00.000Z'
  }
};
assert.equal(getActivationStatus(legacySettings).activated, false, 'A v1 persisted activation must be re-entered.');

const settings = { activation: { schemaVersion: ACTIVATION_SCHEMA_VERSION, verifiedHash: null, activatedAt: null } };
assert.equal(getActivationStatus(settings).activated, false);
assert.equal(activate(settings, 'wrong').ok, false);
const ownerActivation = activate(settings, 'Phaser');
assert.equal(ownerActivation.ok, true);
assert.equal(ownerActivation.grant.id, 'owner-access');
assert.equal(ownerActivation.grant.credits, 0);
assert.equal(getActivationStatus(settings).activated, true);
assert.equal(settings.activation.schemaVersion, ACTIVATION_SCHEMA_VERSION);
assert.equal(JSON.stringify(settings).includes('Phaser'), false);

assert.equal(BETA_GRANTS.length, 10);
assert.equal(new Set(BETA_GRANTS.map((entry) => entry.id)).size, 10);
assert.equal(new Set(BETA_GRANTS.map((entry) => entry.hash)).size, 10);
BETA_GRANTS.forEach((entry) => {
  assert.match(entry.hash, /^[a-f0-9]{64}$/);
  assert.equal(entry.credits, 100);
});

console.log('Activation tests passed.');
