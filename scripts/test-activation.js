'use strict';

const assert = require('assert');
const { activate, getActivationStatus, verifyActivationCode } = require('../lib/activation');

assert.equal(verifyActivationCode('Phaser'), true);
assert.equal(verifyActivationCode('phaser'), false);
assert.equal(verifyActivationCode('wrong'), false);

const settings = { activation: { verifiedHash: null, activatedAt: null } };
assert.equal(getActivationStatus(settings).activated, false);
assert.equal(activate(settings, 'wrong').ok, false);
assert.equal(activate(settings, 'Phaser').ok, true);
assert.equal(getActivationStatus(settings).activated, true);
assert.equal(JSON.stringify(settings).includes('Phaser'), false);

console.log('Activation tests passed.');
