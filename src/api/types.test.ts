import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('response types match the vendored OpenAPI contract', () => {
  const result = spawnSync(process.execPath, [
    join(import.meta.dir, '../../scripts/generate-api-types.cjs'),
    '--check',
  ]);
  expect(result.status).toBe(0);
});
