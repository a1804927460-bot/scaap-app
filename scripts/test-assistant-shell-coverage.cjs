const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page = await browser.newPage();
    await page.route('**/js/app.js', r => r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const panel = document.getElementById('ai-assistant-panel');
      panel.hidden = false; panel.style.animation='none';
      setAssistantFullscreen(true);
      const underlay = document.createElement('div'); underlay.id='test-underlay';
      underlay.style.cssText='position:fixed;inset:38px 0 0;background:#ff00ff;z-index:90';
      document.body.append(underlay);
    });
    fs.mkdirSync('test-artifacts/assistant-shell',{recursive:true});
    for (const theme of ['dark','light']) for (const width of [1560,800]) {
      await page.setViewportSize({width,height:800});
      await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
      const result = await page.evaluate(() => {
        const host = document.body;
        const backdrop=getComputedStyle(host,'::before');
        const panel=document.getElementById('ai-assistant-panel').getBoundingClientRect();
        return {content:backdrop.content,bg:backdrop.backgroundColor,bottom:backdrop.bottom,
          gap:innerHeight-panel.bottom, targets:[
            [innerWidth/2,innerHeight-1],[innerWidth/2,40],[1,100],[innerWidth-1,100]
          ].map(([x,y])=>document.elementFromPoint(x,y)?.tagName),
          portaled:document.getElementById('ai-assistant-panel').parentElement===document.body};
      });
      assert.equal(result.content,'""'); assert.equal(result.bottom,'0px');
      assert.notEqual(result.bg,'rgba(0, 0, 0, 0)');
      assert.ok(result.gap<=8.1,JSON.stringify(result)); assert.equal(result.portaled,true);
      assert.deepEqual(result.targets,['BODY','BODY','BODY','BODY']);
      await page.screenshot({path:`test-artifacts/assistant-shell/${theme}-${width}.png`});
    }
    await page.evaluate(() => setAssistantFullscreen(false));
    assert.equal(await page.evaluate(() => getComputedStyle(document.body,'::before').content),'none');
    assert.equal(await page.evaluate(() => document.getElementById('ai-assistant-panel').parentElement.classList.contains('stats-panel')),true);
    console.log('Real fullscreen portal: top/bottom/side coverage in both themes/sizes, restored parent and backdrop removal passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
