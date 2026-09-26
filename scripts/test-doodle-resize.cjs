const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:900,height:650}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));
  await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  const result=await page.evaluate(()=>{
   document.body.innerHTML='<canvas id="test-canvas"></canvas>';
   const layer=MesssBoardLeaferLayer;
   layer.init({canvas:document.getElementById('test-canvas'),width:900,height:650,pixelRatio:1});
   const points=[[0,0],[99,0],[99,99],[0,99]];
   const item={id:'doodle',isDoodle:true,doodleVersion:3,x:40,y:40,width:100,height:100,doodlePaths:[{points,color:'#06b6d4'}]};
   const sync=()=>layer.sync({cacheKey:Math.random().toString(),items:[item],getBounds:i=>({x:i.x,y:i.y,w:i.width,h:i.height}),getColor:()=> '#06b6d4'});
   const results=[];
   for(const scale of [1,3,.5,2,1]){
    item.width=100*scale;item.height=100*scale;item.x=40*scale;item.y=40*scale;
    sync();
    const node=layer.getTextDrawable('doodle'),stroke=node._messsParts[0];
    results.push({scale,x:stroke.scaleX,y:stroke.scaleY,width:node.width});
   }
   item.doodleSourceWidth=200;item.doodleSourceHeight=100;item.width=400;item.height=300;
   sync();
   const explicit=layer.getTextDrawable('doodle')._messsParts[0];
   return {results,explicit:[explicit.scaleX,explicit.scaleY],points:item.doodlePaths[0].points};
  });
  for(const row of result.results){assert.equal(row.x,row.scale);assert.equal(row.y,row.scale);}
  assert.deepEqual(result.explicit,[2,3]);
  assert.deepEqual(result.points,[[0,0],[99,0],[99,99],[0,99]],'Resizing must not rewrite source paths');
  console.log('Vector doodle resize: existing/new coordinates, repeat scaling and anisotropic dimensions passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
