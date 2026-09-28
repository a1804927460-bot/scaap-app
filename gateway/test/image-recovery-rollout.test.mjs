import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('missing image recovery schema does not block a fresh image request', () => {
  assert.match(
    server,
    /\['image-job-service-not-configured', 'image-job-schema-missing'\]\.includes\([\s\S]*?\)\) return null/,
    'A missing recovery table must be treated as an unavailable optional layer.'
  );
  assert.match(
    server,
    /imageJobTrackingAvailable = false;[\s\S]*?claimedJob = null;/,
    'The fresh request must continue without image-job persistence when the schema is absent.'
  );
  assert.match(
    server,
    /createImageJobTracker\(user\.id, requestId, body, recoverJob, \{[\s\S]*?imageJobTrackingAvailable/s,
    'The tracker must know that image-job persistence is unavailable for this request.'
  );
});

test('image recovery remains fail-closed for an unknown RPC failure', () => {
  const loadImageJob = server.slice(
    server.indexOf('async function loadImageJob'),
    server.indexOf('function publicDownloadUrl', server.indexOf('async function loadImageJob'))
  );
  assert.doesNotMatch(loadImageJob, /image-job-service-failed.*return null/s);
  assert.match(loadImageJob, /throw error;/);
});

test('stored image results retain the provider reference for legacy RPC compatibility', () => {
  const tracker = server.slice(
    server.indexOf('function createImageJobTracker'),
    server.indexOf('async function persistImageResult')
  );
  assert.match(tracker, /providerResultUrl: ''/);
  assert.match(tracker, /state\.providerResultUrl = String\(mediaUrl \|\| ''\)\.trim\(\)/);
  assert.match(tracker, /recordImageProviderResult\(userId, requestId, reference, fetch, mediaUrl\)/);

  const persist = server.slice(
    server.indexOf('async function persistImageResult'),
    server.indexOf('function publicDownloadUrl', server.indexOf('async function persistImageResult'))
  );
  assert.match(persist, /tracker\.state\.providerResultUrl/);
  assert.match(persist, /recordImageProviderResult\(\s*userId, requestId, reference, fetch, tracker\.state\.providerResultUrl/s);
});
