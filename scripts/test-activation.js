'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
  assert.equal(entry.credits, 143);
});

const mainSource = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8');
const activationSource = fs.readFileSync(path.resolve(__dirname, '../src/js/activation.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
assert.doesNotMatch(mainSource, /aiProviderRequiresActivation|isAiActivationUnlocked/);
assert.doesNotMatch(mainSource, /reason:\s*'activation-required'/);
assert.match(mainSource, /modelAccessRestricted:\s*false/);
assert.doesNotMatch(activationSource, /refreshAiMediaSettings|getAiMediaConfig|messs:ai-config-updated/);
assert.doesNotMatch(activationSource, /Activated|Not activated|Activation failed|Enter the activation code/);
assert.match(activationSource, /creditsAdded[\s\S]*?points added/);
assert.match(indexHtml, /class="ai-provider-section preferences-settings-section"/);
assert.match(indexHtml, /class="ai-provider-section storage-settings-section"/);
assert.match(indexHtml, /id="library-path-title"[^>]*>Asset storage location/);
assert.match(indexHtml, /id="library-path-change-btn"[^>]*>Change Location/);
assert.match(mainSource, /settings:pickLibraryPath/);
assert.match(preloadSource, /pickLibraryPath/);
assert.match(indexHtml, /id="ai-provider-manager-footer" class="ai-provider-manager-footer" hidden aria-hidden="true"/);
assert.match(indexHtml, /class="theme-switch preference-choice-switch"[\s\S]*?class="language-switch preference-choice-switch"[\s\S]*?class="ai-provider-section software-update-section"[\s\S]*?class="ai-provider-section activation-settings-section"/);

console.log('Activation tests passed.');
