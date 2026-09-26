'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeLanguage, localeForLanguage, translate, SUPPORTED_LANGUAGES } = require('../lib/i18n');
const { Store } = require('../lib/store');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'src', 'js', 'chat.js'), 'utf8');
const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.deepStrictEqual([...SUPPORTED_LANGUAGES], ['en', 'zh', 'ja']);
assert.strictEqual(normalizeLanguage('EN'), 'en');
assert.strictEqual(normalizeLanguage('zh'), 'zh');
assert.strictEqual(normalizeLanguage('JA'), 'ja');
for (const invalid of ['', null, 'ko', 'korean']) assert.strictEqual(normalizeLanguage(invalid), 'zh');

assert.strictEqual(localeForLanguage('en'), 'en-US');
assert.strictEqual(localeForLanguage('zh'), 'zh-CN');
assert.strictEqual(localeForLanguage('ja'), 'ja-JP');
assert.strictEqual(localeForLanguage('bad'), 'zh-CN');

const japaneseSamples = {
  'More Settings': 'その他の設定',
  Language: '言語',
  'Search files': 'ファイルを検索',
  'Integrated Canvas': '統合キャンバス',
  'Generate image': '画像を生成',
  'Generate video': '動画を生成',
  Chat: 'チャット',
  'Software Update': 'ソフトウェア更新',
  'Sign in to start chatting': 'ログインしてチャットを開始',
  'Just now': 'たった今',
  Auto: '自動',
  'AI model': 'AI モデル',
  'Chat image': 'チャット画像'
};
for (const [english, japanese] of Object.entries(japaneseSamples)) {
  assert.strictEqual(translate('ja', english), japanese, `Missing Japanese translation for ${english}`);
  assert.strictEqual(translate('en', english), english);
  assert.strictEqual(translate('zh', english), english);
}

assert.strictEqual((indexSource.match(/class="[^"]*\blanguage-switch\b[^"]*"/g) || []).length, 1, 'Language selector must only appear once.');
const selectorIndex = indexSource.indexOf('class="language-switch');
assert.ok(selectorIndex > indexSource.indexOf('id="ai-provider-overlay"'), 'Language selector must be inside More Settings.');
assert.ok(selectorIndex < indexSource.indexOf('id="detail-overlay"'), 'Language selector must not leak outside More Settings.');
const languageChoices = [...indexSource.matchAll(/<button class="language-opt[^>]*data-language-choice="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
  .map((match) => [match[1], match[2].trim()]);
assert.deepStrictEqual(languageChoices, [['en', 'English'], ['zh', '中文'], ['ja', '日本語']]);
assert.doesNotMatch(indexSource, /data-i18n-ko|data-language-choice="ko"/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-language-'));
try {
  const freshStore = new Store(tempRoot);
  assert.strictEqual(freshStore.data.settings.language, 'zh', 'Fresh installs must default to Chinese.');
  freshStore.data.settings.language = 'ja';
  freshStore.save();
  const restoredStore = new Store(tempRoot);
  assert.strictEqual(restoredStore.data.settings.language, 'ja', 'Saved Japanese choice must survive restart.');

  const raw = JSON.parse(fs.readFileSync(restoredStore.dataPath, 'utf8'));
  delete raw.settings.language;
  fs.writeFileSync(restoredStore.dataPath, JSON.stringify(raw), 'utf8');
  assert.strictEqual(new Store(tempRoot).data.settings.language, 'zh', 'Older stores without a language must fall back to Chinese.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(mainSource, /language:\s*currentLanguage\(\)/, 'Initial renderer state must use the normalized saved language.');
assert.match(mainSource, /query:\s*\{\s*theme:\s*initialTheme,\s*language:\s*initialLanguage,\s*textSize:\s*initialTextSize\s*\}/, 'The saved language and text size must reach the renderer before its first paint.');
const initialStateHandler = mainSource.slice(
  mainSource.indexOf("ipcMain.handle('app:getInitialState'"),
  mainSource.indexOf("ipcMain.handle('settings:setTheme'")
);
assert.doesNotMatch(initialStateHandler, /await\s+hydrateMissingMediaMetadata|await\s+syncGatewayAccount/, 'Slow startup maintenance must not block interaction.');
assert.match(mainSource, /settings:setLanguage[\s\S]*?settings\.language\s*=\s*normalizeLanguage\(language\)[\s\S]*?scheduleSave\(\)/, 'Language IPC must normalize and persist Japanese.');
assert.match(chatSource, /function refreshChatLanguage\(\)/, 'Chat needs an immediate language refresh path.');
assert.match(chatSource, /addEventListener\('messs:language-changed',\s*refreshChatLanguage\)/, 'Chat refresh must run whenever the language changes.');
assert.strictEqual((packageData.scripts.test.match(/node scripts\/test-language-localization\.js/g) || []).length, 1);

process.stdout.write('Language localization tests passed.\n');
