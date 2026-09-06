const assert = require('node:assert/strict');
const {materialize,executeWork} = require('../lib/ai-workspace');
const {assertModelArtifact}=require('../lib/ai-model-export');
(async () => {
  const parts=[{shape:'box',size:[7,14,.8]},{shape:'cylinder',size:[1,0.2,1],position:[2,5,.5],rotation:[Math.PI/2,0,0]}];
  const output=await executeWork(`return {files:[{name:'phone.obj',type:'model',parts:${JSON.stringify(parts)}},{name:'phone.stl',type:'model',parts:${JSON.stringify(parts)}}]}`);
  const files=await materialize(output);
  assert.throws(()=>assertModelArtifact('生成一个3d模型手机',[{name:'phone.html'}]));
  assert.doesNotThrow(()=>assertModelArtifact('生成一个3d模型手机',files));
  assert.doesNotThrow(()=>assertModelArtifact('生成3d模型的HTML查看器',[{name:'phone.html'}]));
  const {OBJLoader}=await import('three/addons/loaders/OBJLoader.js');
  const {STLLoader}=await import('three/addons/loaders/STLLoader.js');
  const model=new OBJLoader().parse(files[0].data.toString());
  assert.equal(model.children.length,2);
  assert.ok(model.children[0].geometry.attributes.position.count>0);
  const data=files[1].data;
  assert.equal(data.length,84+data.readUInt32LE(80)*50);
  const geometry=new STLLoader().parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
  assert.ok(geometry.attributes.position.count>0); geometry.dispose();
  model.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});
  for(const bad of [{name:'wrong.html',parts},{name:'bad.obj',parts:[{shape:'box',size:[1,-1,1]}]},{name:'bad.obj',parts:Array(129).fill(parts[0])}]) {
    await assert.rejects(materialize({files:[{...bad,type:'model'}]}));
  }
  console.log('Isolated work -> real OBJ/STL -> official loader roundtrip passed; invalid dimensions/types/count rejected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
