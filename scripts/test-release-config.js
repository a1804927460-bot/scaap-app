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
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const updaterUi = fs.readFileSync(path.join(root, 'src', 'js', 'updater.js'), 'utf8');
const installerInclude = fs.readFileSync(path.join(root, 'build-resources', 'installer.nsh'), 'utf8');
const catalog = require('../config/provider-catalog.json');

assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(runtime.githubOwner, 'a1804927460-bot');
assert.equal(runtime.githubRepo, 'scaap-releases');
assert.match(builder, /provider:\s*github/);
assert.match(builder, /owner:\s*a1804927460-bot/);
assert.match(builder, /repo:\s*scaap-releases/);
assert.match(builder, /private:\s*false/);
assert.match(builder, /perMachine:\s*true/);
assert.match(builder, /allowElevation:\s*true/);
assert.match(builder, /packElevateHelper:\s*true/);
assert.match(builder, /oneClick:\s*true/);
assert.match(builder, /compression:\s*normal/);
assert.match(builder, /useZip:\s*false/);
assert.doesNotMatch(builder, /useZip:\s*true/, 'Large Windows installers must not use the failing NSIS ZIP extraction path.');
assert.doesNotMatch(builder, /allowToChangeInstallationDirectory:\s*true/);
assert.match(builder, /include:\s*build-resources\/installer\.nsh/);
assert.match(installerInclude, /\$\{isUpdated\}[\s\S]*?taskkill\.exe[\s\S]*?\/F[\s\S]*?APP_EXECUTABLE_FILENAME/);
assert.doesNotMatch(installerInclude, /taskkill\.exe[^\r\n]*\/T/, 'The installer must not terminate its own child process tree.');
assert.doesNotMatch(installerInclude, /Get-CimInstance|powershell\.exe/i, 'Installer initialization must not block on WMI or PowerShell.');
assert.doesNotMatch(installerInclude, /taskkill\.exe[^\r\n]*(?:soffice|ffmpeg|magick)/i, 'Bundled helpers must be terminated by install path, not a broad image-name match.');
assert.match(installerInclude, /!macro customInstall[\s\S]*?\$\{isUpdated\}[\s\S]*?CreateShortCut "\$newStartMenuLink"/);
assert.match(installerInclude, /!macro repairDesktopShortcut[\s\S]*?CreateShortCut "\$newDesktopLink"/);
assert.match(installerInclude, /!ifndef BUILD_UNINSTALLER[\s\S]*?desktopShortcutWasPresent[\s\S]*?IfFileExists "\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"[\s\S]*?repairDesktopShortcut/);
assert.match(workflow, /secrets\.RELEASES_TOKEN/);
assert.match(workflow, /secrets\.CSC_LINK/);
assert.match(workflow, /secrets\.CSC_KEY_PASSWORD/);
assert.match(pkg.scripts['release:win'], /--publish never/);
assert.doesNotMatch(pkg.scripts['release:win'], /--publish always/);
assert.match(pkg.scripts['release:mac'], /--mac --publish never/);
assert.match(builder, /mac:[\s\S]*?target:[\s\S]*?target: dmg[\s\S]*?arch:[\s\S]*?x64[\s\S]*?arm64[\s\S]*?target: zip/);
assert.match(builder, /mac:[\s\S]*?hardenedRuntime:\s*true/);
assert.match(workflow, /Get-AuthenticodeSignature/);
assert.match(workflow, /Get-Command 7z\.exe/);
assert.match(workflow, /Windows installer payload failed the 7-Zip integrity test/);
assert.match(workflow, /signature\.Status -ne 'Valid'/);
assert.match(workflow, /MESSS_SIGNING_ENABLED/);
assert.match(workflow, /signature\.Status -ne 'NotSigned'/);
assert.match(workflow, /CSC_LINK and CSC_KEY_PASSWORD must be configured together/);
assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY=false/);
assert.match(workflow, /Do not export empty CSC_LINK\/CSC_KEY_PASSWORD values/);
assert.match(workflow, /macos-release:/);
const workflowJobs = require('js-yaml').load(workflow).jobs;
for (const name of ['windows-release', 'macos-release']) {
  const steps = workflowJobs[name].steps;
  const install = steps.findIndex(step => step.run === 'npm --prefix gateway ci');
  assert.ok(install >= 0 && install < steps.findIndex(step => step.run === 'npm test'), `${name} must install gateway dependencies before testing.`);
}
assert.match(workflow, /latest-mac\.yml/);
assert.match(workflow, /runs-on:\s*macos-14/);
assert.doesNotMatch(workflow, /runs-on:\s*macos-13/);
assert.match(workflow, /release\/\*\.dmg/);
assert.match(workflow, /choco install libreoffice --no-progress/);
assert.match(workflow, /soffice\.exe/);
assert.match(workflow, /choco install imagemagick\.app/);
assert.match(workflow, /Copy-Item \$libreOffice build-resources\/tools\/libreoffice -Recurse/);
assert.match(workflow, /Copy-Item \$imageMagick build-resources\/tools\/imagemagick -Recurse/);
assert.match(builder, /extraResources:[\s\S]*?from:\s*build-resources\/tools[\s\S]*?to:\s*tools/);
assert.match(builder, /files:[\s\S]*?node_modules\/ffmpeg-static\/\*\*\/\*/);
assert.match(builder, /asarUnpack:[\s\S]*?node_modules\/ffmpeg-static\/\*\*\/\*/);
assert.match(builder, /asarUnpack:[\s\S]*?node_modules\/pdfjs-dist\/\*\*\/\*/);
assert.ok(
  preload.indexOf('fs.existsSync(unpackedPath)') < preload.indexOf('fs.existsSync(devPath)'),
  'Packaged PDF.js must resolve from app.asar.unpacked before the virtual asar path.'
);
assert.match(workflow, /gh release (?:create|upload)/);
assert.ok(
  workflow.indexOf('Verify updater artifacts') < workflow.indexOf('Publish verified updater artifacts'),
  'Updater artifacts must be verified before publication.'
);
assert.match(main, /owner:\s*'a1804927460-bot'/);
assert.match(main, /repo:\s*'scaap-releases'/);
assert.match(main, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
assert.match(main, /autoUpdater\.autoInstallOnAppQuit\s*=\s*updaterState\.enabled/);
assert.match(main, /autoUpdater\.quitAndInstall\(false,\s*true\)/);
assert.doesNotMatch(main, /autoUpdater\.quitAndInstall\(true,\s*true\)/);
assert.doesNotMatch(main, /quitAndInstall\([\s\S]{0,160}setTimeout\(\(\)\s*=>\s*app\.exit/);
assert.match(updaterUi, /\['available',\s*'downloading',\s*'downloaded',\s*'installing'\]/);
assert.match(updaterUi, /status\s*===\s*'installing'[\s\S]*?Opening installer/);
assert.match(updaterUi, /update-banner-progress[\s\S]*?aria-valuenow[\s\S]*?fill\.style\.width/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8'), /class="ai-performance-switch"/, 'Generation composer must use the fixed canvas mode switch only.');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', 'js', 'board-canvas.js'), 'utf8'), /class="ai-prompt-style-(?:new|editor|cover-upload)"/, 'Generation composer must select skills without authoring them inline.');
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
    'Nano Banana Pro', 'Nano Banana 2', 'GPT Image 2', 'GPT Image 2.5', 'Midjourney V8.2'
  ]
);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.kind === 'video' && provider.hidden !== true).map((provider) => provider.name),
  [
    'MiniMax H3', 'Seedance 2.0', 'Seedance 2.5', 'Kling'
  ]
);
assert.deepEqual(
  catalog.providers.filter((provider) => provider.hidden === true).map((provider) => provider.id),
  ['atlas-image-gpt2', 'atlas-video-seedance20-i2v', 'atlas-video-seedance20-ref', 'atlas-video-seedance25-i2v', 'atlas-video-seedance25-ref', 'legacy-image-2', 'image-3', 'image-4', 'image-5', 'legacy-image-gpt2', 'image-7', 'image-8', 'image-9', 'image-10', 'image-11', 'image-12', 'image-13', 'image-14', 'image-15', 'image-16', 'atlas-video-minimax-h3-i2v', 'atlas-video-minimax-h3-ref', 'legacy-video-minimax-h3', 'video-4', 'video-5', 'video-6', 'video-7', 'video-8', 'video-9', 'video-10', 'video-11', 'video-12', 'video-13', 'image-17', 'aireiter-image-nano-pro', 'aireiter-image-gpt2', 'aireiter-image-midjourney81', 'aireiter-video-minimax-h3', 'aireiter-video-seedance20', 'aireiter-video-seedance25', 'aireiter-video-kling-v3', 'aireiter-video-kling-o3', 'aireiter-chat-luna', 'chat-2']
);
assert.equal(catalog.providers.find((provider) => provider.name === 'MiniMax H3').requiresActivation, false);
const miniMaxH3 = catalog.providers.find((provider) => provider.id === 'video-1');
assert.equal(miniMaxH3.keyEnv, 'AIREITER_API_KEY');
assert.equal(miniMaxH3.protocol, 'aireiter-async');
assert.match(miniMaxH3.endpoint, /aireiter\.com\/api\/openapi\/submit$/);
assert.equal(miniMaxH3.capabilities.upstreamRoutes, undefined);
assert.equal(miniMaxH3.capabilities.videoModes.some((mode) => mode.id === 'text'), false);
assert.equal(catalog.providers.every((provider) => provider.requiresActivation === false), true);

console.log('Release configuration tests passed.');
