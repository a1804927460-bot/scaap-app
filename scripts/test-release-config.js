'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadRuntimeConfig } = require('../lib/runtime-config');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const runtime = loadRuntimeConfig(root, { packaged: true });
const builder = fs.readFileSync(path.join(root, 'electron-builder.release.yml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const catalog = require('../config/provider-catalog.json');

assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(runtime.githubOwner, 'a1804927460-bot');
assert.equal(runtime.githubRepo, 'messs-releases');
assert.match(builder, /provider:\s*github/);
assert.match(builder, /owner:\s*a1804927460-bot/);
assert.match(builder, /repo:\s*messs-releases/);
assert.match(builder, /private:\s*false/);
assert.match(workflow, /secrets\.RELEASES_TOKEN/);
assert.match(workflow, /secrets\.CSC_LINK/);
assert.match(workflow, /secrets\.CSC_KEY_PASSWORD/);
assert.match(pkg.scripts['release:win'], /--publish never/);
assert.doesNotMatch(pkg.scripts['release:win'], /--publish always/);
assert.match(workflow, /Get-AuthenticodeSignature/);
assert.match(workflow, /signature\.Status -ne 'Valid'/);
assert.match(workflow, /MESSS_SIGNING_ENABLED/);
assert.match(workflow, /signature\.Status -ne 'NotSigned'/);
assert.match(workflow, /CSC_LINK and CSC_KEY_PASSWORD must be configured together/);
assert.match(workflow, /choco install libreoffice-fresh imagemagick\.app/);
assert.match(workflow, /Copy-Item \$libreOffice build-resources\/tools\/libreoffice -Recurse/);
assert.match(workflow, /Copy-Item \$imageMagick\.FullName build-resources\/tools\/imagemagick -Recurse/);
assert.match(builder, /extraResources:[\s\S]*?from:\s*build-resources\/tools[\s\S]*?to:\s*tools/);
assert.match(workflow, /gh release (?:create|upload)/);
assert.ok(
  workflow.indexOf('Verify updater artifacts') < workflow.indexOf('Publish verified updater artifacts'),
  'Updater artifacts must be verified before publication.'
);
assert.match(main, /owner:\s*'a1804927460-bot'/);
assert.match(main, /repo:\s*'messs-releases'/);
assert.match(html, /class="ai-provider-section cloud-security-section" hidden aria-hidden="true"/);
assert.match(html, /class="ai-provider-section ai-provider-chat-section direct-ai-provider-section" hidden aria-hidden="true"/);
assert.ok(catalog.version >= 8);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.kind === 'image').map((provider) => provider.name),
  ['Nano Banana Pro', 'Nanobanana Pro SE', 'Seedream 5.0 Lite', 'Midjourney', 'Nano banana2', 'GPT Image 2']
);
assert.equal(catalog.providers.find((provider) => provider.name === 'MiniMax H3').requiresActivation, false);
assert.equal(catalog.providers.every((provider) => provider.requiresActivation === false), true);

console.log('Release configuration tests passed.');
