import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lock = JSON.parse(fs.readFileSync('vendor/artisys-modules.lock.json', 'utf8'));

test('ArtiSys integration is pinned and exposes the expected reusable modules', () => {
  assert.equal(lock.commit, '1c8d00810dcaa9010330ce7adc2877c90484d17d');
  assert.deepEqual(lock.modules, [
    'artisys-desktop-shell',
    'artisys-eventbus',
    'artisys-dashboard',
    'artisys-pdf',
    'artisys-qa',
    'artisys-security',
    'artisys-release',
  ]);
  assert.match(fs.readFileSync('.gitmodules', 'utf8'), /vendor\/utilidades/);
});
