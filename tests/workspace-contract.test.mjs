import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('personal Workspace is wired through main, IPC, preload and navigation', () => {
  const main = read('electron/main.cjs');
  const ipc = read('electron/ipc-handlers.cjs');
  const preload = read('electron/preload.cjs');
  const app = read('src/App.tsx');
  const page = read('src/pages/WorkspacePage.tsx');

  assert.match(main, /createWorkspaceService/);
  assert.match(main, /userData'\), 'workspace'/);
  for (const channel of [
    'workspace:list', 'workspace:tree', 'workspace:search', 'workspace:create-folder',
    'workspace:create-file', 'workspace:import-select', 'workspace:rename', 'workspace:move',
    'workspace:copy', 'workspace:trash', 'workspace:trash:restore', 'workspace:trash:delete',
    'workspace:open', 'workspace:reveal',
  ]) assert.match(ipc, new RegExp(channel.replace(':', '\\:')));

  assert.match(preload, /workspace:\s*\{/);
  assert.match(app, /nav\('workspace','Workspace'/);
  assert.match(page, /data-testid="workspace-page"/);
  assert.match(page, /Lixeira/);
  assert.match(page, /Adicionar arquivos/);
});

test('Workspace remains personal and storage-backed without company tenancy', () => {
  const service = read('electron/services/workspace-service.cjs');
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');

  assert.equal(pkg.dependencies['@artisys/storage'], 'file:vendor/utilidades/modules/artisys-storage');
  assert.match(service, /import\('@artisys\/storage'\)/);
  assert.match(service, /personal-workspace/);
  assert.doesNotMatch(service, /companyId|tenantId|organizationId/);
  assert.match(readme, /Workspace é \*\*pessoal\*\*/);
});
