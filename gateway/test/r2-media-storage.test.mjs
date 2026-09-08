import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { getR2Media, putR2Media } from '../src/r2-media-storage.js';
import { storeImageResult, readStoredImageResult } from '../src/image-result-storage.js';

test('R2 storage preserves bytes, bounds downloads and keeps legacy recovery', async (t) => {
  for (const [name,value] of Object.entries({
    CLOUDFLARE_R2_ACCOUNT_ID:'test-account', CLOUDFLARE_R2_ACCESS_KEY_ID:'test-access',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test-secret', CLOUDFLARE_R2_MEDIA_BUCKET:'test-bucket',
    SUPABASE_SECRET_KEY:'test-supabase'
  })) {
    const previous=process.env[name];
    process.env[name]=value;
    t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
  }
  const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
  let mode='ok', written;
  t.mock.method(S3Client.prototype,'send',async (command,options)=>{
    assert.ok(options.abortSignal);
    if(command.constructor.name==='PutObjectCommand'){written=command.input;return {};}
    if(mode==='missing')throw Object.assign(new Error('missing'),{name:'NoSuchKey'});
    if(mode==='outage')throw new Error('unavailable');
    return {Body:Readable.from([png]),ContentType:'image/png'};
  });
  await putR2Media('image/test',png,'image/png');
  assert.deepEqual(written.Body,png);
  assert.equal(written.Bucket,'test-bucket');
  assert.deepEqual((await getR2Media('image/test',100)).body,png);
  await assert.rejects(getR2Media('image/test',5),/size limit/);
  const user='11111111-1111-4111-8111-111111111111';
  const request='22222222-2222-4222-8222-222222222222';
  const ref=await storeImageResult(user,request,png,()=>{throw new Error('Unexpected legacy write');});
  assert.equal(written.Key,`image/${user}/${request}.png`);
  assert.deepEqual(await readStoredImageResult(user,request,ref),png);
  mode='missing';
  assert.deepEqual(await readStoredImageResult(user,request,ref,async()=>new Response(png)),png);
  mode='outage';
  await assert.rejects(readStoredImageResult(user,request,ref,()=>{throw new Error('Unexpected fallback');}),
    {code:'image-result-storage-unavailable'});
});
