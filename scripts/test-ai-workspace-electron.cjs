const { app } = require('electron');
const assert = require('node:assert/strict');
const { executeWork, materialize } = require('../lib/ai-workspace');
app.whenReady().then(async () => {
  try {
    const output = await executeWork('return {files:[{name:"desktop.pptx",type:"pptx",slides:[{title:"Messs",body:"Desktop worker test"}]}]};');
    const files = await materialize(output);
    assert.equal(files[0].data.subarray(0,2).toString(),'PK');
    console.log('Electron worker execution and binary PPTX generation passed.');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
