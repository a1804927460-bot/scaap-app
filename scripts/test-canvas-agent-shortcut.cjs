const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.doesNotMatch(html, /drawflow|canvas-node-mode\.js|id="board-node-mode"|id="board-mode-toggle"|id="board-(?:bottom-)?fullscreen-toggle"/);
  const boardSource = fs.readFileSync(path.join(root, 'src/js/board-canvas.js'), 'utf8');
  assert.doesNotMatch(boardSource, /function (enterBoardFullscreen|toggleBoardFullscreen)/);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/js/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(pathToFileURL(path.join(root, 'src/index.html')).href);
    const source = fs.readFileSync(path.join(root, 'src/js/canvas-workspace.js'), 'utf8');
    for (const name of ['canvasAgentFloatingBounds', 'setCanvasAgentFloating', 'initCanvasAgentFloating', 'positionCanvasAgentFloating']) {
      const start = source.indexOf(`function ${name}(`);
      const end = source.indexOf('\n}', start) + 2;
      await page.evaluate(`window.${name} = ` + source.slice(start, end));
    }
    await page.evaluate('window.handleCanvasAgentShortcut = ' + source.slice(source.indexOf('function handleCanvasAgentShortcut('), source.indexOf('function setCanvasAgentOpen(')));
    await page.evaluate('window.setCanvasAgentOpen = ' + source.slice(source.indexOf('function setCanvasAgentOpen('), source.indexOf('function canvasAgentPrompt(')));
    await page.evaluate(() => {
      delete document.documentElement.dataset.startupPending;
      const board = document.getElementById('board-panel').cloneNode(true);
      document.body.replaceChildren(board);
      document.body.style.cssText = 'display:block;background:#101112';
      board.classList.remove('is-canvas-library');
      board.style.cssText = 'position:fixed;inset:50px 20px;display:flex;width:auto';
      document.getElementById('canvas-library-view').hidden = true;
      document.getElementById('board-workspace-body').hidden = false;
      document.documentElement.dataset.theme = 'dark';
      document.getElementById('board-agent-welcome').hidden = true;
      const row = document.createElement('div');
      row.className = 'board-agent-message is-user';
      row.textContent = '整理这些参考图的艺术风格，保留色彩和材质特征。';
      const strip = document.createElement('div');
      strip.className = 'board-agent-message-files';
      for (let i = 0; i < 5; i++) {
        const img = document.createElement('img');
        img.src = 'assets/canvas-folder-3d.png';
        strip.append(img);
      }
      row.append(strip);
      document.getElementById('board-agent-messages').append(row);
      window.workspaceActive = true;
      window.isBoardWorkspaceActive = () => workspaceActive;
      window.renderCanvasAgentContext = () => {};
      window.syncCanvasAgentReferencesToSelection = () => {};
      window.renderCanvasAgentReferences = () => {};
      window.CanvasWorkspace = { agentReferenceFileIds: new Set(), agentSelectionFileIds: new Set() };
      document.addEventListener('keydown', handleCanvasAgentShortcut, true);
      document.getElementById('board-agent-toggle').addEventListener('click', () => {
        setCanvasAgentOpen(document.getElementById('board-agent-panel').classList.contains('is-hidden'), { focus: true });
      });
    });
    for (const detached of [false, true]) {
      await page.evaluate(value => document.body.classList.toggle('is-detached-canvas-window', value), detached);
      assert.equal(await page.locator('#board-agent-toggle').isVisible(), true);
      await page.locator('#board-agent-toggle').click();
      await page.waitForTimeout(450);
      assert.equal(await page.locator('#board-agent-panel').isVisible(), true);
      assert.equal(await page.locator('#board-agent-panel').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      assert.equal(await page.locator('.board-agent-message-files').evaluate(el => getComputedStyle(el).display), 'flex');
      assert.equal(await page.locator('#board-panel').evaluate(el => el.classList.contains('is-fullscreen')), false);
      await page.evaluate(() => {
        initCanvasAgentFloating();
        document.getElementById('board-panel').style.transform = 'scale(.85)';
        setCanvasAgentFloating(true);
      });
      const initial = await page.evaluate(() => {
        const panel = document.getElementById('board-agent-panel').getBoundingClientRect();
        const viewport = document.getElementById('board-viewport').getBoundingClientRect();
        return { panel, viewport };
      });
      assert.ok(initial.panel.left >= initial.viewport.left + 11);
      assert.ok(initial.panel.right <= initial.viewport.right - 11);
      assert.ok(initial.panel.top >= initial.viewport.top + 11);
      assert.ok(initial.panel.bottom <= initial.viewport.bottom - 11);
      assert.ok(Math.abs((initial.panel.left + initial.panel.right) / 2 - (initial.viewport.left + initial.viewport.right) / 2) < 2,
        'detached Agent starts centered in the visible canvas');
      const floatingBrand = await page.evaluate(() => {
        const drag = document.getElementById('board-agent-drag');
        const logo = drag.querySelector('img');
        const detach = document.getElementById('board-agent-detach');
        const dragRect = drag.getBoundingClientRect();
        const detachRect = detach.getBoundingClientRect();
        return {
          text: drag.querySelector('span')?.textContent.trim(),
          logoVisible: !!logo && getComputedStyle(logo).display !== 'none' && logo.getBoundingClientRect().width > 0,
          clearsControls: dragRect.right <= detachRect.left
        };
      });
      assert.deepEqual(floatingBrand, { text: 'Messs Agent', logoVisible: true, clearsControls: true });
      fs.mkdirSync(path.join(root, 'test-artifacts/canvas-agent'), { recursive: true });
      await page.screenshot({ path: path.join(root, `test-artifacts/canvas-agent/${detached ? 'floating-detached' : 'floating-normal'}.png`) });
      await page.evaluate(() => {
        positionCanvasAgentFloating(400, 110);
      });
      const handle = page.locator('#board-agent-drag');
      const grab = await handle.boundingBox();
      const before = await page.locator('#board-agent-panel').boundingBox();
      await page.mouse.move(grab.x + 30, grab.y + 20);
      await page.mouse.down();
      await page.mouse.move(grab.x - 90, grab.y + 30, { steps: 5 });
      await page.mouse.up();
      const after = await page.locator('#board-agent-panel').boundingBox();
      assert.ok(Math.abs(after.x - before.x + 120) < 2, `drag preserves horizontal grab offset: ${JSON.stringify({ before, after })}`);
      assert.ok(Math.abs(after.y - before.y - 10) < 2, `drag preserves vertical grab offset: ${JSON.stringify({ before, after })}`);
      await page.evaluate(() => positionCanvasAgentFloating(10000, 10000));
      const bounded = await page.evaluate(() => {
        const panel = document.getElementById('board-agent-panel').getBoundingClientRect();
        const viewport = document.getElementById('board-viewport').getBoundingClientRect();
        return { panel, viewport };
      });
      assert.ok(bounded.panel.right <= bounded.viewport.right - 11);
      assert.ok(bounded.panel.bottom <= bounded.viewport.bottom - 11);
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(450);
      assert.equal(await page.locator('#board-agent-panel').isVisible(), false);
      assert.equal(await page.locator('#board-agent-panel').evaluate(el => el.classList.contains('is-floating') || !!el.style.left || !!el.style.height), false);
      await page.evaluate(() => document.getElementById('board-panel').style.removeProperty('transform'));
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(450);
      assert.equal(await page.locator('#board-agent-panel').isVisible(), true);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', ctrlKey: true, repeat: true, bubbles: true })));
      assert.equal(await page.locator('#board-agent-panel').isVisible(), true);
      await page.screenshot({ path: path.join(root, `test-artifacts/canvas-agent/${detached ? 'detached' : 'normal'}.png`) });
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(450);
    }
    const rapid = await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', ctrlKey: true, bubbles: true }));
      }
      return document.getElementById('board-agent-panel').classList.contains('is-hidden');
    });
    assert.equal(rapid, true);
    await page.waitForTimeout(30);
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'board-agent-input');
    await page.evaluate(() => { workspaceActive = false; });
    await page.keyboard.press('Control+Space');
    assert.equal(await page.locator('#board-agent-panel').isVisible(), false);
    console.log('Agent button, Ctrl+Space, repeat protection and normal/detached layouts passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
