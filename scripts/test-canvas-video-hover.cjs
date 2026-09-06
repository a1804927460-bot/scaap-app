const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.resolve('test-artifacts/video-hover');
  fs.mkdirSync(dir, { recursive: true });
  const videoPath = path.join(dir, 'motion.webm');
  const encoded = spawnSync(require('ffmpeg-static'), ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libvpx', '-c:a', 'libopus', videoPath], { windowsHide: true });
  assert.equal(encoded.status, 0, String(encoded.stderr));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(url => {
      delete document.documentElement.dataset.startupPending;
      document.body.innerHTML = '<div class="board-canvas" data-board-renderer="leafer" style="position:relative;transform:none;margin:40px;width:320px;height:180px"><div class="board-item" style="width:320px;height:180px"><div class="board-item-content" style="width:320px;height:180px"></div></div></div>';
      window.scheduleBoardLeaferSync = () => {};
      window.observeBoardMediaIntrinsicRatio = () => {};
      window.loadBoardPreview = async () => ({ type: 'video', url });
      window.fallbacks = 0;
      window.messsAPI = { transcodeVideo: async () => { window.fallbacks++; return { ok: false }; } };
      window.file = { id: 'video', ext: '.webm', name: 'Video', sourceDuration: 4, thumbUrl: '' };
      renderBoardItemContent(document.querySelector('.board-item-content'), file, { id: 'item', width: 320, height: 180 });
    }, pathToFileURL(videoPath).href);
    assert.equal(await page.locator('video').count(), 0, 'No decoder before hover');
    const assertSquareVideo = async () => {
      const radii = await page.locator('.board-item, .board-item-content, .board-video-thumbnail, .board-video-thumbnail > img, .mini-video-player, .mini-video-poster, .mini-video-player > video').evaluateAll(elements => elements.map(el => {
        const css = getComputedStyle(el);
        return [css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomLeftRadius,css.borderBottomRightRadius];
      }));
      assert.ok(radii.length >= 3);
      assert.ok(radii.flat().every(radius => radius === '0px'), JSON.stringify(radii));
    };
    await page.locator('.board-item').evaluate(el => el.classList.add('board-item-video'));
    await assertSquareVideo();
    await page.locator('.board-item').evaluate(el => el.classList.add('is-uniform-frame','is-selected'));
    await assertSquareVideo();
    assert.equal(await page.locator('.board-video-duration').textContent(), '4s');
    assert.equal(await page.locator('.board-video-thumbnail').evaluate(el => getComputedStyle(el).opacity), '1');
    await page.locator('.board-item-content').hover();
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > .2);
    await assertSquareVideo();
    for (const zoom of [0.5, 2, 5]) {
      await page.locator('.board-canvas').evaluate((el, zoom) => {el.style.transformOrigin='0 0';el.style.transform=`scale(${zoom})`;}, zoom);
      await assertSquareVideo();
    }
    await page.locator('.board-canvas').evaluate(el => {el.style.transform='none';});
    const sound = page.locator('.board-video-sound');
    // Headless Chrome can require a gesture for audible autoplay.
    if (await page.locator('video').evaluate(video => video.muted)) await sound.click();
    assert.equal(await page.locator('video').evaluate(video => video.muted), false);
    await sound.click();
    assert.equal(await page.locator('video').evaluate(video => video.muted), true);
    await sound.click();
    assert.equal(await page.locator('video').evaluate(video => video.muted), false);
    const sample = () => page.locator('video').screenshot();
    const first = await sample();
    await page.waitForTimeout(400);
    assert.notDeepEqual(await sample(), first, 'Decoded video pixels must move');
    assert.equal(await page.locator('.mini-video-player').evaluate(el => getComputedStyle(el).opacity), '1');
    for (const width of [1200, 480]) {
      await page.setViewportSize({ width, height: 800 });
      await page.locator('.board-item-content').hover();
      await page.screenshot({ path: path.join(dir, `hover-${width}.png`) });
      const badge = await page.locator('.board-video-duration').boundingBox();
      const item = await page.locator('.board-item-content').boundingBox();
      assert.ok(badge.x > item.x + item.width / 2 && badge.y > item.y + item.height / 2);
    }
    await page.mouse.move(450, 500);
    await page.waitForFunction(() => document.querySelector('video')?.paused);
    await page.waitForFunction(() => !document.querySelector('video'), null, { timeout: 15000 });
    await assertSquareVideo();
    assert.equal(await page.locator('.board-video-duration').textContent(), '4s');
    assert.equal(await page.evaluate(() => fallbacks), 0);
    await page.evaluate(url => {
      const overlay = document.createElement('div');
      overlay.id = 'fullscreen-overlay'; overlay.hidden = true;
      overlay.innerHTML = '<div id="fullscreen-stage" style="width:600px;height:400px"></div>';
      document.body.append(overlay);
      const source = document.createElement('video');
      source.src = url; source.muted = true;
      window.testSource = source;
      openFileFullscreenPreview(file, source);
    }, pathToFileURL(videoPath).href);
    const fullVideo = page.locator('#fullscreen-stage video');
    assert.equal(await fullVideo.evaluate(video => video.muted), false, 'Expanded playback must not inherit hover mute');
    const play = page.locator('.video-play-toggle');
    if (await fullVideo.evaluate(video => video.paused)) await play.click();
    await page.waitForFunction(() => !document.querySelector('#fullscreen-stage video').paused);
    await page.locator('.video-icon-pause').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.video-icon-play').isVisible(), false);
    assert.equal(await page.locator('.video-icon-pause').isVisible(), true);
    await play.click();
    await page.waitForFunction(() => document.querySelector('#fullscreen-stage video').paused);
    await page.locator('.video-icon-play').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.video-icon-play').isVisible(), true);
    assert.equal(await page.locator('.video-icon-pause').isVisible(), false);
    await page.locator('.video-mute-toggle').click();
    await page.locator('.video-icon-muted').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.video-icon-muted').isVisible(), true);
    assert.equal(await page.locator('.video-icon-volume').isVisible(), false);
    await page.evaluate(() => finalizeFullscreenPreviewClose());
    console.log('Video hover passed: real moving frames, Leafer visibility, bottom-right duration, pause and decoder release.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
