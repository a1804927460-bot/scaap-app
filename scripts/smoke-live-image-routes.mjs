import fs from 'node:fs';
import crypto from 'node:crypto';
import { generateMedia } from '../gateway/src/providers.js';
import { moderateGenerationPrompt } from '../gateway/src/moderation.js';
if (!process.argv.includes('--live')) throw new Error('Pass --live to run paid provider checks.');
const dir = 'test-artifacts/release/live-routes';
fs.mkdirSync(dir, { recursive: true });
const prompt = 'A simple red ceramic cup on a plain white table, studio product photograph, no text.';
try {
  await moderateGenerationPrompt({ prompt }, { userId: 'release-check', requestId: crypto.randomUUID() });
  console.log('moderation: passed');
} catch (error) {
  console.log('moderation:', error.code || 'failed'); process.exitCode = 1;
}
for (const providerId of ['image-1', 'image-2', 'image-6']) {
  const operationId = crypto.randomUUID();
  try {
    const image = await generateMedia('image', { providerId, operationId, prompt, size: '1K', quality: 'low', aspectRatio: '1:1', urls: [] }, AbortSignal.timeout(180000), {
      onAccepted: async task => fs.writeFileSync(`${dir}/${providerId}-task.json`, JSON.stringify({ operationId, ...task }, null, 2))
    });
    if (!Buffer.isBuffer(image) || image.length === 0) throw new Error('Empty image');
    fs.writeFileSync(`${dir}/${providerId}.png`, image);
    console.log(`${providerId}: passed (${image.length} bytes)`);
  } catch (error) {
    console.log(`${providerId}: ${error.code || error.name || 'failed'}`);
    process.exitCode = 1;
  }
}
