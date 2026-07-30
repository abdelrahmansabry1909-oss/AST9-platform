import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const unitDirectory = new URL('./', import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
const diskFiles = readdirSync(unitDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => entry.name)
  .sort();
const scriptFiles = [
  ...packageJson.scripts['test:unit'].matchAll(
    /(?:^|\s)tests\/unit\/([^\s]+\.test\.js)(?=\s|$)/g
  ),
].map(([, filename]) => filename).sort();

test('test:unit includes every unit test file on disk', () => {
  const missingFiles = diskFiles.filter((filename) => !scriptFiles.includes(filename));
  assert.deepEqual(
    missingFiles,
    [],
    `test:unit is missing: ${missingFiles.join(', ')}`
  );
});

test('every unit test file in test:unit exists on disk', () => {
  const staleFiles = scriptFiles.filter((filename) => !diskFiles.includes(filename));
  assert.deepEqual(
    staleFiles,
    [],
    `test:unit references missing files: ${staleFiles.join(', ')}`
  );
});
