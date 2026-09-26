const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/js/app.js', route => route.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.style.background = '#080a0e';
      document.body.innerHTML = '<canvas id="scene"></canvas><div id="board-canvas" class="board-canvas" data-board-renderer="leafer"><div class="board-item"><div id="content" class="board-item-content"></div></div></div>';
      const preview = document.createElement('canvas'); preview.width = preview.height = 100;
      const p = preview.getContext('2d'); p.fillStyle = '#111317'; p.fillRect(0,0,100,100);
      p.fillStyle = '#e9b85c'; p.fillRect(30,35,40,40);
      window.file = { id:'f', name:'Model.glb', ext:'.glb',kind:'model',modelPreviewUrl:preview.toDataURL() };
      window.item = {id:'model',fileId:'f',x:60,y:60,width:220,height:220};
      window.note = { id:'text',isNote:true,text:'Canvas text',x:320,y:70,width:260,height:100,fontSize:28,color:'#fff' };
      window.layer = MesssBoardLeaferLayer;
      layer.init({ canvas:document.getElementById('scene'),width:1100,height:800,pixelRatio:1 });
      window.options = {getFile:i => i.fileId ? file : null,getSource:f => f?.modelPreviewUrl || ''};
      layer.sync({items:[item,note],...options});
      renderBoardItemContent(document.getElementById('content'),file,item);
      window.pixel = (x,y) => [...document.getElementById('scene').getContext('2d').getImageData(x,y,1,1).data];
    });
    await page.waitForFunction(() => pixel(170,180)[0] > 200);
    assert.equal(await page.locator('.board-model-caption').count(),0);
    await page.evaluate(async () => {
      for (let i=0;i<45;i++) {
        const zoom = .4 + (i%15)/10, panX=20+i, panY=15;
        document.getElementById('board-canvas').classList.toggle('is-transforming', i%2===0);
        layer.setTransform({zoom,panX,panY,sync:true});
        await new Promise(requestAnimationFrame);
        if (getComputedStyle(document.querySelector('.board-model-thumbnail')).opacity !== '0') throw Error('Duplicate DOM model visible');
        const badge = document.getElementById('scene').getContext('2d').getImageData(Math.floor(panX+70*zoom),Math.floor(panY+70*zoom),Math.ceil(33*zoom),Math.ceil(23*zoom)).data;
        let blue=0; for(let k=0;k<badge.length;k+=4) if(badge[k+2]>180 && badge[k+2]>badge[k]+30) blue++;
        if (!blue) throw Error(`3D label vanished at zoom ${zoom}`);
        if (pixel(Math.round(panX+170*zoom),Math.round(panY+290*zoom))[3]) throw Error('Preview protrudes below bounds');
        const text = document.getElementById('scene').getContext('2d').getImageData(Math.floor(panX+320*zoom),Math.floor(panY+70*zoom),Math.ceil(260*zoom),Math.ceil(100*zoom)).data;
        if (!text.some((v,k) => k%4===3 && v>0)) throw Error('Canvas text vanished');
      }
      layer.setTransform({zoom:1,panX:0,panY:0,sync:true});
    });
    fs.mkdirSync('test-artifacts/model-canvas',{recursive:true});
    await page.screenshot({path:'test-artifacts/model-canvas/preview.png'});
    await page.setViewportSize({width:390,height:700});
    await page.evaluate(() => {
      layer.resize(390,700,1);
      layer.setTransform({zoom:.55,panX:0,panY:0,sync:true});
    });
    await page.screenshot({path:'test-artifacts/model-canvas/compact.png'});
    await page.evaluate(() => layer.destroy());
    console.log('Model single-surface rendering, 3D label, text and bounds stable across 45 zoom frames.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
