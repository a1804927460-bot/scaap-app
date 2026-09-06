const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = 'a1804927460-bot/messs-releases';
const tag = 'phasex-v1.0.0';
const binary = process.argv[2];
if (!binary) throw new Error('Pass the verified PhaseX portable EXE path.');
const data = fs.readFileSync(binary);
if (data.subarray(0, 2).toString() !== 'MZ') throw new Error('Expected a Windows executable.');
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const credential = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
});
const token = credential.split('\n').find(line => line.startsWith('password='))?.slice(9);
if (!token) throw new Error('GitHub credentials unavailable.');
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    ...options.headers
  }, signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
  return response.json();
}
(async () => {
  const root = `https://api.github.com/repos/${repo}/releases`;
  const releases = await api(`${root}?per_page=100`);
  let release = releases.find(entry => entry.tag_name === tag);
  if (!release) release = await api(root, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tag_name: tag, name: 'PHASE X 舞美工作台 1.0.0', draft: true, make_latest: 'false',
    body: `所有人免费下载，无需积分。\n\nWindows 64 位便携版，下载后运行。仅包含软件，不包含用户项目素材。\n\n文件大小：${data.length} bytes\nSHA-256：\`${sha256}\`\n\n这是独立软件资源，不是 Messs 桌面更新。`
  }) });
  let asset = release.assets.find(entry => entry.name === 'PHASE-X-1.0.0-Windows-x64.exe');
  if (asset && (asset.size !== data.length || asset.digest !== `sha256:${sha256}`)) throw new Error('Existing asset differs; refusing to overwrite.');
  if (!asset) {
    const output = execFileSync('curl.exe', ['--silent', '--show-error', '--fail-with-body', '--connect-timeout', '30', '--max-time', '600',
      '--request', 'POST', '--header', 'Content-Type: application/octet-stream', '--upload-file', binary,
      '--config', '-', release.upload_url.split('{')[0] + '?name=PHASE-X-1.0.0-Windows-x64.exe'], {
      input: `header = "Authorization: Bearer ${token}"\n`, encoding: 'utf8', maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    asset = JSON.parse(output);
  }
  if (asset.size !== data.length || asset.digest !== `sha256:${sha256}`) throw new Error('Uploaded artifact verification failed.');
  if (release.draft) release = await api(`${root}/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) });
  const publishedAsset = release.assets.find(entry => entry.id === asset.id) || asset;
  console.log(JSON.stringify({ release: release.html_url, download: publishedAsset.browser_download_url, bytes: data.length, sha256 }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
