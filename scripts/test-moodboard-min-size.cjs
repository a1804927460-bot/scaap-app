const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<canvas id="render-test"></canvas><div id="board-canvas" class="board-canvas" data-board-renderer="leafer"></div>';
      document.getElementById('board-canvas').style.cssText = 'position:absolute;inset:0;transform-origin:0 0';
      window.t = (en, zh) => zh;
      window.markBoardInteraction = () => {};
      window.pauseBoardElementMedia = () => {};
      window.updateBoardItemIndex = () => {};
      window.scheduleBoardReconcile = () => {};
      window.syncBoardLeaferItems = () => {};
      window.messsAPI = { upsertBoardItem: async () => {} };
      window.makeBoardItemDraggable = (el, item) => addResizeHandles(el, item);
      MesssBoardLeaferLayer.init({canvas:document.getElementById('render-test'),width:900,height:650,pixelRatio:1});
      window.mountTest = (zoom, width = 360, height = 260) => {
        Board.zoom = zoom;
        Board.selectedCount = 1;
        window.testItem = { id:'min-test',isMoodboard:true,selected:true,x:60,y:70,width,height,moodboardTitle:'Text moodboard',moodboardText:'Light and space' };
        AppState.boardItems = [testItem];
        const host = document.getElementById('board-canvas');
        host.style.transform = `scale(${zoom})`;
        host.replaceChildren(buildBoardMoodboardElement(testItem));
      };
    });
    for (const zoom of [0.25, 1, 2]) {
      for (const [corner, sx, sy] of [['se',1,1],['sw',-1,1],['ne',1,-1],['nw',-1,-1]]) {
        const result = await page.evaluate(({zoom,corner,sx,sy}) => {
          mountTest(zoom);
          const el = document.querySelector('.board-moodboard');
          el.querySelector(`.corner-${corner}`).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:400,clientY:350}));
          document.dispatchEvent(new MouseEvent('mousemove',{clientX:400-sx*1000,clientY:350-sy*1000}));
          document.dispatchEvent(new MouseEvent('mouseup'));
          const rect = el.getBoundingClientRect();
          const button = el.querySelector('.board-moodboard-generate').getBoundingClientRect();
          return { width:testItem.width,height:testItem.height,x:testItem.x,y:testItem.y,domWidth:rect.width/zoom,domHeight:rect.height/zoom,contained:button.right<=rect.right && button.bottom<=rect.bottom };
        }, {zoom,corner,sx,sy});
        assert.equal(result.width,240);
        assert.equal(result.height,170);
        assert.equal(result.domWidth,240);
        assert.equal(result.domHeight,170);
        assert.equal(result.x,sx<0?180:60);
        assert.equal(result.y,sy<0?160:70);
        assert.ok(result.contained);
      }
    }
    const multi = await page.evaluate(() => {
      mountTest(1,360,180);
      const other = {id:'other',x:500,y:70,width:220,height:220,selected:true};
      AppState.boardItems.push(other);
      window.boardSelectionResizeItems = () => [testItem,other];
      window.syncBoardSelectionGroup = () => {};
      window.recordBoardResizeHistory = () => false;
      const group = document.createElement('div');
      startBoardSelectionResize(new MouseEvent('mousedown',{button:0,clientX:800,clientY:500}),{signX:1,signY:1},group);
      document.dispatchEvent(new MouseEvent('mousemove',{clientX:-1000,clientY:-1000}));
      document.dispatchEvent(new MouseEvent('mouseup'));
      return {width:testItem.width,height:testItem.height,otherWidth:other.width};
    });
    assert.equal(multi.height,170,'Multi-selection must respect the height minimum too');
    assert.equal(multi.width,340);
    assert.equal(multi.otherWidth,208,'Group scale stays uniform');
    // Old undersized saved records must render with the same DOM and Leafer bounds.
    const legacy = await page.evaluate(() => {
      mountTest(1,90,40);
      const bounds = boardItemBounds(testItem);
      MesssBoardLeaferLayer.sync({items:[testItem],getBounds:boardItemBounds,cacheKey:'legacy-min'});
      MesssBoardLeaferLayer.setTransform({panX:0,panY:0,zoom:1});
      const rect = document.querySelector('.board-moodboard').getBoundingClientRect();
      return {w:bounds.w,h:bounds.h,domWidth:rect.width,domHeight:rect.height};
    });
    assert.deepEqual(legacy,{w:240,h:170,domWidth:240,domHeight:170});
    fs.mkdirSync('test-artifacts/moodboard-min-size',{recursive:true});
    await page.waitForTimeout(250);
    await page.screenshot({path:'test-artifacts/moodboard-min-size/legacy.png'});
    await page.evaluate(() => MesssBoardLeaferLayer.destroy());
    console.log('Moodboard minimum: four resize corners at 3 zoom levels, anchored geometry, contained controls and legacy bounds passed.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
