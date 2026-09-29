const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const [directory, version] = process.argv.slice(2);
assert.match(version || '', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
const required = [`Messs-${version}-x64-Setup.exe`, `Messs-${version}-x64-Setup.exe.blockmap`,
  ...['x64', 'arm64'].flatMap(arch => ['dmg', 'zip'].map(ext => `Messs-${version}-${arch}.${ext}`))];
for (const name of required) assert.ok(fs.statSync(path.join(directory, name)).size > 0, `Empty asset: ${name}`);
(async () => {
  for (const manifest of ['latest.yml', 'latest-mac.yml']) {
    const data = yaml.load(fs.readFileSync(path.join(directory, manifest), 'utf8'));
    assert.equal(data.version, version, `${manifest}: version mismatch`);
    const names = new Set();
    for (const file of data.files || []) {
      const name = decodeURIComponent(file.url);
      assert.equal(path.basename(name), name, 'Manifest must reference a local asset');
      names.add(name);
      const asset = path.join(directory, name);
      assert.equal(fs.statSync(asset).size, file.size, `${name}: size mismatch`);
      const hash = crypto.createHash('sha512');
      for await (const chunk of fs.createReadStream(asset)) hash.update(chunk);
      assert.equal(hash.digest('base64'), file.sha512, `${name}: checksum mismatch`);
    }
    const expected = manifest === 'latest.yml' ? [required[0]] : required.filter(name => /\.(zip|dmg)$/.test(name));
    for (const name of expected) assert.ok(names.has(name), `${manifest}: missing ${name}`);
  }
  console.log(`Verified complete Windows and Mac release ${version}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
