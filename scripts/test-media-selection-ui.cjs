const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport:{width:1000,height:800} });
    await page.route('**/js/app.js', r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme='dark';
      document.body.innerHTML='<div id="board-canvas" class="board-canvas" data-board-renderer="leafer"></div>';
      const board=document.getElementById('board-canvas');
      board.style.cssText='position:absolute;left:40px;top:40px;transform-origin:0 0';
      for(const kind of ['image','video','ai-pending']) {
        const el=document.createElement('div');
        el.className=`board-item board-item-${kind} is-selected is-single-selection`;
        el.style.cssText=`position:absolute;left:${kind==='image'?10:200}px;top:10px;width:160px;height:200px`;
        const image=document.createElement('img'); image.src='assets/canvas-folder-3d.png'; image.style.cssText='width:100%;height:100%;object-fit:contain'; el.append(image);
        for(const corner of ['nw','ne','sw','se']) { const h=document.createElement('div');h.className=`board-resize-handle corner-${corner}`;el.append(h); }
        board.append(el);
      }
    });
    fs.mkdirSync('test-artifacts/media-selection',{recursive:true});
    for(const zoom of [0.5,1,2]) {
      await page.evaluate(zoom=>{const b=document.getElementById('board-canvas');b.style.transform=`scale(${zoom})`;b.style.setProperty('--board-expand-hit-size',`${18/zoom}px`);b.style.setProperty('--board-selection-width',`${1.2/zoom}px`);},zoom);
      for(const kind of ['image','video','ai-pending']) {
        const el=page.locator(`.board-item-${kind}`);
        const handle=el.locator('.corner-nw');
        await el.evaluate(el=>el.classList.add('is-selected'));
        await page.locator('#board-canvas').evaluate(board=>board.classList.add('is-transforming'));
        assert.equal(await el.evaluate(el=>getComputedStyle(el).visibility),'visible', 'Selected outline must survive wheel/pan frames');
        assert.equal(await el.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
        assert.equal(await handle.isVisible(),true, 'Selected handles must survive wheel/pan frames');
        assert.equal(await el.locator('img').evaluate(img=>getComputedStyle(img).visibility),'hidden', 'Do not repaint rich DOM content during wheel/pan');
        await el.evaluate(el=>el.classList.remove('is-selected'));
        assert.equal(await el.evaluate(el=>getComputedStyle(el).visibility),'hidden');
        await el.evaluate(el=>el.classList.add('is-selected'));
        await page.locator('#board-canvas').evaluate(board=>board.classList.remove('is-transforming'));
        assert.equal(await el.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
        assert.equal(await handle.isVisible(),true);
        if(kind !== 'ai-pending') assert.ok(Math.abs((await handle.boundingBox()).width-18)<0.1);
        const visual=await handle.evaluate(el=>parseFloat(getComputedStyle(el,'::before').width));
        if(kind !== 'ai-pending') assert.ok(Math.abs(visual*zoom-6)<0.1);
        await el.evaluate(el=>el.classList.remove('is-selected'));
        assert.equal(await el.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
        assert.equal(await handle.isVisible(),false);
        await el.evaluate(el=>el.classList.add('is-selected'));
      }
      await page.screenshot({path:`test-artifacts/media-selection/zoom-${zoom}.png`});
    }
    await page.evaluate(()=>{document.getElementById('board-canvas').classList.add('is-multi-selection');document.querySelectorAll('.board-item').forEach(el=>el.classList.remove('is-single-selection'));});
    assert.equal(await page.locator('.board-item-image').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    console.log('Media selection: selected-only outline, 6px grip, 18px hit area, zoom and multiselection passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
