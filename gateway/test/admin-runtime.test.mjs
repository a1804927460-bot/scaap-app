import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'messs-admin-runtime-'));
process.env.GATEWAY_RUNTIME_CONFIG_FILE = path.join(directory, 'routes.json');
process.env.AI302_KEY = 'test-ai302-key';
process.env.FAL_API_KEY = 'test-fal-key';

const providers = await import('../src/providers.js');
const admin = await import('../src/admin.js');

test('the administrator allowlist accepts only the configured owner email', () => {
  assert.equal(admin.isAdminUser({ id:'00000000-0000-4000-8000-000000000001', email:'a1804927460@gmail.com' }), true);
  assert.equal(admin.isAdminUser({ id:'00000000-0000-4000-8000-000000000002', email:'other@example.com' }), false);
  assert.equal(admin.isAdminUser({ email:'a1804927460@gmail.com' }), false);
});

test('normal and performance route priorities persist independently', () => {
  const initial = providers.providerRuntimeStatus();
  const normal = initial.routes.find(route => route.kind === 'image' && route.providerId === 'image-2' && route.routeProfile === 'normal');
  const performance = initial.routes.find(route => route.kind === 'image' && route.providerId === 'image-2' && route.routeProfile === 'performance');
  assert.ok(normal && performance);
  const configured = normal.availableProviders.filter(candidate => candidate.configured).map(candidate => candidate.id);
  assert.ok(configured.includes('legacy-image-2'));
  assert.ok(configured.includes('fal-backup-nano-2'));

  providers.setProviderRuntimeRoute('image','image-2',['legacy-image-2'],'test','default','normal');
  providers.setProviderRuntimeRoute('image','image-2',['fal-backup-nano-2'],'test','default','performance');
  const updated = providers.providerRuntimeStatus().routes.filter(route => route.kind === 'image' && route.providerId === 'image-2');
  assert.equal(updated.find(route => route.routeProfile === 'normal').activeProviderIds[0], 'legacy-image-2');
  assert.equal(updated.find(route => route.routeProfile === 'performance').activeProviderIds[0], 'fal-backup-nano-2');
  const persisted = JSON.parse(fs.readFileSync(process.env.GATEWAY_RUNTIME_CONFIG_FILE,'utf8'));
  assert.equal(persisted.routes.length, 2);
});

test('route switching rejects a different product family', () => {
  assert.throws(() => providers.setProviderRuntimeRoute('image','image-2',['image-6'],'test','default','normal'), error => error.code === 'provider-incompatible');
});
