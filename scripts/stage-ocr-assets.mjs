import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve('node_modules/@tesseract.js-data/por');
const output = path.resolve('resources/ocr-data/por.traineddata.gz');
function findData(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 5) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return findData(full, depth + 1);
    if (item.isFile() && /^por\.traineddata(\.gz)?$/i.test(item.name)) return [full];
    return [];
  });
}
const matches = findData(root);
if (!matches.length) throw new Error('Modelo OCR português não encontrado no pacote @tesseract.js-data/por. Não é permitido baixar via CDN no runtime.');
const match = matches.find(file => file.endsWith('.gz')) || matches[0];
let raw = fs.readFileSync(match);
if (!match.endsWith('.gz')) raw = zlib.gzipSync(raw, { level: 9 });
if (raw.length < 100000) throw new Error('Modelo OCR português inesperadamente pequeno');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, raw);
console.log('[ocr:stage] Modelo português preparado para uso offline:', raw.length, 'bytes');
