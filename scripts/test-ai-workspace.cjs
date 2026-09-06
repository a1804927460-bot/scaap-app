const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const JSZip=require('jszip');
const {executeWork,materialize,createArtifactStore,parseWork}=require('../lib/ai-workspace');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'messs-work-test-'));
  try {
    const output=await executeWork(`const sum=uploads[0].content.split(',').map(Number).reduce((a,b)=>a+b,0);return {files:[{name:'report.csv',content:'total\\n'+sum},{name:'deck.pptx',type:'pptx',slides:[{title:'Data report',body:'Total: '+sum}]}]};`,[{name:'input.csv',content:'2,3,5'}]);
    const files=await materialize(output);
    const extra=await materialize({files:[{name:'text.jpg',type:'image',text:'Hello',width:256,height:256},{name:'any.custom',base64:Buffer.from([0,1,255,128]).toString('base64')}]});
    assert.equal((await require('sharp')(extra[0].data).metadata()).format,'jpeg');
    assert.deepEqual(extra[1].data,Buffer.from([0,1,255,128]));
    await assert.rejects(materialize({files:[{name:'bad.bin',base64:'broken==='}]}));
    assert.match(files[0].data.toString(),/10/);
    const zip=await JSZip.loadAsync(files[1].data);
    assert.ok(zip.file('ppt/presentation.xml'));
    assert.match(await zip.file('ppt/slides/slide1.xml').async('string'),/Total: 10/);
    const store=createArtifactStore(root,'user-a');
    const records=await store.save(files);
    const reopened=createArtifactStore(root,'user-a');
    assert.deepEqual((await reopened.read(records[1].token)).data,files[1].data);
    await assert.rejects(createArtifactStore(root,'user-b').read(records[1].token));
    await assert.rejects(store.read('../escape'));
    await assert.rejects(materialize({files:[{name:'../escape.txt',content:'bad'}]}));
    await assert.rejects(materialize({files:[{name:'bad.exe',content:'bad'}]}));
    await assert.rejects(executeWork('return require("fs").readdirSync("C:/");'));
    await assert.rejects(executeWork('return process.env;'));
    await assert.rejects(executeWork('return fetch("https://example.com");'));
    await assert.rejects(executeWork('while(true) {}'));
    assert.equal(parseWork('<messs-work>return {files:[]};</messs-work>').code,'return {files:[]};');
    assert.throws(()=>parseWork('<messs-work>a</messs-work><messs-work>b</messs-work>'));
    await fs.mkdir('test-artifacts/ai-workspace',{recursive:true});
    await fs.writeFile('test-artifacts/ai-workspace/sample-report.pptx',files[1].data);
    console.log('AI workspace passed: isolated execution, upload processing, PPTX structure, persistent binary roundtrip, owner isolation, traversal and timeout.');
  }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
