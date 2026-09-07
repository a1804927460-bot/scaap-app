import fs from 'node:fs';
import crypto from 'node:crypto';
import { generateMedia, createVideoTask, pollVideoTask } from '../gateway/src/providers.js';
import { selectImageChannel, preferFalImageChannel } from '../gateway/src/image-channel-policy.js';
import sharp from 'sharp';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const catalog = require('../config/provider-catalog.json');
if (!process.argv.includes('--live')) throw new Error('Pass --live for paid provider checks.');
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7);
if (!['plus','fal','video','mixed'].includes(mode)) throw new Error('Choose --mode=plus|fal|video|mixed');
const edit = process.argv.includes('--edit');
const dir = `test-artifacts/release/live-backups/${mode}`;
fs.mkdirSync(dir,{recursive:true});
process.env.FAL_NANO_BACKUP_ENABLED = 'true';
if (mode === 'mixed') {
  process.env.FAL_IMAGE_BACKUP_ENABLED='true';
  process.env.FAL_IMAGE_MIX_PERCENT='10';
  process.env.FAL_GPT_IMAGE_MIX_PERCENT='20';
  process.env.AIREITER_IMAGE_ROUTING_SECRET ||= crypto.randomBytes(32).toString('hex');
}
if (mode === 'plus') {
  process.env.AIREITER_IMAGE_PLUS_PERCENT = '30';
  process.env.AIREITER_IMAGE_ROUTING_SECRET ||= crypto.randomBytes(32).toString('hex');
}
const ids = mode === 'mixed' ? ['image-1','image-2','image-6'] : mode === 'plus' ? ['image-1','image-2'] : mode === 'fal' ? ['fal-backup-nano-pro'] : ['video-1'];
for (const providerId of ids) {
  let operationId = crypto.randomUUID();
  if (mode === 'plus') {
    const provider = catalog.providers.find(p => p.id === providerId);
    while (selectImageChannel(provider,{operationId}).model === provider.model) operationId = crypto.randomUUID();
  }
  if (mode === 'mixed') {
    const provider = catalog.providers.find(p => p.id === providerId);
    while (!preferFalImageChannel(provider,{operationId})) operationId=crypto.randomUUID();
  }
  try {
    if (mode === 'video') {
      const signal = AbortSignal.timeout(600000);
      const referenceTask=JSON.parse(fs.readFileSync('test-artifacts/release/live-routes/image-1-task.json','utf8'));
      const reference=await pollVideoTask('video-1',referenceTask.taskId,signal);
      if(reference.status!=='succeeded'||!reference.resultUrl)throw new Error('Reference image unavailable');
      const task = await createVideoTask({providerId,operationId,prompt:'A red ceramic cup on a white table, static camera.',resolution:'768P',size:'768P',duration:4,aspectRatio:'adaptive',urls:[reference.resultUrl],referenceMediaTypes:['image'],videoMode:'first-frame'},signal);
      fs.writeFileSync(`${dir}/${providerId}-task.json`,JSON.stringify({operationId,...task}));
      for (;;) {
        const state = await pollVideoTask(providerId,task.taskId,signal);
        if (state.status === 'succeeded') {
          if (new URL(state.resultUrl).protocol !== 'https:') throw new Error('Unsafe result URL');
          const result = await fetch(state.resultUrl,{signal});
          if (!result.ok) throw new Error('Download failed');
          const data = Buffer.from(await result.arrayBuffer());
          if (data.subarray(4,8).toString() !== 'ftyp') throw new Error('Invalid MP4');
          fs.writeFileSync(`${dir}/${providerId}.mp4`,data);console.log(providerId,'passed',data.length);break;
        }
        if (['failed','cancelled','expired'].includes(state.status)) throw Object.assign(new Error('Video failed'),{code:state.errorCode});
        await new Promise(resolve=>setTimeout(resolve,4000));
      }
      continue;
    }
    let accepted;
    const urls=edit ? [`data:image/png;base64,${fs.readFileSync('test-artifacts/release/live-routes/image-1.png').toString('base64')}`] : [];
    const suffix=edit?'-edit':'';
    const bytes = await generateMedia('image', {
      providerId,operationId,prompt:edit?'Change the ceramic cup to blue. Preserve the composition and white table.':'A red ceramic cup on a white table, soft studio light, static camera, no text.',
      size:'1K',aspectRatio:'1:1',quality:mode==='mixed'?'medium':'low',urls
    },AbortSignal.timeout(mode === 'video'?600000:240000),{
      onAccepted: async task => { accepted=task; fs.writeFileSync(`${dir}/${providerId}${suffix}-task.json`,JSON.stringify({operationId,...task})); },
    });
    if (!Buffer.isBuffer(bytes)||!bytes.length) throw new Error('Empty result');
    if(mode==='mixed' && !accepted?.providerId.startsWith('fal-backup-'))throw new Error('Expected the mixed FAL route');
    const meta=await sharp(bytes).metadata();
    if (!meta.width || !meta.height)throw new Error('Missing image dimensions');
    if (providerId==='image-6' && (meta.width!==1024 || meta.height!==1024))throw new Error('Unexpected GPT dimensions');
    fs.writeFileSync(`${dir}/${providerId}${suffix}.${meta.format==='jpeg'?'jpg':meta.format}`,bytes);
    console.log(providerId,suffix||'text','passed',meta.width,meta.height,bytes.length);
  } catch(error) {
    console.log(providerId,JSON.stringify({code:error.code,name:error.name,status:error.status,accepted:error.providerTaskAccepted===true}));
    process.exitCode=1;
  }
}
