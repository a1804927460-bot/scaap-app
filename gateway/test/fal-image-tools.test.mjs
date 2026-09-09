import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertFalConfigured, falResizeInput, normalizeFalResizeOptions, normalizeFalEnhanceOptions, runFalImageTool } from '../src/fal-image-tools.js';
import falPricing from '../../lib/fal-pricing.js';
const png = fs.readFileSync(new URL('../../src/assets/canvas-folder-3d.png', import.meta.url));
const input = `data:image/png;base64,${png.toString('base64')}`;
test('FAL legacy offsets and price tiers agree with submitted resolution', async () => {
  const options = await normalizeFalResizeOptions(input, { left: 100, right: 100, up: 0, down: 0 });
  assert.ok(options.width > 200);
  assert.equal(falPricing.quoteFalTool('background-remove').credits, 1);
  assert.equal(falPricing.quoteFalTool('clipdrop-uncrop', { width: 1024 }).credits, 31);
  assert.equal(falPricing.quoteFalTool('clipdrop-uncrop', { width: 4096 }).credits, 54);
  assert.equal(falResizeInput(input, { width: 4096, height: 1024 }).resolution, '4K');
});
test('fal key aliases and input limits', () => {
  assert.equal(assertFalConfigured({ FAL_API_KEY: 'new', FAL_KEY: 'old' }), 'new');
  assert.throws(() => assertFalConfigured({}), { code: 'provider-not-configured' });
  assert.deepEqual(falResizeInput(input, { width: 1920, height: 1080 }).target_sizes, ['1920x1080']);
  assert.throws(() => falResizeInput(input, { width: 5000, height: 1080 }));
});
for (const model of ['smart-resize', 'feynobg', 'topaz/upscale/image']) {
  test(`${model} queues then downloads the documented result shape`, async () => {
    let step = 0;
    const output = await runFalImageTool(model, input, { width: 1024, height: 1024 }, {
      env: { FAL_API_KEY: 'test-key' }, sleep: async () => {},
      fetchImpl: async (url, options) => {
        step++;
        if (step === 1) {
          assert.equal(options.headers.Authorization, 'Key test-key');
          assert.equal(JSON.parse(options.body).image_url, input);
          if (model === 'topaz/upscale/image') {
            assert.equal(JSON.parse(options.body).model, 'Standard MAX');
            assert.equal(JSON.parse(options.body).upscale_factor, 2);
            assert.equal(JSON.parse(options.body).output_format, 'png');
            assert.equal(JSON.parse(options.body).face_enhancement, false);
          }
          return Response.json({ request_id: 'task-1' });
        }
        if (step === 2) return Response.json({ status: 'IN_QUEUE' });
        if (step === 3) return Response.json({ status: 'COMPLETED' });
        if (step === 4) return Response.json(model === 'smart-resize'
          ? { images: [{ url: 'https://fal.media/result.png' }] }
          : { image: { url: 'https://fal.media/result.png' } });
        assert.equal(options.headers.Authorization, undefined);
        return new Response(png, { headers: { 'Content-Type': 'image/png' } });
      }
    });
    assert.deepEqual(output, png);
  });
}

test('Topaz enhancement derives billed tier from real image bytes', async () => {
  const options = await normalizeFalEnhanceOptions(input);
  assert.ok(options.megapixels >= 1 && options.megapixels <= 24);
  assert.equal(falPricing.quoteFalTool('clipdrop-upscale', options).credits, 13);
  assert.throws(() => falPricing.quoteFalTool('clipdrop-upscale', {megapixels:25}));
  const sharp = (await import('sharp')).default;
  const large = await sharp({create:{width:3000,height:2100,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(normalizeFalEnhanceOptions('data:image/png;base64,'+large.toString('base64')));
});
