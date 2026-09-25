const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', r => { if (/https?:/.test(r.url())) requests.push(r.url()); });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const tools = document.getElementById('text-tool-panel');
      document.body.innerHTML = '<div id="board-viewport" style="position:fixed;inset:0"><canvas id="board-leafer-canvas"></canvas><div id="board-canvas" class="board-canvas" data-board-renderer="leafer"></div></div>';
      document.body.append(tools);
      window.note = { id:'rich-test',isNote:true,text:'Hello canvas',x:40,y:40,width:600,height:200,fontSize:32,fontWeight:'400',fontFamily:'inherit',align:'left',colorMode:'auto',color:'#15171c' };
      AppState.boardItems = [note]; Board.panX = Board.panY = 0; Board.zoom = 1;
      window.opts = { getBounds: item => ({ x:item.x,y:item.y,w:600,h:200 }) };
      window.layer = MesssBoardLeaferLayer;
      layer.init({canvas:document.getElementById('board-leafer-canvas'),width:1000,height:600,pixelRatio:1});
      layer.sync({items:[note],...opts}); Board.leaferLayer = layer;
      window.realMakeDraggable = makeBoardItemDraggable;
      makeBoardItemDraggable = () => {};
      syncBoardLeaferItems = item => layer.updateItem(item, opts);
      scheduleBoardItemMeasurement = () => {};
      window.messsAPI = { upsertBoardItem: item => { window.savedNote = JSON.parse(JSON.stringify(item)); } };
      document.getElementById('board-canvas').append(buildTextNoteEl(note));
      beginTextNoteEditing(note, document.querySelector('.board-text-note-content'));
    });
    assert.equal(await page.locator('[data-richtext-editor]').count(), 1);
    await page.locator('[data-richtext-editor]').fill('Hello canvas 中文');
    await page.evaluate(() => {
      const node = layer.getTextDrawable(note.id);
      if (!(node instanceof LeaferUI.UI)) throw new Error('Plugin loaded a second Leafer engine');
      if (node.text !== 'Hello canvas 中文') throw new Error('Input did not reach RichText');
      node.selectionStart = 0; node.selectionEnd = 5;
      note.fontWeight = '700'; applyTextNoteStyle(note);
      if (node.getStyleAt(0).fontWeight !== '700') throw new Error('Selected style missing');
      if (String(node.fontWeight) !== '400') throw new Error('Selection changed whole-text weight');
      document.getElementById('text-italic').click();
      document.getElementById('text-underline').click();
      if (!node.getStyleAt(0).italic || node.getStyleAt(0).textDecoration !== 'under') throw new Error('Rich toolbar style missing');
      if (node.getStyleAt(6).italic) throw new Error('Italic leaked outside selection');
      note.align = 'center'; applyTextNoteStyle(note);
      if (node.textAlign !== 'center' || note.align !== 'center') throw new Error('Paragraph alignment lost on selected text');
      note.align = 'left'; applyTextNoteStyle(note);
      commitActiveTextNote();
    });
    assert.equal(await page.locator('[data-richtext-editor]').count(), 0);
    const saved = await page.evaluate(() => savedNote);
    assert.equal(saved.text, 'Hello canvas 中文');
    assert.ok(saved.styleRanges.some(range => range.start === 0 && range.end === 5 && range.fontWeight === '700'));
    const result = await page.evaluate(() => {
      const clone = new MesssCanvasPlugins.RichText(savedNote);
      const restored = clone.toJSON().styleRanges;
      clone.destroy();
      for (const zoom of [.25, 1, 4]) {
        const bounds = { x:0,y:0,w:100,h:100 };
        for (const distance of [19.9, 20.1]) {
          const snap = MesssCanvasPluginAdapter.snap(bounds, [{x:100+distance/zoom,y:300,w:100,h:100}], zoom);
          if (Math.abs(snap.dx*zoom - (distance < 20 ? distance : 0)) > .001) throw new Error('Incorrect screen-space snap threshold');
          if (snap.lines.length > 2) throw new Error('Unbounded guide count');
        }
      }
      return restored;
    });
    assert.ok(result.length);
    await page.evaluate(() => {
      const node = layer.getTextDrawable(note.id);
      layer.updateItem(note, opts);
      const relayout = node._relayout;
      let count = 0;
      node._relayout = function (...args) { count++; return relayout.apply(this, args); };
      note.selected = true; layer.updateItem(note, opts);
      note.selected = false; layer.updateItem(note, opts);
      node._relayout = relayout;
      if (count) throw new Error('Selection unnecessarily relaid out rich text');
    });
    for (let i=0; i<5; i++) {
      await page.evaluate(() => beginTextNoteEditing(note, document.querySelector('.board-text-note-content')));
      await page.locator('[data-richtext-editor]').fill('Canceled edit');
      await page.evaluate(() => cancelActiveTextNoteEditing());
      assert.equal(await page.evaluate(() => note.text), saved.text);
      assert.deepEqual(await page.evaluate(() => note.styleRanges), saved.styleRanges);
      assert.equal(await page.locator('[data-richtext-editor]').count(), 0);
    }
    await page.evaluate(() => beginTextNoteEditing(note, document.querySelector('.board-text-note-content')));
    await page.locator('[data-richtext-editor]').fill('Long canvas text with wrapping and complete content.\n'.repeat(50));
    await page.evaluate(() => {
      const bounds = boardItemBounds(note), node = layer.getTextDrawable(note.id);
      if (bounds.h <= 200 || node.height !== bounds.h) throw new Error('Live typing did not expand the text bounds');
      if (Board.spatialIndex.getBounds(note.id).h !== bounds.h) throw new Error('Live typing left stale hit bounds');
      cancelActiveTextNoteEditing();
    });
    assert.equal(await page.evaluate(() => note.text), saved.text);
    assert.equal(requests.length, 0, 'Canvas text must not be sent to public font servers');
    fs.mkdirSync('test-artifacts/canvas-plugins', { recursive: true });
    await page.screenshot({ path: 'test-artifacts/canvas-plugins/rich-text.png' });
    await page.evaluate(() => layer.destroy());
    await page.evaluate(() => {
      const host = document.getElementById('board-canvas'); host.replaceChildren();
      AppState.boardItems = [
        {id:'a',x:0,y:0,width:100,height:100,selected:true},
        {id:'b',x:110,y:0,width:100,height:100,selected:true},
        {id:'target',x:250,y:480,width:100,height:100}
      ];
      Board.itemsById = new Map(AppState.boardItems.map(item => [item.id,item]));
      Board.spatialIndex = { query: bounds => new Set(AppState.boardItems.filter(item => (
        item.x <= bounds.x + bounds.w && item.x + item.width >= bounds.x
        && item.y <= bounds.y + bounds.h && item.y + item.height >= bounds.y
      )).map(item => item.id)) };
      isBoardUiEventTarget = () => false;
      pauseBoardElementMedia = markBoardInteraction = addResizeHandles = syncBoardLeaferItems = updateBoardItemIndex = scheduleBoardReconcile = recordBoardMoveHistory = persistBoardMoveHistory = syncBoardSelectionGroup = () => {};
      ensureBoardSelectionGroup = () => null;
      for (const item of AppState.boardItems) {
        const el = document.createElement('div'); el.className = 'board-item'; el.dataset.boardId = item.id;
        el.style.cssText = `left:${item.x}px;top:${item.y}px;width:100px;height:100px`;
        host.append(el); realMakeDraggable(el,item);
      }
    });
    await page.mouse.move(20,20); await page.mouse.down(); await page.mouse.move(58,30);
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => AppState.boardItems[0].x),40);
    assert.equal(await page.evaluate(() => AppState.boardItems[1].x-AppState.boardItems[0].x),110);
    assert.ok(await page.locator('.board-snap-guides i').count() > 0);
    await page.mouse.up();
    assert.equal(await page.locator('.board-snap-guides').count(),0);
    console.log('Canvas plugins: rich input/style serialization/cancel cleanup, 20px long-range snap across zoom and no external font requests passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
