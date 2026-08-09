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

assert.deepStrictEqual([...SUPPORTED_LANGUAGES], ['en', 'zh', 'ko']);
assert.strictEqual(normalizeLanguage('EN'), 'en');
assert.strictEqual(normalizeLanguage('zh'), 'zh');
assert.strictEqual(normalizeLanguage('KO'), 'ko');
for (const invalid of ['', null, 'ja', 'korean']) assert.strictEqual(normalizeLanguage(invalid), 'ko');

assert.strictEqual(localeForLanguage('en'), 'en-US');
assert.strictEqual(localeForLanguage('zh'), 'zh-CN');
assert.strictEqual(localeForLanguage('ko'), 'ko-KR');
assert.strictEqual(localeForLanguage('bad'), 'ko-KR');

const koreanSamples = {
  'More Settings': '추가 설정',
  Language: '언어',
  'Search files': '파일 검색',
  'Integrated Canvas': '통합 캔버스',
  'Generate image': '이미지 생성',
  'Generate video': '비디오 생성',
  Chat: '채팅',
  Market: '마켓',
  'Software Update': '소프트웨어 업데이트',
  'Sign in to start chatting': '로그인하고 채팅을 시작하세요',
  'Just now': '방금',
  Auto: '자동',
  'AI model': 'AI 모델',
  'Chat image': '채팅 이미지',
  'Organize the selected canvas objects into a clear visual hierarchy.': '선택한 캔버스 개체를 명확한 시각적 계층으로 정리하세요.'
};
for (const [english, korean] of Object.entries(koreanSamples)) {
  assert.strictEqual(translate('ko', english), korean, `Missing Korean translation for ${english}`);
  assert.strictEqual(translate('en', english), english);
  assert.strictEqual(translate('zh', english), english);
}

assert.strictEqual((indexSource.match(/class="[^"]*\blanguage-switch\b[^"]*"/g) || []).length, 1, 'Language selector must only appear once.');
const selectorIndex = indexSource.indexOf('class="language-switch');
assert.ok(selectorIndex > indexSource.indexOf('id="ai-provider-overlay"'), 'Language selector must be inside More Settings.');
assert.ok(selectorIndex < indexSource.indexOf('id="detail-overlay"'), 'Language selector must not leak outside More Settings.');
const languageChoices = [...indexSource.matchAll(/<button class="language-opt[^>]*data-language-choice="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
  .map((match) => [match[1], match[2].trim()]);
assert.deepStrictEqual(languageChoices, [['en', 'English'], ['zh', '中文'], ['ko', '한국어']]);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-language-'));
try {
  const freshStore = new Store(tempRoot);
  assert.strictEqual(freshStore.data.settings.language, 'ko', 'Fresh installs must default to Korean.');
  freshStore.data.settings.language = 'ko';
  freshStore.save();
  const restoredStore = new Store(tempRoot);
  assert.strictEqual(restoredStore.data.settings.language, 'ko', 'Saved Korean choice must survive restart.');

  const raw = JSON.parse(fs.readFileSync(restoredStore.dataPath, 'utf8'));
  delete raw.settings.language;
  fs.writeFileSync(restoredStore.dataPath, JSON.stringify(raw), 'utf8');
  assert.strictEqual(new Store(tempRoot).data.settings.language, 'ko', 'Older stores without a language must fall back to Korean.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

assert.match(mainSource, /language:\s*currentLanguage\(\)/, 'Initial renderer state must use the normalized saved language.');
assert.match(mainSource, /query:\s*\{\s*theme:\s*initialTheme,\s*language:\s*initialLanguage\s*\}/, 'The saved language must reach the renderer before its first paint.');
const initialStateHandler = mainSource.slice(
  mainSource.indexOf("ipcMain.handle('app:getInitialState'"),
  mainSource.indexOf("ipcMain.handle('settings:setTheme'")
);
assert.doesNotMatch(initialStateHandler, /await\s+hydrateMissingMediaMetadata|await\s+syncGatewayAccount/, 'Slow startup maintenance must not block interaction.');
assert.match(mainSource, /settings:setLanguage[\s\S]*?settings\.language\s*=\s*normalizeLanguage\(language\)[\s\S]*?scheduleSave\(\)/, 'Language IPC must normalize and persist Korean.');
assert.match(chatSource, /function refreshChatLanguage\(\)/, 'Chat needs an immediate language refresh path.');
assert.match(chatSource, /addEventListener\('messs:language-changed',\s*refreshChatLanguage\)/, 'Chat refresh must run whenever the language changes.');
assert.strictEqual((packageData.scripts.test.match(/node scripts\/test-language-localization\.js/g) || []).length, 1);

process.stdout.write('Language localization tests passed.\n');
