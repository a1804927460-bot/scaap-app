const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div id="board-viewport" style="position:absolute;inset:0"><div id="source" style="position:absolute;left:200px;top:120px;width:500px;height:300px;background:#789"></div></div>';
      window.t = (en, zh) => zh;
      window.closeBoardButlerPanel = () => {};
      window.closeBoardButlerMenu = () => {};
      window.boardItemBounds = i => ({ x:i.x,y:i.y,w:i.width,h:i.height });
      Board.zoom=1; Board.panX=0; Board.panY=0;
      window.pointerLeaks=0; window.keyLeaks=0;
      document.getElementById('board-viewport').addEventListener('pointerdown', () => window.pointerLeaks++);
      document.addEventListener('keydown', e => { if(e.key==='ArrowRight')window.keyLeaks++; });
      openBoardButlerExpandPanel(null,{sourceWidth:1000,sourceHeight:600},{x:200,y:120,width:500,height:300});
    });
    await page.mouse.move(400,250); await page.mouse.down(); await page.mouse.move(460,290); await page.mouse.up();
    assert.equal(await page.evaluate(() => pointerLeaks),0);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => keyLeaks),0);
    const before = await page.locator('[name="width"]').inputValue();
    const handle = await page.locator('.board-inline-resize .is-se').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down(); await page.mouse.move(handle.x+handle.width/2+25,handle.y+handle.height/2+15); await page.mouse.up();
    assert.ok(Number(await page.locator('[name="width"]').inputValue())>Number(before));
    assert.equal(await page.evaluate(() => pointerLeaks),0);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.mouse.click(400,250);
    assert.equal(await page.evaluate(() => pointerLeaks),1);
    const navigation = await page.evaluate(async () => {
      openBoardButlerExpandPanel(null,{sourceWidth:1000,sourceHeight:600},{x:200,y:120,width:500,height:300});
      const frame=document.querySelector('.board-inline-resize-frame');
      const toolbar=document.querySelector('.board-inline-resize-toolbar');
      const before=pointerLeaks;
      frame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:1}));
      frame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,altKey:true}));
      const allowed=!isBoardUiEventTarget(frame), blocked=isBoardUiEventTarget(toolbar);
      const messages=[];window.showToast=message=>messages.push(message);
      window.getBoardButlerTask=()=>{throw Error('4K enhancement must not start a task');};
      for(const [sourceWidth,sourceHeight] of [[3840,2160],[2160,3840],[4096,4096]])
        await runBoardButlerImageTool('imageEnhance',{sourceWidth,sourceHeight},{},{});
      closeBoardButlerExpandEditor();
      return {panEvents:pointerLeaks-before,allowed,blocked,messages};
    });
    assert.equal(navigation.panEvents,2);
    assert.ok(navigation.allowed && navigation.blocked,'Canvas navigation passes through the frame, not the toolbar');
    assert.equal(navigation.messages.length,3);
    assert.ok(navigation.messages.every(message=>message.includes('画质已最高')));
    console.log('Resize input isolation, handle dragging and cleanup passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
