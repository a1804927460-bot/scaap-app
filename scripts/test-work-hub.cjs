'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createScheduleService,validate}=require('../lib/project-schedule');
const {createResourceService,parseSkill}=require('../lib/workspace-resources');
const draft={title:'跨月项目',owner:'设计组',start:'2026-08-28',due:'2026-09-09',status:'active',progress:35,milestones:[{title:'初稿',date:'2026-09-02'}]};
const skill='---\nname: delivery-review\ndescription: |\n  Review project deliveries.\n---\nCheck supplied files, list missing deliverables.';
test('real application Store reload retains schedule and skills',()=>{
  const {Store}=require('../lib/store');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'messs-hub-store-'));
  try{const store=new Store(dir);createScheduleService(store,()=> 'a').save(draft);createResourceService(store,()=> 'a').save({kind:'skill',markdown:skill});
    const reopened=new Store(dir);assert.equal(createScheduleService(reopened,()=> 'a').list()[0].title,draft.title);assert.equal(createResourceService(reopened,()=> 'a').list()[0].name,'delivery-review');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('project dates validate leap years, reversed ranges and milestones',()=>{
  assert.equal(validate(draft).progress,35);
  assert.throws(()=>validate({...draft,due:'2026-02-30'}));
  assert.throws(()=>validate({...draft,due:'2026-08-01'}));
  assert.throws(()=>validate({...draft,milestones:[{title:'bad',date:'2026-09-10'}]}));
  assert.throws(()=>validate({...draft,progress:101}));
  assert.equal(validate({...draft,status:'done'}).progress,100);
  assert.equal(validate({...draft,start:'2024-02-29',due:'2024-02-29',milestones:[]}).due,'2024-02-29');
});
test('account isolation, disk persistence, revision conflicts and reversible archive',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'messs-schedule-'));const file=path.join(dir,'store.json');
  try{let owner='a';const store={data:{},save(){fs.writeFileSync(file,JSON.stringify(this.data));}};const service=createScheduleService(store,()=>owner);
    const saved=service.save(draft);owner='b';assert.equal(service.list().length,0);assert.throws(()=>service.save({...saved,title:'bad'}));owner='a';
    const next=service.save({...saved,progress:60});assert.throws(()=>service.save(saved),/其他窗口/);
    const archived=service.archive(next);assert.ok(archived.deletedAt);const restored=service.restore(archived);assert.equal(restored.deletedAt,null);
    const reboot=createScheduleService({data:JSON.parse(fs.readFileSync(file)),save(){}},()=>owner);assert.equal(reboot.list()[0].progress,60);assert.equal(reboot.list()[0].history.length,4);
    store.save=()=>{throw Error('disk full');};assert.throws(()=>service.save({...restored,title:'lost'}));assert.equal(service.list()[0].title,'跨月项目');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('skill standard YAML parsing and resource ownership do not execute imported code',()=>{
  assert.equal(parseSkill(skill).name,'delivery-review');assert.throws(()=>parseSkill('no frontmatter'));
  assert.throws(()=>parseSkill(skill.replace('delivery-review','Bad Name')));
  assert.throws(()=>parseSkill('---\nname: test\ndescription: !!js/function >\n  function () {}\n---\nbody'));
  let owner='a';const store={data:{files:[{id:'file-1'}]},save(){}};const service=createResourceService(store,()=>owner);
  const saved=service.save({kind:'skill',markdown:skill});assert.equal(service.list()[0].instructions,'Check supplied files, list missing deliverables.');
  const asset=service.save({kind:'asset',fileId:'file-1',tags:['品牌'],favorite:true});assert.equal(service.save({kind:'asset',fileId:'file-1',tags:[]}).id,asset.id);
  owner='b';assert.deepEqual(service.list(),[]);assert.throws(()=>service.remove(saved));assert.throws(()=>service.save({...saved,markdown:skill}));owner='a';service.remove(asset);assert.equal(store.data.files.length,1);assert.equal(service.list().length,1);
});
