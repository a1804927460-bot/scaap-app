'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const root = path.join(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-chat-visual-'));
  const htmlPath = path.join(tempDir, 'fixture.html');
  const themeUrl = pathToFileURL(path.join(root, 'src', 'styles', 'theme.css')).href;
  const chatUrl = pathToFileURL(path.join(root, 'src', 'styles', 'chat.css')).href;
  const logoUrl = pathToFileURL(path.join(root, 'src', 'assets', 'logo-mark.png')).href;
  const emojiModuleUrl = pathToFileURL(path.join(root, 'node_modules', 'emoji-picker-element', 'index.js')).href;
  const emojiDataUrl = pathToFileURL(path.join(root, 'src', 'assets', 'emoji-data-en.json')).href;
  const icon = (pathData) => `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${pathData}"/></svg>`;

  fs.writeFileSync(htmlPath, `<!doctype html>
    <html data-theme="light"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${themeUrl}"><link rel="stylesheet" href="${chatUrl}"><script type="module" src="${emojiModuleUrl}"></script>
      <style>.chat-section{position:fixed;inset:0}.chat-message-list{justify-content:flex-end}.chat-thread-panel{display:block!important}</style>
    </head><body><section class="chat-section"><div class="chat-shell is-thread-open" data-status="online">
      <nav class="chat-nav-rail">
        <button class="chat-rail-avatar"><img src="${logoUrl}" alt=""></button>
        <div class="chat-nav-actions">
          <button class="chat-nav-button is-active">${icon('M20 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4z')}</button>
          <button class="chat-nav-button">${icon('M3.5 19a5.5 5.5 0 0 1 11 0M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6')}</button>
          <button class="chat-nav-button">${icon('M12 3c2.5 0 3.8 2.4 2.5 4.4M20 8c1.2 2.2-.2 4.6-2.7 4.5M17 19c-2.1 1.4-4.6.1-4.6-2.4')}</button>
        </div><span class="chat-rail-status"></span>
      </nav>
      <aside class="chat-people-panel">
        <form class="chat-user-search">${icon('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l4 4')}<input placeholder="Search email or ID"><button>Search</button></form>
        <section class="chat-side-view"><section class="chat-conversations-panel">
          <div class="chat-list-heading"><span>Messages</span></div>
          <div class="chat-conversation-list"><button class="chat-conversation-row is-active"><span class="chat-avatar"><img src="${logoUrl}" alt=""></span><span class="chat-conversation-copy"><strong>Design team</strong><small>Latest project preview</small></span><span class="chat-conversation-time">18:24</span></button></div>
        </section></section>
      </aside>
      <main class="chat-thread-panel"><section class="chat-thread">
        <header class="chat-thread-head"><span class="chat-avatar"><img src="${logoUrl}" alt=""></span><span class="chat-thread-copy"><strong>Design team</strong><small>3 members</small></span></header>
        <div class="chat-message-list"><article class="chat-message is-other"><span class="chat-message-bubble">Please review this version.</span></article><article class="chat-message is-own"><span class="chat-message-bubble">Looks good.</span></article></div>
        <form class="chat-composer"><textarea placeholder="Type a message..."></textarea><div class="chat-composer-toolbar"><button class="chat-tool-button" aria-expanded="true">${icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18')}</button><button class="chat-tool-button">${icon('M3 5h18v14H3z')}</button></div><emoji-picker class="chat-emoji-popover" style="display:block" data-source="${emojiDataUrl}" locale="en"></emoji-picker><button class="chat-send-button"><img class="chat-send-logo" src="${logoUrl}" alt=""><span class="chat-send-divider"></span>${icon('M12 19V5M6 11l6-6 6 6')}</button></form>
      </section></main>
    </div></section></body></html>`, 'utf8');

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, offscreen: true }
  });
  await window.loadFile(htmlPath);
  await wait(500);
  const layout = await window.webContents.executeJavaScript(`(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
    const navButtons = [...document.querySelectorAll('.chat-nav-button')];
    const listStyle = getComputedStyle(document.querySelector('.chat-people-panel'));
    const threadStyle = getComputedStyle(document.querySelector('.chat-thread-panel'));
    const sendStyle = getComputedStyle(document.querySelector('.chat-send-button'));
    const picker = document.querySelector('.chat-emoji-popover');
    const pickerStyle = getComputedStyle(picker);
    const emoji = picker.shadowRoot && picker.shadowRoot.querySelector('.tabpanel .emoji-menu .emoji');
    const emojiStyle = emoji ? getComputedStyle(emoji) : null;
    const message = picker.shadowRoot && picker.shadowRoot.querySelector('.message');
    const emojiCount = picker.shadowRoot ? picker.shadowRoot.querySelectorAll('.emoji-menu .emoji').length : 0;
    return { nav:rect('.chat-nav-rail'), people:rect('.chat-people-panel'), thread:rect('.chat-thread-panel'), composer:rect('.chat-composer'), send:rect('.chat-send-button'), picker:rect('.chat-emoji-popover'), pickerBackground:pickerStyle.backgroundColor, pickerScrollbar:pickerStyle.scrollbarColor, emojiFontSize:emojiStyle && emojiStyle.fontSize, emojiLoaded:Boolean(emoji), emojiCount, pickerMessage:message && message.textContent, navHasText:navButtons.some((button) => button.textContent.trim()), listBackground:listStyle.backgroundColor, threadBackground:threadStyle.backgroundColor, sendBackground:sendStyle.backgroundImage, avatarImage:rect('.chat-rail-avatar img') };
  })()`);
  if (layout.nav.width < 62 || layout.nav.width > 66 || layout.navHasText) throw new Error(`Chat icon rail is not compact: ${JSON.stringify(layout)}`);
  if (layout.people.width < 268 || layout.listBackground === layout.threadBackground) throw new Error(`Chat list hierarchy is not visible: ${JSON.stringify(layout)}`);
  if (layout.send.width < 76 || layout.send.height < 36 || !layout.sendBackground.includes('linear-gradient')) throw new Error(`Chat send capsule lost its glass layout: ${JSON.stringify(layout)}`);
  if (layout.avatarImage.width < 40 || layout.avatarImage.height < 40 || layout.send.right > layout.composer.right) throw new Error(`Chat avatar or send control overflowed: ${JSON.stringify(layout)}`);
  if (layout.picker.width < 400 || layout.picker.height < 100 || layout.emojiFontSize !== '30px' || !layout.emojiLoaded || layout.emojiCount < 20 || !layout.pickerScrollbar.includes('rgb')) throw new Error(`Emoji picker redesign is not applied: ${JSON.stringify(layout)}`);

  const artifactDir = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'chat-redesign.png'), (await window.webContents.capturePage()).toPNG());

  window.setSize(720, 640);
  await wait(180);
  const compact = await window.webContents.executeJavaScript(`(() => { const composer=document.querySelector('.chat-composer').getBoundingClientRect(); const send=document.querySelector('.chat-send-button').getBoundingClientRect(); return {composerRight:composer.right,sendRight:send.right,sendBottom:send.bottom,height:window.innerHeight}; })()`);
  if (compact.sendRight > compact.composerRight || compact.sendBottom > compact.height) throw new Error(`Compact chat send control overflowed: ${JSON.stringify(compact)}`);

  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.stdout.write(`CHAT_VISUAL_OK nav=${Math.round(layout.nav.width)} send=${Math.round(layout.send.width)}x${Math.round(layout.send.height)}\n`);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
