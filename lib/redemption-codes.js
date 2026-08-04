'use strict';

const crypto = require('crypto');

const ACTIVATION_SCHEMA_VERSION = 2;
const OWNER_CODE_HASH = '1083767bbed23a69343cd7a8898907a12780e34eb11936b6482804fc810f9614';
const BETA_GRANTS = Object.freeze([
  Object.freeze({ id: 'beta-01', hash: '0c781c055e478e20beb10eb2119c2e7fa147f7fcb2ca8630b08c7508c7c4d2cf', credits: 100 }),
  Object.freeze({ id: 'beta-02', hash: '301879aa480616dfab6c7ba930b9abff28db809315a058b3c78c726c05647299', credits: 100 }),
  Object.freeze({ id: 'beta-03', hash: '81605b41aac5c9a2f30757eca962a1f62eeab6175aaea0438d5b8ac498ef218c', credits: 100 }),
  Object.freeze({ id: 'beta-04', hash: '0cbe7529004102a4a3398189081ea4573139403d326a97781868f9eb276037f4', credits: 100 }),
  Object.freeze({ id: 'beta-05', hash: 'ecfd5f325937693007da4ce734c9374fa7066c585ad7db620d247eb8087c8d1f', credits: 100 }),
  Object.freeze({ id: 'beta-06', hash: '6864748624a8fed5215970e0a281139ad71b9d436e82482681606d23b288b939', credits: 100 }),
  Object.freeze({ id: 'beta-07', hash: 'dce2c20d3f07132931dd98ccb5f62100ecc273167a3ac3be978c5a15f8ac0b9f', credits: 100 }),
  Object.freeze({ id: 'beta-08', hash: '9452d13cfc2b14a447ed7dfa2f122ab80cb26d5d6c3844f8fc056fc140594e0e', credits: 100 }),
  Object.freeze({ id: 'beta-09', hash: '989b7ed8fa242a5e30801b8234949013d79a4210e4693180a0a956fbef6054dd', credits: 100 }),
  Object.freeze({ id: 'beta-10', hash: 'b2eb826636a3aa86d032aeacb094aa5a62f297269b26f26c77df60ba69b96737', credits: 100 })
]);

function hashRedemptionCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim(), 'utf8').digest('hex');
}

function hashesMatch(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || '')) || !/^[a-f0-9]{64}$/i.test(String(right || ''))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function grantForHash(hash) {
  if (hashesMatch(hash, OWNER_CODE_HASH)) {
    return { id: 'owner-access', hash: OWNER_CODE_HASH, credits: 0, activates: true };
  }
  const grant = BETA_GRANTS.find((entry) => hashesMatch(hash, entry.hash));
  return grant ? { ...grant, activates: true } : null;
}

function redemptionForCode(code) {
  const hash = hashRedemptionCode(code);
  const grant = grantForHash(hash);
  return grant ? { ...grant, hash } : null;
}

function isRecognizedActivationHash(hash) {
  return !!grantForHash(hash);
}

module.exports = {
  ACTIVATION_SCHEMA_VERSION,
  BETA_GRANTS,
  hashRedemptionCode,
  redemptionForCode,
  isRecognizedActivationHash
};
