const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="board-overview"></canvas><div id="board-canvas"></div>');
    for(const file of ['src/vendor/leafer-ui.web.min.js','src/vendor/leafer-export.min.js','src/js/board-leafer-layer.js','src/js/theme.js']) await page.addScriptTag({path:path.resolve(file)});
    const source=fs.readFileSync('src/js/board-canvas.js','utf8');
    await page.evaluate('void 0;\n'+source.slice(source.indexOf("const TEXT_NOTE_DEFAULT_COLOR ="),source.indexOf('function textNotePickerColor(')));
    const results=await page.evaluate(async()=>{
      const layer=MesssBoardLeaferLayer;
      layer.init({canvas:document.querySelector('canvas'),width:400,height:200,pixelRatio:1});
      const item={id:'theme-note',isNote:true,text:'Theme test',x:10,y:10,width:300,height:150,fontSize:32,color:'#15171c',colorMode:'auto'};
      window.AppState={boardItems:[item]};
      let renders=0;
      const sync=()=>layer.sync({cacheKey:'unchanged',items:[item],getBounds:()=>({x:10,y:10,w:300,h:150}),getColor:()=> '#ffffff'});
      window.renderBoard=()=>{renders++;sync();};
      const results=[];
      for(const theme of ['dark','light','dark']) {
        applyTheme(theme);sync();
        const img=new Image();img.src=await layer.toDataURL({pixelRatio:1,clip:{x:0,y:0,width:400,height:200}});await img.decode();
        const c=document.createElement('canvas');c.width=400;c.height=200;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        const pixels=ctx.getImageData(0,0,400,200).data;let total=0,count=0;
        for(let i=0;i<pixels.length;i+=4) if(pixels[i+3]>240){total+=pixels[i];count++;}
        results.push({theme,red:total/count,count,dom:textNoteDisplayColor(item),legacy:textNoteDisplayColor({...item,colorMode:undefined}),manual:textNoteDisplayColor({...item,color:'#d12345',colorMode:'manual'})});
      }
      layer.destroy();return {results,renders};
    });
    assert.equal(results.renders,3);
    for(const r of results.results){assert.ok(r.count>100);assert.ok(r.theme==='light'?r.red<40:r.red>220,JSON.stringify(r));assert.equal(r.dom,r.theme==='light'?'#15171c':'#f3f5f8');assert.equal(r.legacy,r.dom);assert.equal(r.manual,'#d12345');}
    console.log('Text theme: live light/dark switching, cached Leafer pixels, editor parity, legacy and custom colors passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
