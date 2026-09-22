import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { parseImageDataUrl, parseVideoDataUrl } from '../src/ai302-tools.js';
import { runFalImageTool } from '../src/fal-image-tools.js';

const raw = randomBytes(2048 * 2048 * 3);
const pipeline = () => sharp(raw, { raw:{width:2048,height:2048,channels:3} });
let jpeg;

test('multi-megabyte JPEG, PNG and WebP validate without regexp stack overflow', async () => {
  for (const format of ['jpeg','png','webp']) {
    const bytes = await pipeline().toFormat(format, {quality:95}).toBuffer();
    assert.ok(bytes.length > 2 * 1024 * 1024, 'Fixture must exercise large inputs');
    const dataUrl = `data:image/${format};base64,${bytes.toString('base64')}`;
    assert.deepEqual(parseImageDataUrl(dataUrl).buffer, bytes);
    if (format === 'jpeg') jpeg = dataUrl;
    assert.throws(() => parseImageDataUrl(dataUrl,{maxBytes:1024}), {code:'image-too-large'});
  }
});

test('large video input preserves bytes and upload size validation', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 0x61);
  bytes.writeUInt32BE(24,0);
  bytes.write('ftypisom',4,'ascii');
  const dataUrl = `data:video/mp4;base64,${bytes.toString('base64')}`;
  assert.deepEqual(parseVideoDataUrl(dataUrl).buffer,bytes);
  assert.throws(() => parseVideoDataUrl(dataUrl,{maxBytes:1024}), {code:'video-too-large'});
});

test('padding, invalid characters and non-canonical encodings are still rejected', () => {
  const valid = '/9j/2Q==';
  assert.equal(parseImageDataUrl(`data:image/jpeg;base64,${valid}`).buffer.length,4);
  for (const base64 of ['',valid.slice(0,-1),'/9j/2R==','/9j=2Q==','/9j/2Q===','/9j_2Q==','/9j/2Q==\n','====',`${'A'.repeat(8*1024*1024)}!==`]) {
    assert.throws(() => parseImageDataUrl(`data:image/jpeg;base64,${base64}`), error => error.code === 'invalid-image-data' && !(error instanceof RangeError));
  }
});

test('large reference survives actual FAL tool input validation before queue submission', async () => {
  const png = await sharp({create:{width:2064,height:2064,channels:4,background:'#00000000'}}).png().toBuffer();
  for (const model of ['feynobg','smart-resize']) {
    let submissions = 0;
    const output = await runFalImageTool(model,jpeg,{width:2064,height:2064},{
      env:{FAL_KEY:'test-only'}, sleep:async()=>{},
      fetchImpl:async(url,options)=>{
        url = String(url);
        if(options.method==='POST') {
          submissions++;
          const submittedImage = JSON.parse(options.body).image_url;
          if (model === 'feynobg') assert.equal(submittedImage,jpeg);
          else {
            const metadata = await sharp(parseImageDataUrl(submittedImage).buffer).metadata();
            assert.equal(metadata.width,2064);
            assert.equal(metadata.height,2064);
          }
          return Response.json({request_id:'large-image-task'});
        }
        if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});
        if(url.includes('/requests/'))return Response.json(model==='feynobg'
          ? {image:{url:'https://fal.media/large-test.png'}} : {images:[{url:'https://fal.media/large-test.png'}]});
        return new Response(png,{headers:{'Content-Type':'image/png'}});
      }
    });
    assert.equal(submissions,1);
    if (model === 'feynobg') assert.deepEqual(output,png);
    else {
      const restored = await sharp(output).extract({left:8,top:8,width:2048,height:2048}).removeAlpha().raw().toBuffer();
      assert.deepEqual(restored,await sharp(parseImageDataUrl(jpeg).buffer).removeAlpha().raw().toBuffer());
    }
  }
});
