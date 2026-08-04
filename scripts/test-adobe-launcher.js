'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  registryValuePaths,
  findAdobeExecutable,
  launchAdobeMedia
} = require('../lib/adobe-launcher');

function fakeFileStat() {
  return { isFile: () => true };
}

async function run() {
  const registryPath = 'D:\\创意工具\\Adobe Photoshop 2026\\Photoshop.exe';
  assert.deepStrictEqual(
    registryValuePaths(
      `HKEY_LOCAL_MACHINE\\...\r\n    (Default)    REG_SZ    "${registryPath}"\r\n`,
      { executableName: 'Photoshop.exe', relativeExecutable: 'Photoshop.exe' },
      {}
    ),
    [registryPath],
    'quoted Unicode App Paths values should be preserved exactly'
  );

  const detected = findAdobeExecutable('photoshop', {
    platform: 'win32',
    env: {},
    queryRegistry: (key) => key.startsWith('HKCU')
      ? `    (Default)    REG_SZ    ${registryPath}\r\n`
      : '',
    existsSync: (candidate) => candidate === registryPath,
    statSync: fakeFileStat,
    readdirSync: () => { throw new Error('not installed in the standard root'); },
    execFileSyncImpl: () => { throw new Error('not on PATH'); }
  });
  assert.strictEqual(detected, registryPath, 'App Paths should support custom Creative Cloud install locations');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-adobe-'));
  const sourcePath = path.join(tempRoot, '中文 media file.png');
  fs.writeFileSync(sourcePath, Buffer.from('test'));
  const executable = 'C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe';
  let child;
  let unrefCalled = false;
  let spawnCall;
  const spawnMock = (command, args, options) => {
    spawnCall = { command, args, options };
    child = new EventEmitter();
    child.unref = () => { unrefCalled = true; };
    return child;
  };

  const pendingLaunch = launchAdobeMedia('photoshop', sourcePath, {
    platform: 'win32',
    language: 'zh',
    findExecutable: () => executable,
    spawn: spawnMock,
    timeoutMs: 2000
  });
  let resolvedBeforeSpawn = false;
  pendingLaunch.then(() => { resolvedBeforeSpawn = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(resolvedBeforeSpawn, false, 'launch must not report success before the child spawn event');
  child.emit('spawn');
  const launched = await pendingLaunch;
  assert.deepStrictEqual(spawnCall.args, [sourcePath], 'the archived local path must be a separate spawn argument');
  assert.strictEqual(spawnCall.command, executable);
  assert.strictEqual(spawnCall.options.shell, false, 'shell parsing must stay disabled for spaces and Unicode paths');
  assert.strictEqual(spawnCall.options.windowsHide, false, 'the Adobe GUI must not be launched hidden');
  assert.strictEqual(launched.ok, true);
  assert.strictEqual(launched.reason, 'launched');
  assert.strictEqual(unrefCalled, true);

  let failedChild;
  const failedLaunchPromise = launchAdobeMedia('after-effects', sourcePath, {
    platform: 'win32',
    findExecutable: () => 'D:\\Adobe\\AfterFX.exe',
    spawn: () => {
      failedChild = new EventEmitter();
      failedChild.unref = () => {};
      return failedChild;
    },
    timeoutMs: 2000
  });
  failedChild.emit('error', Object.assign(new Error('spawn blocked'), { code: 'EACCES' }));
  const failed = await failedLaunchPromise;
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.reason, 'permission-denied');
  assert.ok(failed.message);

  const missing = await launchAdobeMedia('photoshop', path.join(tempRoot, 'missing.png'), {
    platform: 'win32',
    findExecutable: () => executable
  });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.reason, 'source-file-missing');

  const protocolUrl = await launchAdobeMedia('photoshop', 'messs-file://generated-id', {
    platform: 'win32',
    findExecutable: () => executable
  });
  assert.strictEqual(protocolUrl.ok, false);
  assert.strictEqual(protocolUrl.reason, 'invalid-source-path');

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log('adobe launcher tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
