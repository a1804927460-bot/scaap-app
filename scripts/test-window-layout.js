'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const indexHtml = read('src/index.html');
const startupThemeJs = read('src/js/startup-theme.js');
const themeJs = read('src/js/theme.js');
const startScreenJs = read('src/js/start-screen.js');
const sidebarJs = read('src/js/sidebar.js');
const titlebarJs = read('src/js/titlebar.js');
const appJs = read('src/js/app.js');
const themeCss = read('src/styles/theme.css');
const mainCss = read('src/styles/main.css');
const startCss = read('src/styles/start.css');

assert.match(themeCss, /--titlebar-h:\s*38px/);
assert.match(themeCss, /body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
assert.match(mainCss, /\.app-section\s*\{[\s\S]*?top:\s*var\(--titlebar-h\);[\s\S]*?bottom:\s*0;/);
assert.match(indexHtml, /data-section="assistant"[^>]*>[\s\S]*?Messs<\/button>[\s\S]*?data-section="messs"[^>]*>[\s\S]*?Workspace<\/button>/,
  'The title bar must expose Messs before the renamed Workspace entry.');
assert.match(mainCss, /\.titlebar-drag-region\s*\{\s*flex:\s*0\s+0\s+14px;/,
  'The section tabs must stay anchored at the upper-left.');
assert.match(titlebarJs, /const isAssistantSection = section === 'assistant';[\s\S]*?setAssistantFullscreen\(true\)[\s\S]*?section-' \+ \(isAssistantSection \? 'messs' : section\)/,
  'The Messs entry must open the existing AI panel without changing the internal workspace section id.');
assert.match(sidebarJs, /section-tab\[data-section="messs"\][\s\S]*?Workspace[\s\S]*?section-tab\[data-section="assistant"\][\s\S]*?Messs/,
  'Navigation labels must localize the assistant and workspace entries.');
assert.match(mainCss, /\.main-app\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(mainCss, /#search-input\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;/);
assert.doesNotMatch(sidebarJs, /file-list-storage-badge|badge\.textContent\s*=\s*t\('Library',\s*'资料库'\)/, 'The redundant Library badge must stay removed.');
assert.doesNotMatch(sidebarJs, /file-list-storage-badge[\s\S]{0,180}innerHTML/, 'The Library label must stay text-only.');
assert.match(mainCss, /\.file-list:not\(\.is-folder-contents\) \.file-item\s*\{\s*padding-left:\s*28px;/, 'Root file thumbnails must align with the folder icon column.');
assert.match(indexHtml, /id="add-folder-btn"[\s\S]*?<svg[\s\S]*?<path d="M12 10v6M9 13h6"/);
const foldersJs = read('src/js/folders.js');
assert.match(foldersJs, /createFolder\('', null\)/, 'New sidebar folders must be created at the same root level as Default.');
assert.match(foldersJs, /renderFolderList\(\);[\s\S]*?beginFolderRename\(folder\.id\)/);
assert.match(mainCss, /\.sidebar\.is-density-compact[\s\S]*?\.sidebar\.is-density-minimal/);
const panelResize = read('src/js/panel-resize.js');
assert.match(panelResize, /SIDEBAR_COMPACT_MAX_PX\s*=\s*230/);
assert.match(panelResize, /SIDEBAR_MINIMAL_MAX_PX\s*=\s*200/);
assert.match(panelResize, /new ResizeObserver\(\(\)\s*=>\s*updateSidebarDensity\(sidebar\)\)/);
assert.match(panelResize, /agent:\s*\{[^}]*defaultPx:\s*420/);
assert.match(panelResize, /PANEL_LAYOUT_VERSION\s*=\s*5[\s\S]*?LEGACY_AGENT_DEFAULTS[\s\S]*?savedVersion < PANEL_LAYOUT_VERSION/);
assert.match(panelResize, /LEGACY_AGENT_DEFAULTS\s*=\s*new Set\(\[320,\s*352,\s*360,\s*384,\s*500,\s*560,\s*780\]\)/);
assert.match(mainCss, /\.main-app\s*\{[\s\S]*?--agent-w:\s*clamp\(420px,\s*32vw,\s*820px\)/);
assert.doesNotMatch(mainCss, /@media \(min-width:\s*1920px\)[\s\S]*?--agent-w:\s*500px/);
assert.doesNotMatch(mainCss, /@media \(min-width:\s*2400px\)[\s\S]*?--agent-w:\s*560px/);
assert.match(startCss, /\.start-screen\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
assert.match(startCss, /\.start-title\s*\{[\s\S]*?color:\s*var\(--accent\);[\s\S]*?text-shadow:[^;]*var\(--accent-glow\);/);
assert.match(startCss, /\.start-subtitle\s*\{[\s\S]*?color:\s*var\(--accent\);/);
assert.match(startCss, /\.start-btn\s*\{[\s\S]*?border:[^;]*var\(--accent-soft\);[\s\S]*?box-shadow:[^;]*var\(--accent-glow\);/);
assert.doesNotMatch(startCss, /--brand-blue-bright|rgba\(44,\s*123,\s*224/);
assert.match(main, /function createWindow\(\)\s*\{\s*const initialTheme\s*=\s*normalizeTheme\([\s\S]*?store\.data\.settings\.theme/);
assert.match(main, /new BrowserWindow\(\{[\s\S]*?show:\s*false,[\s\S]*?backgroundColor:\s*WINDOW_BACKGROUND_COLORS\[initialTheme\]/);
assert.match(main, /mainWindow\.loadFile\([\s\S]*?query:\s*\{\s*theme:\s*initialTheme,\s*language:\s*initialLanguage,\s*textSize:\s*initialTextSize\s*\}/);
assert.doesNotMatch(main, /mainWindow\.once\('ready-to-show'/);
assert.match(main, /mainWindow\.webContents\.once\('did-finish-load',[\s\S]*?revealMainWindow/);
assert.match(main, /ipcMain\.on\('window:syncThemeSurface',[\s\S]*?setWindowBackgroundColor\(theme\)/);
assert.match(preload, /syncThemeSurface:\s*\(theme\)\s*=>\s*ipcRenderer\.send\('window:syncThemeSurface',\s*theme\)/);
assert.ok(indexHtml.indexOf('<script src="js/startup-theme.js"></script>') < indexHtml.indexOf('<link rel="stylesheet" href="styles/theme.css"'), 'startup theme must run before CSS');
assert.match(startupThemeJs, /new URLSearchParams\(window\.location\.search\)\.get\('theme'\)/);
assert.match(startupThemeJs, /dataset\.theme\s*=\s*startupTheme\s*===\s*'light'\s*\?\s*'light'\s*:\s*'dark'/);
assert.match(startupThemeJs, /get\('language'\)[\s\S]*?dataset\.language\s*=\s*normalizedStartupLanguage/);
const evaluateStartupTheme = (search) => {
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(startupThemeJs, {
    document,
    URLSearchParams,
    window: { location: { search } }
  });
  return document.documentElement.dataset.theme;
};
assert.strictEqual(evaluateStartupTheme('?theme=light'), 'light');
assert.strictEqual(evaluateStartupTheme('?theme=dark'), 'dark');
assert.strictEqual(evaluateStartupTheme('?theme=LIGHT'), 'dark');
assert.strictEqual(evaluateStartupTheme(''), 'dark');
assert.match(main, /query:\s*\{\s*theme:\s*initialTheme,\s*language:\s*initialLanguage,\s*textSize:\s*initialTextSize\s*\}/);
assert.match(startupThemeJs, /get\('textSize'\)[\s\S]*?dataset\.textSize/);
assert.match(preload, /setTextSize:\s*\(size\)\s*=>\s*ipcRenderer\.invoke\('settings:setTextSize'/);
assert.match(main, /ipcMain\.handle\('settings:setTextSize'[\s\S]*?settings\.textSize\s*=\s*normalized/);
assert.match(appJs, /initTextSizeSettings\(initial\.textSize\)/);
assert.match(indexHtml, /id="text-size-range"[^>]*type="range"[^>]*min="0"[^>]*max="4"/);
assert.match(indexHtml, /id="text-size-label-0"[\s\S]*?id="text-size-label-4"/);
assert.match(sidebarJs, /const TEXT_SIZE_LEVELS[\s\S]*?MutationObserver[\s\S]*?setTextSize/);
assert.match(sidebarJs, /const rawIndex = Number\(range\.value\);[\s\S]*?Number\.isFinite\(rawIndex\)[\s\S]*?applyTextSize\(TEXT_SIZE_LEVELS\[index\]\.id\)/,
  'The text-size slider must preserve index 0 so Extra small can be selected.');
assert.doesNotMatch(sidebarJs, /Number\(range\.value\) \|\| 2/,
  'The text-size slider must not treat its valid minimum value (0) as Medium.');
assert.match(sidebarJs, /TEXT_SIZE_DYNAMIC_SURFACE = '#board-canvas, \.drawflow'[\s\S]*?root\.closest\(TEXT_SIZE_DYNAMIC_SURFACE\)\) return/,
  'Dynamic canvas mounts must bypass synchronous computed-style text scans.');
assert.match(main, /ipcMain\.on\('window:readyForInteraction'[\s\S]*?revealMainWindow\(\)/);
assert.match(preload, /readyForInteraction:\s*\(\)\s*=>\s*ipcRenderer\.send\('window:readyForInteraction'\)/);
assert.match(appJs, /initSidebar\(initial\)/, 'Profile settings must be hydrated before account rendering.');
assert.match(indexHtml, /id="account-popover-name"[^>]*data-profile-field="name"/);
assert.match(indexHtml, /id="account-popover-signature"[^>]*data-profile-field="signature"/);
assert.match(indexHtml, /id="account-footer-name"[^>]*data-profile-field="name"/);
assert.match(indexHtml, /id="account-footer-credits"[^>]*class="account-footer-credits"[^>]*>[\s\S]*?<b>0<\/b>[\s\S]*?<small> points<\/small>/);
assert.match(sidebarJs, /addEventListener\('dblclick',[\s\S]*?beginAccountProfileEdit/);
assert.match(sidebarJs, /account-footer-copy[\s\S]*?addEventListener\('dblclick'[\s\S]*?account-popover'\)\.hidden = false[\s\S]*?beginAccountProfileEdit/);
assert.match(sidebarJs, /event\.key === 'Enter'[\s\S]*?finish\(true\)[\s\S]*?event\.key === 'Escape'[\s\S]*?finish\(false\)/);
assert.match(main, /ipcMain\.handle\('profile:setDisplayName'/);
assert.match(main, /ipcMain\.handle\('profile:setSignature'/);
assert.match(preload, /setProfileDisplayName:\s*\(value\)\s*=>\s*ipcRenderer\.invoke\('profile:setDisplayName',\s*value\)/);
assert.match(preload, /setProfileSignature:\s*\(value\)\s*=>\s*ipcRenderer\.invoke\('profile:setSignature',\s*value\)/);
assert.doesNotMatch(sidebarJs, /account-footer-meta/, 'Membership refreshes must not overwrite the personal signature.');
assert.match(sidebarJs, /function renderAccountFooterCredits\(membership\)[\s\S]*?Math\.max\(0, balance - reserved\)/, 'The sidebar must display available rather than reserved points.');
assert.match(sidebarJs, /function renderMembershipBalance\(membership\)[\s\S]*?renderAccountFooterCredits\(membership\)/, 'Point reservations and settlements must refresh the sidebar label.');
assert.match(mainCss, /\.account-footer-copy\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/);
assert.match(mainCss, /\.sidebar\.is-density-compact \.account-footer-credits small\s*\{\s*display:\s*none;/);
assert.match(mainCss, /\.sidebar\.is-density-minimal[\s\S]*?\.account-footer-copy\s*\{[\s\S]*?display:\s*block;/, 'The minimum sidebar must keep the account name visible.');
assert.match(mainCss, /\.sidebar\.is-density-minimal[\s\S]*?\.account-footer-credits\s*\{[\s\S]*?display:\s*inline-flex;/, 'The minimum sidebar must keep available points visible.');
assert.doesNotMatch(main, /mainWindow\.once\('ready-to-show',\s*revealWindow\)/);
assert.doesNotMatch(themeCss, /html\[data-view="start"\]\s*\{[^}]*--bg-base:/);
assert.match(themeCss, /html\[data-view="start"\]\s+body\s*\{\s*transition:\s*none;/);
assert.doesNotMatch(themeJs, /syncThemeSurface\(appliedTheme\)/);
assert.match(startScreenJs, /setAttribute\('data-view',\s*'main'\);[\s\S]*?syncThemeSurface\(document\.documentElement\.getAttribute\('data-theme'\)/);
assert.match(startScreenJs, /setAttribute\('data-view',\s*'start'\);[\s\S]*?syncThemeSurface\(document\.documentElement\.getAttribute\('data-theme'\)/);
assert.match(main, /ipcMain\.handle\('settings:setTheme',[\s\S]*?setWindowBackgroundColor\(store\.data\.settings\.theme\)/);
assert.match(main, /new Tray\(trayIconPath\(\)\)/, 'Closing to background requires a system tray icon.');
assert.match(main, /mainWindow\.on\('close',[\s\S]*?event\.preventDefault\(\);[\s\S]*?mainWindow\.hide\(\)/, 'The close button must hide the app unless it is really quitting.');
assert.match(main, /label:\s*localizedMessage\('Quit Messs'[\s\S]*?isQuitting = true;[\s\S]*?app\.quit\(\)/, 'The tray must provide an explicit real quit command.');
assert.match(main, /app\.requestSingleInstanceLock\(\)/, 'Launching Messs again should restore the existing background instance.');
assert.match(main, /app\.on\('second-instance', revealMainWindow\)/);
assert.match(main, /new Notification\(\{[\s\S]*?title:\s*sender,[\s\S]*?body:\s*chatNotificationText\(detail\)/, 'Incoming chats need native notifications.');
assert.match(main, /notification\.on\('click',[\s\S]*?revealMainWindow\(\)[\s\S]*?chat:openConversation/, 'Clicking a notification must restore the related conversation.');

console.log('Window layout tests passed.');
