const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true });
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1000}});
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML='<div id="board-viewport" style="position:fixed;inset:0;background:#101112"><canvas id="text-canvas"></canvas><div id="board-canvas" class="board-canvas" data-board-renderer="leafer"></div></div>';
      window.note={id:'long-text',isNote:true,x:30,y:30,width:675,height:160,fontSize:32,fontWeight:'400',color:'#ffffff',colorMode:'custom',text:('\u821e\u7f8e\u89c6\u89c9\u8bbe\u8ba1\u4e0e\u52a8\u6001\u5149\u5b66\u63a7\u5236 Houdini 18s\n').repeat(16),styleRanges:[{start:0,end:8,fontSize:48,fontWeight:'700'}]};
      AppState.boardItems=[note]; Board.filesById=new Map();
      window.layer=MesssBoardLeaferLayer;
      layer.init({canvas:document.getElementById('text-canvas'),width:1280,height:1000,pixelRatio:1});
      window.opts={getBounds:boardItemBounds};
      layer.sync({items:[note],...opts});layer.setVisible(true);
      makeBoardItemDraggable=()=>{};
      const element=buildTextNoteEl(note);document.getElementById('board-canvas').append(element);
      window.paint=(zoom)=>{
        Board.zoom=zoom;layer.updateItem(note,opts);layer.setTransform({zoom,panX:0,panY:0,sync:true});
        syncMountedBoardItemGeometry(element,note);
        document.getElementById('board-canvas').style.transform=`scale(${zoom})`;
      };
      paint(.35);
    });
    fs.mkdirSync('test-artifacts/text-bounds',{recursive:true});
    for(const width of [675,950,360]) {
      for(const zoom of [.35,1,2]) {
        const result=await page.evaluate(({width,zoom})=>{
          note.width=width;paint(zoom);
          const bounds=boardItemBounds(note),node=layer.getTextDrawable(note.id);
          const last=node._lineMetrics.at(-1);
          const el=document.querySelector('.board-text-note');
          return {bounds,height:node.height,contentBottom:last.y+last.height+6,
            maxLineWidth:Math.max(...node._lineMetrics.map(line=>{const c=line.chars.at(-1);return c?c.x+c.width:0;})),
            domWidth:el.offsetWidth,domHeight:el.offsetHeight,text:node.text,overflow:node.textOverflow};
        },{width,zoom});
        assert.equal(result.bounds.w,width);
        assert.equal(result.domWidth,width,'DOM must not retain the old 560px width cap');
        assert.equal(result.domHeight,Math.round(result.bounds.h));
        assert.equal(result.height,result.bounds.h);
        assert.ok(result.contentBottom<=result.height+1,'Full text must fit inside its selection/hit box');
        assert.ok(result.maxLineWidth<=width-10+1,'Rich text wraps at the actual board width');
        assert.equal(result.overflow,'hide');
        assert.ok(result.text.includes('Houdini'),'Text is preserved, not truncated');
        if(zoom===.35) {
          await page.waitForTimeout(100);
          const pixels=await page.evaluate(()=>{
            const b=boardItemBounds(note),z=Board.zoom,c=document.getElementById('text-canvas');
            const bottom=Math.ceil((b.y+b.h)*z)+2;
            const data=c.getContext('2d').getImageData(Math.ceil(b.x*z),bottom,Math.floor(b.w*z),Math.max(1,1000-bottom)).data;
            let outside=0;for(let i=3;i<data.length;i+=4)if(data[i])outside++;
            const inside=c.getContext('2d').getImageData(Math.floor(b.x*z),Math.floor(b.y*z),Math.ceil(b.w*z),Math.ceil(b.h*z)).data;
            let painted=0;for(let i=3;i<inside.length;i+=4)if(inside[i])painted++;
            return {outside,painted};
          });
          assert.equal(pixels.outside,0,'No text pixels may spill below the board bounds');
          assert.ok(pixels.painted>100,'Text must actually paint inside the bounds');
          await page.screenshot({path:`test-artifacts/text-bounds/text-${width}.png`});
        }
      }
    }
    const cached=await page.evaluate(()=>{
      const proto=MesssCanvasPlugins.RichText.prototype,original=proto._measureText;
      let count=0;proto._measureText=function(...args){count++;return original.apply(this,args);};
      for(let i=0;i<100;i++)boardItemBounds(note);
      proto._measureText=original;return count;
    });
    assert.equal(cached,0,'Unchanged bounds must use cached layout');
    console.log('Text bounds passed: long CJK text, mixed font sizes, full content, resize/zoom, matching DOM/hit geometry and no overflow pixels.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
