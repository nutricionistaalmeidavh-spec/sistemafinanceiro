import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ARTISYS_MODULES, UTILIDADES_COMMIT } from '../src/platform/artisys-manifest.mjs';

test('ArtiSys integration is pinned and exposes the expected reusable modules', () => {
  assert.equal(UTILIDADES_COMMIT, '1c8d00810dcaa9010330ce7adc2877c90484d17d');
  assert.deepEqual(
    ARTISYS_MODULES.map((module) => module.id),
    ['desktop-shell', 'eventbus', 'dashboard', 'pdf', 'qa', 'security', 'release'],
  );
  assert.equal(ARTISYS_MODULES.every((module) => module.required === true), true);
  assert.match(fs.readFileSync('.gitmodules', 'utf8'), /vendor\/utilidades/);
});
