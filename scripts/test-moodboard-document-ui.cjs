const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.documentElement.dataset.theme = 'dark';
      document.body.replaceChildren();
      document.body.style.cssText = 'background:#121415;display:block';
      const canvas = document.createElement('canvas'); canvas.id = 'board-overview'; document.body.append(canvas);
      window.t = (en, zh) => zh;
      window.makeBoardItemDraggable = () => {};
      window.syncMountedBoardItemGeometry = (el, item) => { el.style.cssText = `position:absolute;left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px`; };
      const host = document.createElement('div'); host.id = 'board-canvas'; host.className = 'board-canvas'; host.dataset.boardRenderer = 'leafer';
      host.style.cssText = 'position:absolute;inset:0;transform:none'; document.body.append(host);
      window.items = [
        { id:'a', isMoodboard:true, moodboardTitle:'灯光与空间', moodboardText:'柔和侧光勾勒金属轮廓。\n\n低饱和银灰与冷白光，保留材质细节和舞台纵深。', x:48,y:64,width:400,height:300 },
        { id:'b', isMoodboard:true, moodboardTitle:'文字情绪板 2', moodboardText:'a'.repeat(110), x:490,y:64,width:320,height:300,selected:true }
      ];
      items.forEach(item => host.append(buildBoardMoodboardElement(item)));
      MesssBoardLeaferLayer.init({canvas,width:1100,height:740,pixelRatio:1});
      window.draw = zoom => {
        MesssBoardLeaferLayer.sync({items,cacheKey:String(zoom),getBounds:item=>({x:item.x,y:item.y,w:item.width,h:item.height}),getColor:()=> '#202223'});
        MesssBoardLeaferLayer.setTransform({panX:0,panY:0,zoom});
        host.style.transformOrigin='0 0'; host.style.transform=`scale(${zoom})`;
      };
    });
    fs.mkdirSync('test-artifacts/moodboard-document', { recursive:true });
    for (const zoom of [1,0.7,1.2]) {
      await page.evaluate(zoom => draw(zoom), zoom);
      await page.waitForTimeout(350);
      assert.ok(await page.locator('.board-moodboard-generate').first().isVisible());
      await page.screenshot({path:`test-artifacts/moodboard-document/zoom-${zoom}.png`});
    }
    await page.evaluate(() => { items[1].width=260; items[1].selected=false; draw(0.9); });
    assert.equal(await page.evaluate(() => MesssBoardLeaferLayer.itemCount), 2);
    await page.evaluate(() => MesssBoardLeaferLayer.destroy());
    console.log('Moodboard document UI: Leafer rendering, DOM icon overlay, zoom and resize passed.');
  } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
