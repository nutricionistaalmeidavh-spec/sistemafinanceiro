import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const gates = fs.readFileSync('scripts/final-gates.mjs','utf8');

test('final release gates are local, fail-closed and include build/security/release checks', () => {
  assert.equal(pkg.scripts['final:prepare'], 'node ./scripts/final-gates.mjs');
  assert.match(pkg.scripts['qa:final'], /final-screens/);
  assert.equal(pkg.scripts['dist:package'], 'electron-builder --win nsis --x64 --publish never');
  assert.match(pkg.scripts['final:release'], /final:prepare/);
  assert.match(pkg.scripts['final:release'], /qa:final/);
  assert.match(pkg.scripts['final:release'], /dist:package/);
  assert.match(pkg.scripts['dist:package'], /--publish never/);
  for (const command of ['test','build','security','release:check']) assert.match(gates, new RegExp(command.replace(':','\\:')));
  assert.match(gates, /node --check/);
  assert.doesNotMatch(gates, /github|actions\/|workflow_dispatch/i);
});
