const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    const updaterSource = fs.readFileSync(path.join(root, 'src/js/updater.js'), 'utf8');
    await page.addInitScript({ content: `${updaterSource}\nwindow.renderUpdaterStateForTest = renderUpdaterState;` });
    await page.route('**/*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    await page.evaluate(() => {
      window.t = (en, zh) => zh;
      renderUpdaterStateForTest({ enabled: true, status: 'downloading', currentVersion: '0.0.124', availableVersion: '0.0.125', progress: 42, platform: 'win32' });
    });
    await page.waitForTimeout(50);
    for (const width of [760, 390]) {
      await page.setViewportSize({ width, height: 700 });
      const layout = await page.locator('#update-banner').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const text = element.querySelector('.update-banner-text').getBoundingClientRect();
        const button = element.querySelector('#update-install-btn').getBoundingClientRect();
        const progress = element.querySelector('.update-banner-progress');
        return {
          visible: !element.hidden,
          withinViewport: bounds.left >= 0 && bounds.right <= innerWidth,
          overlap: !(text.right <= button.left || text.bottom <= button.top || button.bottom <= text.top),
          progressVisible: !progress.hidden,
          progressValue: progress.getAttribute('aria-valuenow'),
          fillWidth: progress.querySelector('span').style.width
        };
      });
      assert.equal(layout.visible, true);
      assert.equal(layout.withinViewport, true);
      assert.equal(layout.overlap, false);
      assert.equal(layout.progressVisible, true);
      assert.equal(layout.progressValue, '42');
      assert.equal(layout.fillWidth, '42%');
      await page.screenshot({ path: path.join(root, `test-artifacts/update-banner-${width}.png`) });
    }
    console.log('Updater download progress and responsive banner passed at 760px and 390px.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
