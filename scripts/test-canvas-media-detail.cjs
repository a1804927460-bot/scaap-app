const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-detail-'));
  const artifacts = path.resolve('test-artifacts/media-detail');
  fs.mkdirSync(artifacts, { recursive: true });
  let app;
  try {
    const stripes = Array.from({ length: 120 }, (_, i) => `<rect x="${i*16}" y="0" width="8" height="1080" fill="#fff"/>`).join('');
    await sharp(Buffer.from(`<svg width="1920" height="1080"><rect width="1920" height="1080" fill="#152a26"/>${stripes}<rect x="100" y="120" width="900" height="420" fill="#2696cf"/><circle cx="1450" cy="520" r="260" fill="#dc4a66"/></svg>`)).png().toFile(path.join(dir, 'image.png'));
    const encoded = spawnSync(require('ffmpeg-static'), ['-y','-loop','1','-i',path.join(dir,'image.png'),'-t','0.2','-pix_fmt','yuv420p',path.join(dir,'video.mp4')], { windowsHide: true });
    assert.equal(encoded.status, 0, String(encoded.stderr));
    app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('scripts/fixtures/canvas-media-detail.cjs')], env: { ...process.env, MESSS_DETAIL_FIXTURE: dir } });
    const page = await app.firstWindow();
    page.on('console', message => { if(message.type()==='error') console.error(message.text()); });
    page.on('pageerror', error => console.error(error.message));
    await page.waitForFunction(() => typeof updateLeaferFullImageWindow === 'function');
    const original = 'data:image/png;base64,' + fs.readFileSync(path.join(dir,'image.png')).toString('base64');
    for (const width of [1440,480]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(width => {
        delete document.documentElement.dataset.startupPending;
        const items = Array.from({length:8}, (_,i) => ({ id:String(i),fileId:`${i%2?'video':'image'}-${i}`,x:16+(i%3)*460,y:16+Math.floor(i/3)*272,width:440,height:247.5 }));
        const files = new Map(items.map((item,i) => [item.fileId,{id:item.fileId,kind:i%2?'video':'image',ext:i%2?'.mp4':'.png',sourceWidth:1920,sourceHeight:1080,url:`messs-file://${item.fileId}`,thumbUrl:`messs-thumb://${item.fileId}`} ]));
        AppState.boardItems=items;
        Object.assign(Board,{disposed:false,zoom:1,visibleIds:new Set(items.filter(item=>item.x<width).map(item=>item.id)),filesById:files,itemsById:new Map(items.map(item=>[item.id,item])),leaferFullItemIds:new Set(),leaferDetailSources:new Map(),leaferSourceByItem:new Map(),mounted:new Map()});
        isBoardViewportInteracting=()=>false;
        boardItemBounds=item=>({x:item.x,y:item.y,w:item.width,h:item.height});
        resolveImageDisplaySource=(file,full)=>full?file.url:file.thumbUrl;
        const layer=MesssBoardLeaferLayer;
        layer.init({canvas:document.getElementById('detail'),width,height:960,pixelRatio:window.devicePixelRatio});
        scheduleBoardLeaferSync=()=>{
          updateLeaferFullImageWindow();
          layer.sync({items,getFile:item=>files.get(item.fileId),getSource:boardLeaferSource,getBounds:boardItemBounds});
          layer.setVisible(true);layer.setTransform({zoom:1,panX:0,panY:0,sync:true});
        };
        scheduleBoardLeaferSync();
      }, width);
      await page.waitForFunction(() => Board.leaferDetailSources.size===Board.visibleIds.size && Board.fullImagePending.size===0, null, {timeout:30000});
      await page.waitForTimeout(400);
      const result=await page.evaluate(async original=>{
        const dimensions=[];
        for(const [id,url] of Board.leaferDetailSources) {
          const image=new Image();image.src=url;await image.decode();
          dimensions.push({id,width:image.naturalWidth,height:image.naturalHeight,url});
        }
        const data=document.getElementById('detail').getContext('2d').getImageData(32,32,350,180).data;
        let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i])opaque++;
        const full=new Image();full.src=original;await full.decode();
        const low=new Image();low.crossOrigin='anonymous';low.src='messs-thumb://image-0';await low.decode();
        const ratio=window.devicePixelRatio;
        const reference=document.createElement('canvas');reference.width=Math.round(440*ratio);reference.height=Math.round(247.5*ratio);
        const ctx=reference.getContext('2d');
        const actual=document.getElementById('detail').getContext('2d').getImageData(Math.round(16*ratio),Math.round(16*ratio),reference.width,reference.height).data;
        ctx.translate(16*ratio-Math.round(16*ratio),16*ratio-Math.round(16*ratio));
        ctx.drawImage(full,0,0,440*ratio,247.5*ratio);
        const expected=ctx.getImageData(0,0,reference.width,reference.height).data;
        ctx.drawImage(low,0,0,440*ratio,247.5*ratio);
        const blurry=ctx.getImageData(0,0,reference.width,reference.height).data;
        let detailError=0,thumbnailError=0;
        for(let i=0;i<actual.length;i+=4)for(let c=0;c<3;c++) {
          detailError+=Math.abs(actual[i+c]-expected[i+c]);
          thumbnailError+=Math.abs(blurry[i+c]-expected[i+c]);
        }
        return {dimensions,opaque,detailError:detailError/actual.length,thumbnailError:thumbnailError/actual.length};
      },original);
      assert.ok(result.dimensions.length>=3);
      assert.ok(result.dimensions.every(image=>image.width>=768),'Every visible image and video must decode detail, not a 400px thumbnail');
      const screenshot = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(artifacts,`detail-${width}.png`),Buffer.from(screenshot,'base64'));
      assert.ok(result.opaque>50000,`Canvas detail textures must actually paint: ${JSON.stringify(result)}`);
      assert.ok(result.detailError<result.thumbnailError,`Detailed texture must improve on the 400px thumbnail: ${JSON.stringify(result)}`);
      console.log({width,previews:result.dimensions.length,detailError:result.detailError,thumbnailError:result.thumbnailError});
    }
    console.log('Electron media detail passed: production protocol, real image/video previews, dense desktop and narrow viewport pixels.');
  } finally {
    if(app)await app.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
