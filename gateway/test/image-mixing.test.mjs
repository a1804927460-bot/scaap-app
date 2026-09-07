import test from 'node:test';

test('All public image models preserve their contract across mixed routes', async () => {
  await import('../../scripts/test-all-image-mixing.mjs');
});
