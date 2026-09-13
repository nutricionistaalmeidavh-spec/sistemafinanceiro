import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkspaceService } = require('../electron/services/workspace-service.cjs');

function memoryStorage() {
  const map = new Map();
  return {
    async put(key, value, options = {}) { map.set(key, { value, metadata: options.metadata ?? {} }); return { path: key }; },
    async get(key) { return map.get(key) ?? null; },
    async delete(key) { return map.delete(key); },
    async list(prefix = '') { return [...map.keys()].filter((key) => key.startsWith(prefix)).sort(); },
  };
}

test('workspace manages folders and files inside its root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-workspace-'));
  try {
    const service = createWorkspaceService({ rootDir: root, metadataStorage: memoryStorage() });
    await service.createFolder('', 'Casa');
    await service.createFile('Casa', 'notas.txt', 'teste');
    await service.copy('Casa/notas.txt', '');
    await service.rename('notas.txt', 'copia.txt');
    await service.move('copia.txt', 'Casa');

    const casa = await service.list('Casa');
    assert.deepEqual(casa.items.map((item) => item.name).sort(), ['copia.txt', 'notas.txt']);

    const found = await service.search('notas');
    assert.equal(found.length, 1);
    assert.equal(found[0].path, 'Casa/notas.txt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace trash restores items and rejects path traversal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-workspace-'));
  try {
    const service = createWorkspaceService({ rootDir: root, metadataStorage: memoryStorage(), idFactory: () => 'trash-1' });
    await service.createFolder('', 'Documentos');
    await service.createFile('Documentos', 'boleto.txt', 'conteudo');
    await service.trash('Documentos/boleto.txt');

    const trash = await service.listTrash();
    assert.equal(trash.length, 1);
    assert.equal(trash[0].originalPath, 'Documentos/boleto.txt');

    await service.restore('trash-1');
    assert.equal((await service.list('Documentos')).items.some((item) => item.name === 'boleto.txt'), true);
    await assert.rejects(() => service.list('../fora'), /outside workspace|invalid workspace path/i);
    await assert.rejects(() => service.createFolder('', 'a/b'), /invalid workspace name/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('workspace persists explorer preferences through storage contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-workspace-'));
  try {
    const service = createWorkspaceService({ rootDir: root, metadataStorage: memoryStorage() });
    assert.equal((await service.preferences()).viewMode, 'list');
    const saved = await service.setPreferences({ viewMode: 'grid', sortBy: 'modifiedAt', sortDirection: 'desc' });
    assert.deepEqual(saved, { viewMode: 'grid', sortBy: 'modifiedAt', sortDirection: 'desc' });
    assert.deepEqual(await service.preferences(), saved);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
