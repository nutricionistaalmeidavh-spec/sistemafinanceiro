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
    const headerBytes = Math.ceil((json.length + 8) / 4) * 4;
    const header = Buffer.alloc(headerBytes);
    header.writeUInt32LE(headerBytes - 4, 0);
    header.writeUInt32LE(json.length, 4);
    json.copy(header, 8);
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

test('a configuracao exclui somente bibliotecas ja compiladas no renderer e o pacote de staging OCR', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const blocked = [
    'echarts', 'zrender', 'lucide-react', 'react', 'react-dom',
    'scheduler', '@tesseract.js-data/por',
  ];
  for (const name of blocked) {
    assert.ok(pkg.build.files.includes('!**/node_modules/' + name + '/**'),
      'Dependencia redundante permanece empacotada: ' + name);
  }
  for (const name of ['tesseract.js', 'tesseract.js-core', 'pdfjs-dist', 'exceljs', 'docx', 'pdf-lib', '@napi-rs/canvas']) {
    assert.ok(!pkg.build.files.includes('!**/node_modules/' + name + '/**'),
      'Biblioteca necessaria ao processo principal excluida: ' + name);
  }
  assert.deepEqual(pkg.build.extraResources.find(x => x.to === 'ocr-data')?.filter, ['**/*']);
});

test('a verificacao de pacote leve preserva bibliotecas do processo principal e o modelo OCR offline', async () => {
  const { verifyOptimizedPackage } = await import('../scripts/audit-package-size.mjs');
  const groups = ['node_modules/tesseract.js', 'node_modules/tesseract.js-core',
    'node_modules/pdfjs-dist', 'node_modules/exceljs', 'node_modules/docx',
    'node_modules/pdf-lib', 'node_modules/@napi-rs/canvas'];
  const report = {
    asar: { groups: groups.map(name => ({ name, bytes: 10 })) },
    ocrFiles: [{ origin: 'external', path: 'resources/ocr-data/por.traineddata.gz', bytes: 6755162 }],
    duplicateOCR: [],
  };
  assert.doesNotThrow(() => verifyOptimizedPackage(report));
  assert.throws(() => verifyOptimizedPackage({ ...report, asar: { groups: [...report.asar.groups, { name: 'node_modules/echarts', bytes: 10 }] } }), /Redundancias/);
  assert.throws(() => verifyOptimizedPackage({ ...report, ocrFiles: [] }), /OCR offline/);
});
