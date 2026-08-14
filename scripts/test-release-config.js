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
const updaterUi = fs.readFileSync(path.join(root, 'src', 'js', 'updater.js'), 'utf8');
const installerInclude = fs.readFileSync(path.join(root, 'build-resources', 'installer.nsh'), 'utf8');
const catalog = require('../config/provider-catalog.json');

assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(runtime.githubOwner, 'a1804927460-bot');
assert.equal(runtime.githubRepo, 'messs-releases');
assert.match(builder, /provider:\s*github/);
assert.match(builder, /owner:\s*a1804927460-bot/);
assert.match(builder, /repo:\s*messs-releases/);
assert.match(builder, /private:\s*false/);
assert.match(builder, /perMachine:\s*true/);
assert.match(builder, /allowElevation:\s*true/);
assert.match(builder, /packElevateHelper:\s*true/);
assert.match(builder, /include:\s*build-resources\/installer\.nsh/);
assert.match(installerInclude, /\$\{isUpdated\}[\s\S]*?taskkill\.exe[\s\S]*?\/F[\s\S]*?APP_EXECUTABLE_FILENAME/);
assert.doesNotMatch(installerInclude, /taskkill\.exe[^\r\n]*\/T/, 'The installer must not terminate its own child process tree.');
assert.match(installerInclude, /Get-CimInstance Win32_Process[\s\S]*?ExecutablePath[\s\S]*?\$INSTDIR\\resources\\tools\\\*[\s\S]*?Invoke-CimMethod -MethodName Terminate/);
assert.doesNotMatch(installerInclude, /taskkill\.exe[^\r\n]*(?:soffice|ffmpeg|magick)/i, 'Bundled helpers must be terminated by install path, not a broad image-name match.');
assert.match(installerInclude, /!macro customInstall[\s\S]*?\$\{isUpdated\}[\s\S]*?CreateShortCut "\$newStartMenuLink"[\s\S]*?CreateShortCut "\$newDesktopLink"/);
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
assert.match(workflow, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)[\s\S]*?choco install libreoffice-fresh[\s\S]*?choco cache remove --all/);
assert.match(workflow, /download\.documentfoundation\.org\/libreoffice\/stable[\s\S]*?Start-Process msiexec\.exe/);
assert.match(workflow, /choco install imagemagick\.app/);
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
assert.match(main, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/);
assert.match(main, /autoUpdater\.quitAndInstall\(false,\s*false\)/);
assert.doesNotMatch(main, /quitAndInstall\([\s\S]{0,160}setTimeout\(\(\)\s*=>\s*app\.exit/);
assert.match(updaterUi, /\['available',\s*'downloading',\s*'downloaded',\s*'installing'\]/);
assert.match(updaterUi, /status\s*===\s*'installing'[\s\S]*?Opening installer/);
assert.match(main, /image-resolution-mismatch[\s\S]*?points were refunded[\s\S]*?积分已退还/);
assert.match(main, /preview\.shutdownProcesses\(\)/);
assert.match(main, /thumbnails\.shutdownProcesses\(\)/);
assert.match(main, /shutdownMediaMetadataProcesses\(\)/);
assert.match(html, /class="ai-provider-section cloud-security-section" hidden aria-hidden="true"/);
assert.match(html, /class="ai-provider-section ai-provider-chat-section direct-ai-provider-section" hidden aria-hidden="true"/);
assert.ok(catalog.version >= 8);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.kind === 'image' && provider.hidden !== true).map((provider) => provider.name),
  [
    'Nano Banana Pro', 'Seedream 5.0', 'Midjourney Turbo', 'GPT Image 2',
    'Higgsfield Soul', 'Seedream 5.0 Pro', 'Kling Image 2', 'Jimeng Drawing 3.0'
  ]
);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.kind === 'video' && provider.hidden !== true).map((provider) => provider.name),
  ['MiniMax H3', 'Seedance 2.0', 'Seedance 2.5']
);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.hidden === true).map((provider) => provider.id),
  ['image-2', 'image-5', 'image-7', 'image-9', 'image-11', 'image-12', 'image-13', 'image-14', 'video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9']
);
assert.equal(catalog.providers.find((provider) => provider.name === 'MiniMax H3').requiresActivation, false);
assert.equal(catalog.providers.every((provider) => provider.requiresActivation === false), true);

console.log('Release configuration tests passed.');
