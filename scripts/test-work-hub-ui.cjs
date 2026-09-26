'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const {pathToFileURL}=require('node:url');
const {createScheduleService}=require('../lib/project-schedule');const {createResourceService}=require('../lib/workspace-resources');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const store={data:{files:[{id:'fixture-file',name:'品牌参考.png',ext:'.png'}]},save(){}};
    const service=createScheduleService(store,()=> 'fixture');const resources=createResourceService(store,()=> 'fixture');
    const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    for(const [title,owner,start,due,status,progress] of [['品牌视觉升级','设计团队','02','18','active',65],['新品发布影片','影像团队','05','25','active',35],['包装方案交付','项目负责人','01','10','blocked',80],['官网首页设计','产品团队','01','06','done',100]])service.save({title,owner,start:month+'-'+start,due:month+'-'+due,status,progress,milestones:[{title:'方案评审',date:month+'-'+due}],notes:'测试排期，不是真实项目'});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.exposeFunction('testHubApi',async(action,input)=>{
      const map={listScheduleProjects:()=>service.list(),saveScheduleProject:()=>service.save(input),archiveScheduleProject:()=>service.archive(input),restoreScheduleProject:()=>service.restore(input),listWorkspaceResources:()=>resources.list(),saveWorkspaceResource:()=>resources.save(input),removeWorkspaceResource:()=>resources.remove(input),parseWorkspaceSkill:()=>resources.parseSkill(input)};
      return map[action]();
    });
    await page.route('**/js/app.js',r=>r.fulfill({body:''}));
    await page.goto(pathToFileURL(path.resolve('src/index.html')).href);
    await page.evaluate(()=>{
      document.documentElement.dataset.theme='dark';delete document.documentElement.dataset.startupPending;AppState.language='zh';
      AppState.files=[{id:'fixture-file',name:'品牌参考.png',ext:'.png'}];AppState.canvases=[{id:'fixture-canvas',name:'品牌发布'}];
      window.messsAPI=Object.fromEntries(['listScheduleProjects','saveScheduleProject','archiveScheduleProject','restoreScheduleProject','listWorkspaceResources','saveWorkspaceResource','removeWorkspaceResource','parseWorkspaceSkill'].map(name=>[name,input=>window.testHubApi(name,input)]));
      window.testApplied={};window.setAssistantKind=kind=>window.testApplied.mainKind=kind;window.showCanvasWorkspace=()=>{};window.activeCanvasRecord=()=>AppState.canvases[0];window.renderCanvasAgentModels=()=>{};window.renderCanvasAgentReferences=()=>{};window.setCanvasAgentOpen=open=>window.testApplied.canvasOpen=open;
      window.appendFileThumbnail=(node)=>{node.textContent='PNG';};
    });
    assert.deepEqual(await page.locator('#workspace-shortcuts [data-workspace-area]').allTextContents(),['日程','文件','资产','技能']);
    assert.equal(await page.locator('.partition-wheel-logo').count(),0);
    await page.evaluate(()=>MesssWorkHub.open('schedule'));
    await page.locator('[data-hub-action="new-project"]').click();
    await page.locator('.hub-editor [name=title]').fill('真实流程测试');
    await page.locator('.hub-editor [name=start]').fill(month+'-01');await page.locator('.hub-editor [name=due]').fill(month+'-20');
    await page.locator('.hub-editor [name=owner]').fill('Chaser');
    await page.locator('.hub-editor [name=status]').selectOption('active');await page.locator('.hub-editor [name=progress]').fill('45');
    await page.locator('.hub-editor [type=submit]').click();await page.locator('.hub-editor').waitFor({state:'detached'});
    assert.equal(service.list().find(p=>p.title==='真实流程测试').progress,45);
    assert.equal(await page.locator('.hub-day').count(),42);
    fs.mkdirSync('test-artifacts/work-hub',{recursive:true});
    await page.screenshot({path:'test-artifacts/work-hub/schedule-dark.png'});
    await page.locator('[data-hub-action="view-timeline"]').click();assert.ok(await page.locator('.hub-bar').count()>=5);
    await page.screenshot({path:'test-artifacts/work-hub/timeline-dark.png'});
    await page.locator('[data-hub-action="view-month"]').click();await page.setViewportSize({width:520,height:900});
    assert.ok(await page.locator('.work-hub').evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.screenshot({path:'test-artifacts/work-hub/schedule-compact.png'});
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(220);
    await page.screenshot({path:'test-artifacts/work-hub/schedule-light.png'});
    await page.locator('.hub-top [data-hub-action="files"]').click();
    assert.equal(await page.locator('.hub-local').count(),0);
    assert.equal(await page.locator('.hub-search').getAttribute('placeholder'),'搜索名称');
    assert.equal(await page.locator('.hub-search-field > svg').count(),1);
    await page.screenshot({path:'test-artifacts/work-hub/files-light.png'});
    await page.locator('[data-hub-action="collect"]').click();
    await page.locator('.hub-top [data-hub-action="assets"]').click();assert.equal(await page.locator('.hub-asset').count(),1);
    await page.screenshot({path:'test-artifacts/work-hub/assets-light.png'});
    await page.locator('[data-hub-action="asset-edit"]').click();await page.locator('[name=tags]').fill('品牌, 包装');await page.locator('[name=favorite]').check();await page.locator('.hub-editor [type=submit]').click();await page.locator('.hub-editor').waitFor({state:'detached'});
    assert.equal(resources.list().find(r=>r.kind==='asset').favorite,true);
    await page.locator('.hub-top [data-hub-action="skills"]').click();await page.locator('[data-hub-action="new-skill"]').click();await page.locator('.hub-editor [type=submit]').click();await page.locator('.hub-editor').waitFor({state:'detached'});
    assert.equal(await page.locator('.hub-skill').count(),1);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.waitForTimeout(240);
    const darkSearchRgb=await page.locator('.hub-search-field').evaluate(element=>getComputedStyle(element).backgroundColor.match(/\d+/g).map(Number));
    assert.ok(Math.max(...darkSearchRgb.slice(0,3))<80,'Dark search hover must stay dark');
    await page.screenshot({path:'test-artifacts/work-hub/skills-dark.png'});
    for(const target of ['main','canvas']){
      await page.locator('[data-hub-action="skill-use"]').click();await page.locator('[name=task]').fill('检查本周交付');await page.locator('[name=target]').selectOption(target);await page.locator('.hub-editor [type=submit]').click();
      const selector=target==='main'?'#ai-assistant-input':'#board-agent-input';assert.match(await page.locator(selector).inputValue(),/检查本周交付/);
      if(target==='canvas')assert.equal(await page.evaluate(()=>testApplied.canvasOpen),true);
      await page.evaluate(()=>MesssWorkHub.open('skills'));
    }
    console.log('PASS four entries, project create/calendar/timeline, responsive themes, asset collection/tags, skill creation and both Agent targets');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
