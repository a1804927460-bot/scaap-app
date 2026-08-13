'use strict';

const assert = require('assert');
const {
  extractClipboardImageSources,
  extractHtmlImageSources,
  extractTextImageSources,
  clipboardSourceToLocalPath,
  normalizeClipboardRemoteUrl,
  isPrivateNetworkAddress
} = require('../lib/clipboard-images');

assert.deepStrictEqual(
  extractHtmlImageSources('<img src="https://cdn.example.com/reference.webp">'),
  ['https://cdn.example.com/reference.webp']
);
assert.deepStrictEqual(
  extractHtmlImageSources('SourceURL:https://example.com/gallery/page\n<img src="../images/reference.png">'),
  ['https://example.com/images/reference.png']
);
assert.deepStrictEqual(
  extractHtmlImageSources('<picture><source srcset="https://cdn.example.com/one.avif 1x, https://cdn.example.com/two.avif 2x"></picture>'),
  ['https://cdn.example.com/one.avif']
);
assert.deepStrictEqual(
  extractHtmlImageSources('<meta property="og:image" content="https://cdn.example.com/social.jpg">'),
  ['https://cdn.example.com/social.jpg']
);
assert.deepStrictEqual(
  extractTextImageSources('C:\\Users\\Example\\Pictures\\image.png\nhttps://cdn.example.com/image.jpg'),
  ['C:\\Users\\Example\\Pictures\\image.png', 'https://cdn.example.com/image.jpg']
);
assert.deepStrictEqual(
  extractClipboardImageSources({
    html: '<img src="data:image/png;base64,aGVsbG8=">',
    text: 'https://cdn.example.com/image.png'
  }),
  ['data:image/png;base64,aGVsbG8=', 'https://cdn.example.com/image.png']
);
assert.strictEqual(
  clipboardSourceToLocalPath('file:///C:/Users/Example/Pictures/image.png'),
  'C:\\Users\\Example\\Pictures\\image.png'
);
assert.strictEqual(normalizeClipboardRemoteUrl('https://cdn.example.com/image.png'), 'https://cdn.example.com/image.png');
assert.strictEqual(normalizeClipboardRemoteUrl('http://cdn.example.com/image.png'), '');
assert.strictEqual(normalizeClipboardRemoteUrl('https://user:password@cdn.example.com/image.png'), '');
assert.strictEqual(normalizeClipboardRemoteUrl('https://localhost/image.png'), '');
assert.strictEqual(isPrivateNetworkAddress('127.0.0.1'), true);
assert.strictEqual(isPrivateNetworkAddress('10.2.3.4'), true);
assert.strictEqual(isPrivateNetworkAddress('172.16.0.1'), true);
assert.strictEqual(isPrivateNetworkAddress('192.168.1.2'), true);
assert.strictEqual(isPrivateNetworkAddress('169.254.2.3'), true);
assert.strictEqual(isPrivateNetworkAddress('::1'), true);
assert.strictEqual(isPrivateNetworkAddress('fc00::1'), true);
assert.strictEqual(isPrivateNetworkAddress('::ffff:127.0.0.1'), true);
assert.strictEqual(isPrivateNetworkAddress('::ffff:7f00:1'), true);
assert.strictEqual(isPrivateNetworkAddress('8.8.8.8'), false);
assert.strictEqual(isPrivateNetworkAddress('2606:4700:4700::1111'), false);

process.stdout.write('Clipboard image parsing tests passed.\n');
