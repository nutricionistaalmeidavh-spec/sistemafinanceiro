import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAsarIndex, packageName, walk } from '../scripts/audit-package-size.mjs';

test('o auditor reconhece entradas e offsets reais do cabecalho ASAR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-asar-test-'));
  try {
    const archive = path.join(dir, 'app.asar');
    const json = Buffer.from(JSON.stringify({ files: {
      dist: { files: { 'index.js': { size: 3, offset: '0' } } },
      node_modules: { files: { foo: { files: { 'native.node': { size: 5, offset: '3', unpacked: true } } } } },
    } }), 'utf8');
    const headerBytes = Math.ceil((json.length + 4) / 4) * 4;
    const header = Buffer.alloc(headerBytes);
    header.writeUInt32LE(json.length, 0);
    json.copy(header, 4);
    const intro = Buffer.alloc(8);
    intro.writeUInt32LE(4, 0);
    intro.writeUInt32LE(headerBytes, 4);
    fs.writeFileSync(archive, Buffer.concat([intro, header, Buffer.from('abc')]));
    const result = readAsarIndex(archive);
    assert.equal(result.contentOffset, 8 + headerBytes);
    assert.deepEqual(result.entries.map(e => [e.path, e.bytes, e.unpacked]), [
      ['dist/index.js', 3, false],
      ['node_modules/foo/native.node', 5, true],
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('o auditor agrupa pacotes npm com escopo sem misturar dependencias', () => {
  assert.equal(packageName('node_modules/@napi-rs/canvas/package.json'), 'node_modules/@napi-rs/canvas');
  assert.equal(packageName('node_modules/tesseract.js/src/index.js'), 'node_modules/tesseract.js');
  assert.equal(packageName('dist/assets/index.js'), 'dist');
});

test('o auditor mede arquivos em subpastas sem considerar pastas como arquivos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-walk-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'resources'));
    fs.writeFileSync(path.join(dir, 'resources', 'canvas.node'), '12345678');
    const result = walk(dir);
    assert.deepEqual(result.map(x => [x.path, x.bytes]), [['resources/canvas.node', 8]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
