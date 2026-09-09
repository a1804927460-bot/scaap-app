'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.route('**/js/app.js',r=>r.fulfill({body:''}));await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
  await page.evaluate(()=>{
    delete document.documentElement.dataset.startupPending;document.documentElement.dataset.theme='dark';AppState.language='zh';AppState.files=[];AppState.canvases=[];
    window.messsAPI={setSidebarCollapsed:async value=>{window.savedCollapsed=value;},listScheduleProjects:async()=>[],listWorkspaceResources:async()=>[]};
    const main=document.getElementById('main-app');main.classList.add('is-visible','is-canvas-only');main.style.setProperty('--sidebar-w','300px');document.getElementById('start-screen').hidden=true;
    document.getElementById('account-auth-screen').hidden=true;document.getElementById('activation-overlay').hidden=true;
    setSidebarCollapsed(false);initPanelResize();
  });
  const toggle=page.locator('#collapse-sidebar-btn');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  fs.mkdirSync('test-artifacts/sidebar-rail',{recursive:true});
  await page.waitForTimeout(650);await page.screenshot({path:'test-artifacts/sidebar-rail/expanded-dark.png'});
  await toggle.click();await page.waitForTimeout(450);
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>savedCollapsed),true);
  const rail=await page.locator('#sidebar').boundingBox();assert.ok(rail.width>=70&&rail.width<=74);
  assert.equal(await page.locator('#file-list-wrap').isVisible(),false);
  for(const selector of ['#sidebar .brand-mark','#collapse-sidebar-btn','#workspace-shortcuts button','#account-menu-open','#settings-btn'])for(const node of await page.locator(selector).all()){assert.ok(await node.isVisible());const rect=await node.boundingBox();assert.ok(rect.x>=rail.x&&rect.x+rect.width<=rail.x+rail.width+1);}
  await page.screenshot({path:'test-artifacts/sidebar-rail/collapsed-dark.png'});
  await page.locator('#workspace-shortcuts [data-workspace-area=schedule]').click();assert.equal(await page.locator('.work-hub').evaluate(e=>e.open),true);await page.locator('[data-hub-action=close]').click();
  await page.locator('.sidebar-rail-actions [aria-label="搜索文件"]').click();await page.waitForTimeout(450);assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#search-input').evaluate(e=>e===document.activeElement),true);
  await toggle.click();await page.setViewportSize({width:900,height:680});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(450);
  const settings=await page.locator('#settings-btn').boundingBox();assert.ok(settings.y+settings.height<=680);await page.screenshot({path:'test-artifacts/sidebar-rail/collapsed-light.png'});
  await toggle.click();await page.waitForTimeout(450);assert.ok((await page.locator('#sidebar').boundingBox()).width>170);
  console.log('PASS expanded default, toggle placement, 72px icon rail, logo/four shortcuts/account retained, search expands, short-window layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
