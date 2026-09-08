import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2MediaConfigured } from '../src/r2-media-storage.js';
import { storeImageResult, readStoredImageResult } from '../src/image-result-storage.js';
import { storeVideoResult, readStoredVideoResult } from '../src/video-result-storage.js';

assert.ok(r2MediaConfigured(), 'R2 configuration required');
const user = randomUUID(), request = randomUUID();
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
// Storage fixture only: no AI call or customer content.
const video = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
const keys = [`image/${user}/${request}.png`, `video/${user}/${request}.mp4`];
const client = new S3Client({region:'auto', endpoint:`https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey:process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY}});
const noFallback = () => { throw new Error('Unexpected Supabase access'); };
try {
  const imageRef = await storeImageResult(user, request, image, noFallback);
  assert.deepEqual(await readStoredImageResult(user, request, imageRef, noFallback), image);
  const videoRef = await storeVideoResult(user, request, video, 'video/mp4', noFallback);
  assert.deepEqual((await readStoredVideoResult(user, request, videoRef, noFallback)).buffer, video);
  console.log('PASS: live R2 image and video storage roundtrip; exact bytes preserved.');
} finally {
  for (const Key of keys) await client.send(new DeleteObjectCommand({Bucket:process.env.CLOUDFLARE_R2_MEDIA_BUCKET, Key}), {abortSignal:AbortSignal.timeout(30000)});
  client.destroy();
  console.log('Verification fixtures removed.');
}
