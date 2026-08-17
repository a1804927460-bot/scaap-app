'use strict';

const assert = require('assert');
const {
  WECHAT_URI,
  encodedPowerShell,
  isLoggedInWindow,
  sendToWeChatFileHelper
} = require('../lib/wechat-file-helper');
const fs = require('fs');
const path = require('path');

(async () => {
  assert.strictEqual(WECHAT_URI, 'weixin://dl/chat?username=filehelper');
  assert.ok(encodedPowerShell('hello').length > 0);
  assert.strictEqual(isLoggedInWindow({ className: 'WeChatLoginWndForPC', title: '微信' }), false);
  assert.strictEqual(isLoggedInWindow({ className: 'WeChatMainWndForPC', title: '微信' }), true);
  assert.strictEqual(isLoggedInWindow({ className: 'Qt51514QWindowIcon', title: '微信' }), true);

  assert.strictEqual(isLoggedInWindow({ className: 'Qt51514QWindowIcon', title: '\u5fae\u4fe1' }), true);
  assert.strictEqual(isLoggedInWindow({ className: 'Qt51514QWindowIcon', title: '\u767b\u5f55' }), false);

  const unsupported = await sendToWeChatFileHelper('C:\\media\\image.png', {
    platform: 'darwin', existsSync: () => true
  });
  assert.strictEqual(unsupported.reason, 'unsupported-platform');

  const missing = await sendToWeChatFileHelper('C:\\media\\missing.png', {
    platform: 'win32', existsSync: () => false
  });
  assert.strictEqual(missing.reason, 'file-not-found');

  const opened = [];
  let clipboardWrites = 0;
  let sendAttempts = 0;
  const loginRequired = await sendToWeChatFileHelper('C:\\media\\image.png', {
    platform: 'win32', existsSync: () => true,
    probeWindows: async () => [{ processId: 12, className: 'WeChatLoginWndForPC', title: '微信' }],
    openExternal: async (url) => { opened.push(url); },
    writeClipboardFiles: () => { clipboardWrites += 1; },
    pasteAndSend: async () => { sendAttempts += 1; }
  });
  assert.strictEqual(loginRequired.reason, 'login-required');
  assert.deepStrictEqual(opened, ['weixin://']);
  assert.strictEqual(clipboardWrites, 0);
  assert.strictEqual(sendAttempts, 0);

  opened.length = 0;
  const targetMissing = await sendToWeChatFileHelper('C:\\media\\image.png', {
    platform: 'win32', existsSync: () => true,
    probeWindows: async () => [{ processId: 34, className: 'WeChatMainWndForPC', title: '微信' }],
    verifyTarget: async () => false,
    wait: async () => {},
    openExternal: async (url) => { opened.push(url); },
    writeClipboardFiles: () => { clipboardWrites += 1; },
    pasteAndSend: async () => { sendAttempts += 1; }
  });
  assert.strictEqual(targetMissing.reason, 'file-helper-not-found');
  assert.deepStrictEqual(opened, [WECHAT_URI]);
  assert.strictEqual(clipboardWrites, 0);
  assert.strictEqual(sendAttempts, 0);

  const events = [];
  const success = await sendToWeChatFileHelper('C:\\media\\image.png', {
    platform: 'win32', existsSync: () => true,
    probeWindows: async () => [{ processId: 56, className: 'WeChatMainWndForPC', title: '微信' }],
    verifyTarget: async (processId) => { events.push(`verify:${processId}`); return true; },
    wait: async () => {},
    openExternal: async (url) => { events.push(`open:${url}`); },
    writeClipboardFiles: (paths) => { events.push(`clipboard:${paths.join(',')}`); },
    pasteAndSend: async (processId) => { events.push(`send:${processId}`); return true; }
  });
  assert.strictEqual(success.ok, true);
  assert.deepStrictEqual(events, [
    `open:${WECHAT_URI}`,
    'verify:56',
    'clipboard:C:\\media\\image.png',
    'send:56'
  ]);

  const contextMenuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'context-menu.js'), 'utf8');
  assert.match(contextMenuSource, /send-wechat/);
  assert.match(contextMenuSource, /sendToWeChatFileHelper/);
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preloadSource, /sendToWeChatFileHelper/);
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /shell:sendToWeChatFileHelper/);

  process.stdout.write('WeChat File Transfer integration tests passed.\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
