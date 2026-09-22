const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 740 } });
    const errors = []; page.on('pageerror', error => errors.push(error.stack));
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    errors.length = 0;
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div id="board-viewport" style="position:absolute;inset:0"></div>';
      window.t = (en, zh) => zh;
      window.activeCanvasId = () => 'test-canvas';
      window.closeBoardButlerExpandEditor = () => {};
      window.showToast = message => { window.lastToast = message; };
      window.renderFileList = () => {};
      window.currentFileListScope = () => '';
      window.addFileToBoard = async (...args) => { window.placed = args; };
      window.boardItemBounds = item => ({ x: item.x, y: item.y, w: item.width, h: item.height });
      Board.zoom = 1; Board.panX = 0; Board.panY = 0;
      const c = document.createElement('canvas'); c.width = 800; c.height = 400;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 400, 400); ctx.fillStyle = '#00f'; ctx.fillRect(400, 0, 400, 400);
      window.cropFile = { id: 'source', url: c.toDataURL(), sourceWidth: 800, sourceHeight: 400, ext: '.png' };
      window.cropItem = { id: 'item', x: 100, y: 160, width: 600, height: 300 };
      window.messsAPI = { importCroppedImage: async request => {
        window.cropRequest = request;
        return { ok: true, file: { id: 'cropped', url: request.dataUrl } };
      } };
    });
    await page.evaluate(() => openBoardImageCrop(cropFile, cropItem));
    assert.ok(await page.locator('.board-image-crop').count(), await page.evaluate(() => window.lastToast));
    await page.locator('.board-image-crop select').selectOption('1:1');
    await page.waitForTimeout(250);
    const sizes = await page.evaluate(() => ({ width: boardImageCrop.node.width, height: boardImageCrop.node.height, inner: !!boardImageCrop.app.editor.innerEditor }));
    assert.equal(sizes.inner, true); assert.ok(Math.abs(sizes.width - sizes.height) < 1);
    fs.mkdirSync('test-artifacts/canvas-crop', { recursive: true });
    const frame = await page.evaluate(() => {
      const n=boardImageCrop.node;
      return {x:n.x,y:n.y,width:n.width,height:n.height,sourceX:n.x+n.layerImg.x};
    });
    await page.mouse.move(frame.x+frame.width/2,frame.y+frame.height/2);
    await page.mouse.down();
    await page.mouse.move(frame.x+frame.width/2+60,frame.y+frame.height/2,{steps:10});
    await page.mouse.up();
    const moved=await page.evaluate(()=>({x:boardImageCrop.node.x,sourceX:boardImageCrop.node.x+boardImageCrop.node.layerImg.x}));
    assert.ok(moved.x>frame.x+40,JSON.stringify({frame,moved}));
    assert.ok(Math.abs(moved.sourceX-frame.sourceX)<.1,'Source image must remain stationary');
    await page.mouse.wheel(0,-100);
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(()=>Board.zoom>1),'Wheel must zoom canvas during crop');
    const toolbarPlacement=await page.evaluate(()=>{
      const n=boardImageCrop.node, tree=boardImageCrop.app.tree;
      const t=document.querySelector('.board-image-crop-toolbar').getBoundingClientRect();
      return {bottom:(n.y+n.height)*tree.scaleY+tree.y,top:t.top};
    });
    assert.ok(Math.abs(toolbarPlacement.top-toolbarPlacement.bottom-12)<2,JSON.stringify(toolbarPlacement));
    await page.screenshot({ path: 'test-artifacts/canvas-crop/editor.png' });
    await page.getByRole('button', { name: '确认裁切', exact: true }).click();
    await page.waitForFunction(() => !boardImageCrop || window.lastToast);
    const output = await page.evaluate(async () => {
      if (!window.cropRequest) return { error: window.lastToast };
      const image = new Image(); image.src = cropRequest.dataUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, left: [...ctx.getImageData(20, 20, 1, 1).data], right: [...ctx.getImageData(image.width - 20, 20, 1, 1).data], placed: window.placed };
    });
    assert.equal(output.width, 400, JSON.stringify(output)); assert.equal(output.height, 400);
    assert.deepEqual(output.left, [255, 0, 0, 255]); assert.deepEqual(output.right, [0, 0, 255, 255]);
    assert.equal(output.placed[0], 'cropped');
    await page.evaluate(() => openBoardImageCrop(cropFile, cropItem));
    const beforeDrag = await page.evaluate(() => ({ x:boardImageCrop.node.x, y:boardImageCrop.node.y, width: boardImageCrop.node.width, height: boardImageCrop.node.height }));
    await page.mouse.move(beforeDrag.x+beforeDrag.width, beforeDrag.y+beforeDrag.height);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x+beforeDrag.width-60, beforeDrag.y+beforeDrag.height-40, { steps: 12 });
    await page.mouse.up();
    const afterDrag = await page.evaluate(() => ({ width: boardImageCrop.node.width, height: boardImageCrop.node.height }));
    assert.ok(afterDrag.width < beforeDrag.width && afterDrag.height < beforeDrag.height, 'Corner drag must resize the crop');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.board-image-crop').count(), 0);
    for (const theme of ['dark', 'light']) {
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 740 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await page.evaluate(() => openBoardImageCrop(cropFile, cropItem));
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.board-image-crop-toolbar').evaluate(el => el.scrollWidth > el.clientWidth), false);
        const bar = await page.locator('.board-image-crop-toolbar').boundingBox();
        assert.ok(bar.height <= 46, `Crop controls must remain a single compact row: ${JSON.stringify(bar)}`);
        assert.ok(bar.x >= 11 && bar.x + bar.width <= width - 11, 'Toolbar must stay inside viewport');
        assert.equal(await page.locator('.board-image-crop-toolbar img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
        await page.screenshot({ path: `test-artifacts/canvas-crop/${theme}-${width}.png` });
        await page.getByRole('button', { name: '取消', exact: true }).click();
      }
    }
    await page.setViewportSize({width:1100,height:740});
    await page.evaluate(() => {
      Board.zoom=1;Board.panX=0;Board.panY=0;
      cropItem.y=550;cropItem.width=260;cropItem.height=130;
      return openBoardImageCrop(cropFile,cropItem);
    });
    const bottomLayout=await page.evaluate(()=>({bar:document.querySelector('.board-image-crop-toolbar').getBoundingClientRect().toJSON(),y:boardImageCrop.node.y}));
    assert.ok(bottomLayout.bar.y+bottomLayout.bar.height<bottomLayout.y,'Toolbar should move above a low image');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>!boardImageCrop);
    assert.deepEqual(errors, []);
    console.log('Real crop plugin, ratio, full-resolution pixel export, canvas insertion and cancel passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
