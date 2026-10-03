const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/board-canvas.js', 'utf8');
const open = source.slice(source.indexOf('  function setCameraControlOpen('), source.indexOf('  function renderCameraControl('));
const cycle = source.slice(source.indexOf('  function cycleCameraControl('), source.indexOf('  function keepOptionsOpen('));
const click = source.slice(source.indexOf("  cameraControlPanel.addEventListener('click',"), source.indexOf("  optionsPanel.addEventListener('pointerdown',"));
let onClick;
const state = vm.createContext({
  kind: 'video', cameraControl: {enabled:false,lens:'a'}, cameraControlDraft:null,
  cameraControlPanel: {hidden:true,addEventListener:(_, fn)=>{onClick=fn;}},
  cameraControlToggle: {setAttribute(){}},
  setOptionsOpen(){}, setPromptStylePanelOpen(){}, renderCameraControl(){},
  normalizeAiCameraControl: value=>({...value}),
  AI_CAMERA_CONTROL_PRESETS: {lens:[{id:'a'},{id:'b'}]}
});
vm.runInContext(open+cycle+click, state);
const run = code => vm.runInContext(code, state);
run("setCameraControlOpen(true); cycleCameraControl('lens',1)");
assert.equal(state.cameraControl.enabled,false);
assert.equal(state.cameraControl.lens,'a');
run('setCameraControlOpen(false); setCameraControlOpen(true)');
assert.equal(state.cameraControlDraft.lens,'a','Unsaved edits must be discarded');
run("cycleCameraControl('lens',1)");
const clickButton = selector => onClick({stopPropagation(){},target:{closest:s=>s===selector?{}:null}});
clickButton('.ai-camera-control-save');
assert.equal(state.cameraControl.enabled,true);
assert.equal(state.cameraControl.lens,'b');
run("setCameraControlOpen(true); cycleCameraControl('lens',1)");
clickButton('.ai-camera-control-disable');
assert.equal(state.cameraControl.lens,'b','Closing must retain previously saved settings');
assert.equal(state.cameraControlDraft,null);
console.log('Camera save: draft isolation, cancel, commit and saved-state preservation passed.');
