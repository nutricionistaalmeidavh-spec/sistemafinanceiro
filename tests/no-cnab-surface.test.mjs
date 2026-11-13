import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const removedSurfaces = [
  'src/pages/StatementsPage.tsx',
  'src/vite-env.d.ts',
  'electron/preload.cjs',
  'electron/trial-preload.cjs',
  'electron/ipc-handlers.cjs',
  'electron/services/statement-import-service.cjs',
  'electron/services/open-format-service.cjs',
];

test('unsupported CNAB workflow is absent from UI, bridge, IPC and banking services', () => {
  for (const filename of removedSurfaces) {
    const source = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /CNAB|inspectCnab|onCnabFile|cnabReport|statements:cnab:inspect/i,
      `Unsupported CNAB workflow remains reachable in ${filename}`,
    );
  }
});

test('other offline bank import formats remain available', () => {
  const source = readFileSync(new URL('../src/pages/StatementsPage.tsx', import.meta.url), 'utf8');
  for (const format of ['CSV', 'XLSX', 'ODS', 'QIF', 'OFX', 'PDF']) {
    assert.match(source, new RegExp("'" + format + "'"), `Missing supported format ${format}`);
  }
});
