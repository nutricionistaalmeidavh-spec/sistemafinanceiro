import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkspaceService } = require('../electron/services/workspace-service.cjs');
const read = (file) => fs.readFileSync(file, 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    async put(key, value, options = {}) { map.set(key, { value, metadata: options.metadata ?? {} }); return { path: key }; },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { return map.delete(key); },
    async list(prefix = '') { return [...map.keys()].filter((key) => key.startsWith(prefix)).sort(); },
  };
}

test('external drag import copies files and folders recursively with collision-safe names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-workspace-dnd-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-workspace-source-'));
  try {
    fs.writeFileSync(path.join(external, 'comprovante.pdf'), 'pdf');
    fs.mkdirSync(path.join(external, 'Documentos'));
    fs.writeFileSync(path.join(external, 'Documentos', 'nota.txt'), 'nota');

    const service = createWorkspaceService({ rootDir: root, metadataStorage: memoryStorage() });
    await service.createFolder('', 'Entrada');
    await service.createFile('Entrada', 'comprovante.pdf', 'existente');

    const imported = await service.importFiles('Entrada', [
      path.join(external, 'comprovante.pdf'),
      path.join(external, 'Documentos'),
    ]);

    assert.deepEqual(imported.map((item) => item.name).sort(), ['Documentos', 'comprovante (1).pdf']);
    assert.equal(fs.readFileSync(path.join(root, 'Entrada', 'Documentos', 'nota.txt'), 'utf8'), 'nota');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('renderer drop uses Electron webUtils in preload and a dedicated authenticated IPC path import', () => {
  const preload = read('electron/preload.cjs');
  const ipc = read('electron/ipc-handlers.cjs');
  const page = read('src/pages/WorkspacePage.tsx');

  assert.match(preload, /webUtils/);
  assert.match(preload, /getPathForFile/);
  assert.match(preload, /importDropped/);
  assert.match(preload, /workspace:import-paths/);
  assert.match(ipc, /workspace:import-paths/);
  assert.match(ipc, /finance\.manage/);
  assert.match(page, /dataTransfer\.files/);
  assert.match(page, /importDropped/);
  assert.match(page, /Solte para adicionar/);
});
