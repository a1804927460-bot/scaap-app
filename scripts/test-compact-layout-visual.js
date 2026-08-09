'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const engine = require('../src/js/board-engine');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'test-artifacts', 'compact-layout');
const fixturePath = path.join(outputDir, 'fixture.html');

async function main() {
  await app.whenReady();
  fs.mkdirSync(outputDir, { recursive: true });
  const layout = engine.packUniformGrid(Array.from({ length: 12 }, (_, index) => ({
    id: `item-${index}`,
    x: (index % 3) * (70 + index * 8),
    y: Math.floor(index / 3) * (80 + index * 5)
  })), { originX: 56, originY: 74, width: 280, height: 168, gap: 20, columns: 4 });
  const palette = ['#343434', '#202020', '#414141', '#292929', '#383838', '#242424'];
  const items = layout.map((item, index) => `<div class="board-item board-item-image is-uniform-frame" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px">
    <div class="board-item-content" style="background:${palette[index % palette.length]}"><span>${String(index + 1).padStart(2, '0')}</span></div>
  </div>`).join('');
  fs.writeFileSync(fixturePath, `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
    <link rel="stylesheet" href="../../src/styles/theme.css"><link rel="stylesheet" href="../../src/styles/main.css">
    <style>html,body{width:100%;height:100%;margin:0}.visual{height:100%;display:grid;grid-template-columns:210px 1fr;background:var(--bg-base)}.visual aside{padding:24px 18px;background:var(--bg-surface);border-right:1px solid var(--border-hairline)}.visual aside h1{margin:0 0 26px;font-size:24px}.visual aside i{display:block;height:38px;margin:8px 0;border-radius:6px;background:var(--bg-surface-2)}.visual main{display:grid;grid-template-rows:54px 1fr;min-width:0}.visual header{display:flex;align-items:center;padding:0 22px;border-bottom:1px solid var(--border-hairline);background:var(--bg-elevated);font-weight:700}.visual .board-viewport{position:relative}.visual .board-canvas{transform:scale(.72);transform-origin:0 0}.board-item-content{display:grid;place-items:center}.board-item-content span{color:rgba(255,255,255,.38);font-size:30px;font-weight:800}</style>
  </head><body><div class="visual"><aside><h1>Messs.</h1><i></i><i></i><i></i><i></i></aside><main><header>Integrated Canvas · Compact layout</header><div class="board-viewport"><div class="board-canvas">${items}</div></div></main></div></body></html>`, 'utf8');
  const window = new BrowserWindow({ width: 1440, height: 840, show: false, backgroundColor: '#111111' });
  await window.loadFile(fixturePath);
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(outputDir, 'desktop.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(820, 680);
  await new Promise((resolve) => setTimeout(resolve, 160));
  fs.writeFileSync(path.join(outputDir, 'narrow.png'), (await window.webContents.capturePage()).toPNG());
  window.destroy();
  app.quit();
}

main().catch((error) => { console.error(error); app.exit(1); });
