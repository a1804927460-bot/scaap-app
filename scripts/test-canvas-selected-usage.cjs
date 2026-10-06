const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const source = fs.readFileSync('main.js', 'utf8');
  const entry = (file, requestId, kind, charge, canvasId = 'c1') => ({
    id: `file:${file}`, sourceFileId: file, requestId, canvasId,
    name: file, kind, creditsCharged: charge, historicalCreditsCharged: charge,
    credits: charge, estimatedCredits: charge, status: 'succeeded', createdAt: '2026-10-05'
  });
  const sandbox = {
    store: { data: { canvases: [{ id: 'c1', name: 'Canvas' }], canvasUsageLedger: [
      entry('a', 'ra', 'image', 10), entry('b', 'rb', 'video', 20),
      entry('c', 'rc', 'image', 30), entry('legacy', null, 'image', 4),
      entry('other', 'rx', 'image', 99, 'c2')
    ] } },
    ensureCanvasUsageLedger() {}, backfillCanvasUsageEstimate: e => e,
    preserveSettledCanvasUsage: e => e,
    runtimeConfig: { gatewayConfigured: true }, hasAuthenticatedGatewaySession: () => true,
    aiGateway: { getCanvasUsage: async () => ({ details: [
      { requestId: 'ra', kind: 'image', creditsCharged: 12, status: 'succeeded' },
      { requestId: 'rb', kind: 'video', creditsReserved: 25, status: 'reserved' },
      { requestId: 'rc', kind: 'image', creditsCharged: 30, status: 'succeeded' },
      { requestId: 'agent', kind: 'chat', creditsCharged: 100, status: 'succeeded' }
    ] }) }
  };
  // Pending records must not carry a settled debit.
  Object.assign(sandbox.store.data.canvasUsageLedger[1], {
    creditsCharged: null, historicalCreditsCharged: null, credits: null, status: 'pending'
  });
  vm.runInNewContext(source.slice(source.indexOf('async function canvasCreditUsage('),
    source.indexOf('function normalizedVideoModes(')), sandbox);
  const query = (files) => sandbox.canvasCreditUsage('c1', files);
  const selected = await query(['a', 'a', 'b']);
  assert.equal(selected.totals.creditsCharged, 12);
  assert.equal(selected.totals.pendingCredits, 25);
  assert.equal(selected.totals.generations, 2);
  assert.equal(selected.breakdown.chat.generations, 0);
  assert.equal((await query(['legacy'])).totals.creditsCharged, 4);
  for (const ids of [[], ['imported'], ['other']]) {
    assert.equal((await query(ids)).details.length, 0, 'Empty/unbilled selection must not show canvas totals');
  }
  assert.equal((await query()).totals.creditsCharged, 146, 'Whole-canvas reporting stays available');
  sandbox.runtimeConfig.gatewayConfigured = false;
  assert.equal((await query(['a'])).totals.creditsCharged, 10, 'Offline selection uses saved receipts');
  sandbox.runtimeConfig.gatewayConfigured = true;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({ body: '' }));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    const requests = [];
    await page.exposeFunction('queryUsage', async (id, files) => {
      requests.push({ id, files });
      return sandbox.canvasCreditUsage(id, files);
    });
    await page.evaluate(() => {
      window.t = (en, zh) => zh;
      window.activeCanvasId = () => 'c1';
      window.messsAPI = { getCanvasCreditUsage: window.queryUsage };
      AppState.boardItems = [
        { id: '1', fileId: 'a', selected: true },
        { id: '2', fileId: 'b', selected: true },
        { id: '3', fileId: 'c', selected: false }
      ];
    });
    await page.evaluate(() => runMultiMenuAction('usage'));
    assert.deepEqual(requests[0], { id: 'c1', files: ['a', 'b'] });
    assert.equal(await page.locator('#canvas-usage-kicker').textContent(), '所选文件积分用量');
    assert.equal(await page.locator('#canvas-usage-rows tr').count(), 2);
    assert.equal(await page.locator('#canvas-usage-summary strong').first().textContent(), '12');
    await page.evaluate(() => openCanvasUsageDetails('c1'));
    assert.equal(await page.locator('#canvas-usage-summary strong').first().textContent(), '146');
    await page.evaluate(() => openCanvasUsageDetails('c1', [{ isNote: true }]));
    assert.equal(await page.locator('#canvas-usage-rows tr').count(), 0);
    assert.equal(await page.locator('#canvas-usage-empty').textContent(), '所选文件没有 AI 积分使用记录。');
    console.log('Selected usage passed: menu scope, cloud/local receipts, pending charges, empty selection and full canvas.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
