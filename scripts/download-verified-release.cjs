const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yaml = require('js-yaml');

(async () => {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !process.argv[3]) throw Error('Usage: version output-directory');
  const base = `https://github.com/a1804927460-bot/messs-releases/releases/download/v${version}/`;
  const response = await fetch(base + 'latest.yml', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Manifest HTTP ${response.status}`);
  const manifest = yaml.load(await response.text());
  if (manifest.version !== version) throw Error('Manifest version mismatch');
  const name = `Messs-${version}-x64-Setup.exe`;
  const entry = manifest.files.find(file => file.url === name);
  if (!entry || Buffer.from(entry.sha512, 'base64').length !== 64 || !(entry.size > 0)) throw Error('Invalid installer manifest');
  const directory = path.resolve(process.argv[3]);
  await fs.promises.mkdir(directory, { recursive: true });
  const target = path.join(directory, name), partial = target + '.part';
  if (fs.existsSync(target)) throw Error(`Target already exists: ${target}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const download = await fetch(base + name, { signal: AbortSignal.timeout(600000) });
      if (!download.ok) throw Error(`Installer HTTP ${download.status}`);
      const hash = crypto.createHash('sha512');
      let bytes = 0, lastReport = 0;
      const verify = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length; hash.update(chunk);
        if (bytes > entry.size) return callback(Error('Installer exceeds declared size'));
        if (Date.now() - lastReport > 10000) {
          console.log(`Download ${Math.floor(bytes / entry.size * 100)}%`); lastReport = Date.now();
        }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(download.body), verify, fs.createWriteStream(partial));
      if (bytes !== entry.size || hash.digest('base64') !== entry.sha512) throw Error('Installer checksum/size mismatch');
      await fs.promises.rename(partial, target);
      console.log(JSON.stringify({ verified: true, version, bytes, path: target }));
      return;
    } catch (error) {
      await fs.promises.rm(partial, { force: true });
      if (attempt === 3) throw error;
      console.log(`Download retry ${attempt}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
