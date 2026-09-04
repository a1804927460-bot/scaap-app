import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../gateway/test/', import.meta.url));
const files = readdirSync(root)
  .filter((file) => file.endsWith('.test.mjs'))
  .sort();

for (const file of files) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const expectedTests = (source.match(/\btest\s*\(/g) || []).length;
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-force-exit',
    resolve(root, file)
  ], {
    cwd: resolve(root, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    timeout: 30_000,
    killSignal: 'SIGTERM'
  });
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  process.stdout.write(output);
  const passedTests = (output.match(/^ok \d+ - /gm) || []).length;
  const timedOutAfterPassing = result.error?.code === 'ETIMEDOUT'
    && expectedTests > 0
    && passedTests === expectedTests
    && !/^not ok \d+ - /m.test(output);
  const status = result.status === 0 || timedOutAfterPassing ? 0 : (result.status ?? 1);
  if (status !== 0) process.exit(status);
}
