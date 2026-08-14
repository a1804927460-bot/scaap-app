'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalFileResponse } = require('../lib/local-file-response');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-local-media-'));
  const filePath = path.join(directory, 'sample.mp4');
  const payload = Buffer.from(Array.from({ length: 4096 }, (_value, index) => index % 251));
  fs.writeFileSync(filePath, payload);

  try {
    const complete = createLocalFileResponse(new Request('https://local.test/video'), filePath, 'video/mp4');
    assert.strictEqual(complete.status, 200);
    assert.strictEqual(complete.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(complete.headers.get('content-length'), String(payload.length));
    assert.deepStrictEqual(Buffer.from(await complete.arrayBuffer()), payload);

    const partial = createLocalFileResponse(new Request('https://local.test/video', {
      headers: { Range: 'bytes=120-379' }
    }), filePath, 'video/mp4');
    assert.strictEqual(partial.status, 206);
    assert.strictEqual(partial.headers.get('content-range'), `bytes 120-379/${payload.length}`);
    assert.deepStrictEqual(Buffer.from(await partial.arrayBuffer()), payload.subarray(120, 380));

    const suffix = createLocalFileResponse(new Request('https://local.test/video', {
      headers: { Range: 'bytes=-128' }
    }), filePath, 'video/mp4');
    assert.strictEqual(suffix.status, 206);
    assert.deepStrictEqual(Buffer.from(await suffix.arrayBuffer()), payload.subarray(payload.length - 128));

    const invalid = createLocalFileResponse(new Request('https://local.test/video', {
      headers: { Range: `bytes=${payload.length}-` }
    }), filePath, 'video/mp4');
    assert.strictEqual(invalid.status, 416);

    for (let index = 0; index < 100; index += 1) {
      const response = createLocalFileResponse(new Request('https://local.test/video'), filePath, 'video/mp4');
      const reader = response.body.getReader();
      await reader.read();
      await Promise.all([reader.cancel(), reader.cancel()]);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  process.stdout.write('LOCAL_FILE_RESPONSE_OK\n');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
