import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('GitHub Actions can prepare pinned ArtiSys tooling without cross-repo credentials', () => {
  const pkg = JSON.parse(read('package.json'));
  const bootstrap = read('scripts/ci-bootstrap.mjs');
  const security = read('scripts/security.mjs');
  const workflow = read('.github/workflows/final-release.yml');

  assert.equal(pkg.scripts['ci:bootstrap'], 'node ./scripts/ci-bootstrap.mjs');
  assert.equal(pkg.scripts['ci:qa-final'], 'node ./scripts/ci-capture-final-screens.mjs');
  for (const name of ['desktop-shell','eventbus','dashboard','pdf','printing','qa','release']) {
    assert.match(bootstrap, new RegExp(`@artisys/${name.replace('desktop-shell','desktop-shell')}`));
  }
  assert.match(security, /ci[\\/]artisys-security/);
  assert.doesNotMatch(workflow, /submodules:\s*recursive/);
  assert.match(workflow, /npm run ci:bootstrap/);
  assert.match(workflow, /npm run ci:qa-final/);
});
