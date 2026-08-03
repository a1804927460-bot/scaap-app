'use strict';

const assert = require('assert');
const {
  assertSafeLocalFile,
  assertPromptHasNoSecrets,
  classifyLocalFile,
  sanitizeAiRequest,
  validateAiUrls
} = require('../lib/privacy-guard');

assert.deepStrictEqual(
  classifyLocalFile({ name: 'photo.png', originalPath: 'C:\\Users\\demo\\Pictures\\photo.png' }),
  { safe: true, reason: null }
);
assert.strictEqual(classifyLocalFile({ name: '.env.production' }).safe, false);
assert.strictEqual(classifyLocalFile({ name: 'client.p12' }).safe, false);
assert.strictEqual(classifyLocalFile({ name: 'cover.png', originalPath: 'C:\\Users\\demo\\.ssh\\cover.png' }).safe, false);
assert.throws(() => assertSafeLocalFile({ name: 'id_ed25519' }), (error) => error.code === 'privacy-blocked');
assert.throws(() => assertPromptHasNoSecrets('postgres://admin:secret@example.com/db'), (error) => error.code === 'privacy-blocked');

const image = 'data:image/png;base64,iVBORw0KGgo=';
assert.deepStrictEqual(validateAiUrls([image, 'https://cdn.example.com/a.png']), [image, 'https://cdn.example.com/a.png']);
assert.throws(() => validateAiUrls(['file:///C:/private.png']), (error) => error.code === 'privacy-blocked');

const sanitized = sanitizeAiRequest({
  prompt: 'Make this brighter',
  urls: [image],
  messages: [{ role: 'user', content: 'Describe it', images: [image], ignored: 'drop me' }]
});
assert.strictEqual(sanitized.prompt, 'Make this brighter');
assert.deepStrictEqual(sanitized.urls, [image]);
assert.deepStrictEqual(sanitized.messages[0].images, [image]);
assert.strictEqual(sanitized.messages[0].ignored, undefined);

console.log('privacy guard tests passed');
