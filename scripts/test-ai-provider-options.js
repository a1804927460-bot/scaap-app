'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'ai-provider-options.js'), 'utf8');
const context = { globalThis: {}, console };
vm.runInNewContext(source, context);
const options = context.globalThis.MesssAiProviderOptions;
assert.ok(options);

const providers = [
  { id: 'chat-3', name: 'Gemini', endpoint: 'https://primary.test', models: ['gemini-3.1-pro'] },
  { id: 'chat-4', name: 'Sol', endpoint: 'https://sol.test', models: ['gpt-5.6-sol'] },
  { id: 'chat-5', name: 'Kimi', endpoint: 'https://kimi.test', models: ['kimi-k3'] }
];
const chat = options.chatOptions(providers, {
  allowedModels: new Set(['gemini-3.1-pro', 'kimi-k3', 'gpt-5.6-sol']),
  activeProviderId: 'chat-3'
});
assert.equal(JSON.stringify(chat.map((entry) => entry.model)), JSON.stringify([
  'gemini-3.1-pro', 'gpt-5.6-sol', 'kimi-k3'
]));
assert.equal(chat.find((entry) => entry.model === 'gemini-3.1-pro').providerId, 'chat-3');
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test' },
  { id: 'legacy', name: 'Nano Banana Pro legacy route', endpoint: 'https://two.test' }
], 'image').length, 1);
assert.equal(options.uniqueProviders([
  { id: 'image-1', name: 'Nano Banana Pro', endpoint: 'https://one.test', logicalModel: 'nano-banana-pro' },
  { id: 'image-1-backup', name: 'Nano Banana Pro backup', endpoint: 'https://two.test', logicalModel: 'nano-banana-pro' }
], 'image', { activeProviderId: 'image-1-backup' })[0].id, 'image-1-backup');
process.stdout.write('AI provider option tests passed.\n');

// Cloud projection historically omitted model and logicalModel. Both public
// products must survive deduplication even when an old client cached that shape.
for (const activeProviderId of ['image-6', 'image-19']) {
  for (const fields of [
    [{}, {}],
    [{model:'gpt_image_2'}, {model:'gpt_image_2_5_flare'}],
    [{logicalModel:'gpt-image-2'}, {logicalModel:'gpt-image-2.5'}]
  ]) {
    const entries = [
      {id:'image-6', name:'GPT Image 2', endpoint:'https://gateway.test', ...fields[0]},
      {id:'image-19', name:'GPT Image 2.5', endpoint:'https://gateway.test', ...fields[1]}
    ];
    const actual = options.uniqueProviders(entries, 'image', {activeProviderId});
    assert.equal(JSON.stringify(actual.map(p=>p.id)), JSON.stringify(['image-6','image-19']));
  }
}

const projectRoot=path.join(__dirname,'..');
function rendererFunction(file, name) {
  const text=fs.readFileSync(path.join(projectRoot,'src','js',file),'utf8');
  const start=text.indexOf('function '+name+'(');
  const end=text.indexOf('\nfunction ',start+1);
  assert.ok(start>=0 && end>start);
  return text.slice(start,end);
}
const imageConfig={providerVisibilityEnforced:true,activeImageProviderId:'image-6',imageProviders:[
  {id:'image-6',name:'GPT Image 2',endpoint:'https://gateway.test'},
  {id:'image-19',name:'GPT Image 2.5',endpoint:'https://gateway.test'}
]};
const renderer={MesssAiProviderOptions:options,AiAssistant:{config:imageConfig}};
vm.createContext(renderer);
vm.runInContext(rendererFunction('board-canvas.js','normalizeConfiguredAiProviders')+'\n'+rendererFunction('board-canvas.js','getConfiguredImageProviders')+'\n'+rendererFunction('ai-assistant.js','configuredAssistantProviders'),renderer);
for(const active of ['image-6','image-19']) {
  imageConfig.activeImageProviderId=active;
  assert.equal(JSON.stringify(renderer.getConfiguredImageProviders(imageConfig).map(p=>p.id)),JSON.stringify(['image-6','image-19']));
  assert.equal(JSON.stringify(renderer.configuredAssistantProviders('image').map(p=>p.id)),JSON.stringify(['image-6','image-19']));
}
process.stdout.write('Main chat and canvas both retain GPT Image 2 and GPT Image 2.5.\n');
