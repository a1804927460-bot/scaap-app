const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const detached of [false, true]) {
      const page = await browser.newPage();
      await page.route('**/js/app.js', route => route.fulfill({body:''}));
      await page.goto(pathToFileURL(path.resolve('src/index.html')).href + (detached ? '?detachedCanvas=canvas-a' : ''));
      await page.evaluate(() => {
        window.t = (en,zh) => zh;
        window.renderCanvasAgentReferences = () => {};
        window.renderCanvasAgentHistory = () => {};
        window.renderAiChatHistory = () => {};
        window.renderAssistantQueue = () => {};
        window.renderAssistantAttachments = () => {};
        window.setAssistantBusy = value => { AiAssistant.busy = value; };
        window.showToast = () => {};
        window.activeCanvasAgentProvider = () => ({providerId:'test',model:'test'});
        window.canvasAgentPrompt = text => 'Canvas A context: ' + text;
        AppState.activeCanvasId = 'canvas-a'; AppState.files = []; AppState.boardItems = [];
        AppState.canvases = [{id:'canvas-a',name:'A'},{id:'canvas-b',name:'B'}];
        window.calls = []; window.listeners = new Set(); window.downloads = [];
        window.messsAPI = {
          onAiChatDelta: fn => {listeners.add(fn); return () => listeners.delete(fn);},
          chatWithAi: request => new Promise(resolve => calls.push({request,resolve})),
          saveCanvasAgentHistory: async () => ({}), saveAiAssistantHistory: async () => ({}),
          setAiPermissionMode: async () => ({mode:'ask'}),
          saveGeneratedAiFile: async token => {downloads.push(token); return {ok:true};}
        };
        window.emit = (index,text) => listeners.forEach(fn => fn({requestId:calls[index].request.workRequestId,text}));
        window.startCanvas = text => {document.getElementById('board-agent-input').value=text; window.canvasTask=submitCanvasAgentMessage();};
        window.mainId = ensureAiChatSession('Main private').id;
        window.mainTask = executeAssistantMessage({sessionId:mainId,kind:'chat',prompt:'Main private',attachments:[],provider:{model:'test'},permissionSession:MesssComposerActions.session,options:{}});
        startCanvas('Canvas private'); window.canvasId = CanvasWorkspace.activeAgentSessionId;
      });
      await page.waitForFunction(() => calls.length === 2);
      const requests = await page.evaluate(() => calls.map(call => call.request));
      assert.notEqual(requests[0].permissionSession, requests[1].permissionSession);
      assert.ok(!JSON.stringify(requests[0].messages).includes('Canvas private'));
      assert.ok(!JSON.stringify(requests[1].messages).includes('Main private'));
      await page.evaluate(() => {emit(0,'MAIN STREAM');emit(1,'CANVAS STREAM');});
      assert.match(await page.locator('#ai-assistant-messages').innerText(), /MAIN STREAM/);
      assert.doesNotMatch(await page.locator('#ai-assistant-messages').innerText(), /CANVAS STREAM/);
      await page.evaluate(() => {
        CanvasWorkspace.agentReferenceFileIds.add('old-reference');
        startNewCanvasAgentChat(); ensureCanvasAgentSession('Other canvas conversation');
        window.otherId=CanvasWorkspace.activeAgentSessionId;
        startNewAiChat();
        calls[0].resolve({ok:true,text:'MAIN FINAL',files:[{name:'main.txt',token:'main-token'}]});
        calls[1].resolve({ok:true,text:'CANVAS FINAL',files:[{name:'canvas.txt',token:'canvas-token'}]});
      });
      await page.evaluate(() => Promise.all([mainTask,canvasTask]));
      assert.equal(await page.evaluate(() => MesssComposerActions.sessionFor('canvas',canvasId)), requests[1].permissionSession);
      assert.notEqual(await page.evaluate(() => MesssComposerActions.sessionFor('canvas',otherId)), requests[1].permissionSession);
      assert.doesNotMatch(await page.locator('#board-agent-messages').innerText(), /CANVAS FINAL/);
      assert.doesNotMatch(await page.locator('#ai-assistant-messages').innerText(), /MAIN FINAL/);
      assert.deepEqual(await page.evaluate(() => CanvasWorkspace.agentSessions.find(s=>s.id===otherId).messages), []);
      assert.equal(await page.evaluate(() => CanvasWorkspace.agentReferenceFileIds.size), 0);
      await page.evaluate(() => {loadCanvasAgentSession(canvasId);loadAiChatSession(mainId);});
      assert.match(await page.locator('#board-agent-messages').innerText(), /CANVAS FINAL/);
      assert.match(await page.locator('#ai-assistant-messages').innerText(), /MAIN FINAL/);
      assert.equal(await page.locator('#board-agent-messages .is-pending').count(),0);
      // Force reconstruction from saved history rather than cached DOM.
      await page.evaluate(() => {startNewCanvasAgentChat();CanvasWorkspace.agentSessionViews.clear();loadCanvasAgentSession(canvasId);startNewAiChat();AiAssistant.sessionViews.clear();loadAiChatSession(mainId);});
      assert.match(await page.locator('#board-agent-messages').innerText(), /canvas.txt/);
      assert.doesNotMatch(await page.locator('#board-agent-messages').innerText(), /main.txt/);
      assert.match(await page.locator('#ai-assistant-messages').innerText(), /main.txt/);
      await page.locator('#board-agent-messages .ai-assistant-output-file').evaluate(button => button.click());
      await page.locator('#ai-assistant-messages .ai-assistant-output-file').evaluate(button => button.click());
      assert.deepEqual(await page.evaluate(() => downloads), ['canvas-token','main-token']);
      await page.evaluate(() => {startCanvas('Failing turn');emit(2,'PARTIAL CANVAS');loadCanvasAgentSession(otherId);calls[2].resolve({ok:false,message:'failure'});});
      await page.evaluate(() => canvasTask);
      assert.doesNotMatch(await page.locator('#board-agent-messages').innerText(), /PARTIAL CANVAS|failure/);
      await page.evaluate(() => loadCanvasAgentSession(canvasId));
      assert.match(await page.locator('#board-agent-messages').innerText(), /PARTIAL CANVAS/);
      assert.equal(await page.evaluate(() => listeners.size),0);
      await page.close();
    }
    console.log('PASS: main/canvas concurrent streams, navigation, restored files, partial failures and detached canvas isolation.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
