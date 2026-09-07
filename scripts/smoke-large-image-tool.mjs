import fs from 'node:fs';
import sharp from 'sharp';
import { runFalImageTool } from '../gateway/src/fal-image-tools.js';
import { parseImageDataUrl } from '../gateway/src/ai302-tools.js';

if (!process.argv.includes('--live')) throw new Error('Pass --live to run this paid image-tool check.');
const source='test-artifacts/release/live-routes/image-1.png';
const directory='test-artifacts/release/large-image-tool';
fs.mkdirSync(directory,{recursive:true});
const bytes=await sharp(source).resize(1536,1536).removeAlpha().png({compressionLevel:0}).toBuffer();
const imageDataUrl=`data:image/png;base64,${bytes.toString('base64')}`;
parseImageDataUrl(imageDataUrl);
console.log('large-reference-validation',bytes.length,'bytes');
const output=await runFalImageTool('feynobg',imageDataUrl,{}, {
  onAccepted:async task=>{
    fs.writeFileSync(`${directory}/task.json`,JSON.stringify(task));
    console.log('background-removal-task-accepted');
  }
});
const metadata=await sharp(output).metadata();
if(metadata.format!=='png'||!metadata.hasAlpha)throw new Error('Expected a transparent PNG result');
fs.writeFileSync(`${directory}/background-removed.png`,output);
console.log('background-removal-passed',metadata.width,metadata.height,output.length,'bytes');
