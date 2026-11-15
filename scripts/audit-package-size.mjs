import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function walk(root, current = root) {
  const result = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...walk(root, absolute));
    else if (entry.isFile()) result.push({ path: path.relative(root, absolute).replaceAll('\\', '/'), bytes: fs.statSync(absolute).size, absolute });
  }
  return result;
}

export function readAsarIndex(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  try {
    const sizeInfo = Buffer.alloc(8);
    if (fs.readSync(fd, sizeInfo, 0, 8, 0) !== 8) throw new Error('ASAR incompleto (cabecalho)');
    const headerSize = sizeInfo.readUInt32LE(4);
    if (headerSize < 8 || headerSize > 80 * 1024 * 1024) throw new Error('ASAR com tamanho de cabecalho invalido');
    const headerData = Buffer.alloc(headerSize);
    if (fs.readSync(fd, headerData, 0, headerSize, 8) !== headerSize) throw new Error('ASAR com cabecalho truncado');
    const jsonSize = headerData.readUInt32LE(4);
    if (jsonSize < 2 || jsonSize > headerSize - 8) throw new Error('ASAR com tamanho JSON invalido');
    const header = JSON.parse(headerData.toString('utf8', 8, 8 + jsonSize));
    const entries = [];
    function visit(node, prefix) {
      for (const [name, item] of Object.entries(node.files ?? {})) {
        const relative = prefix ? prefix + '/' + name : name;
        if (item.files) visit(item, relative);
        else if (typeof item.size === 'number') entries.push({
          path: relative,
          bytes: item.size,
          unpacked: item.unpacked === true,
          offset: item.offset === undefined ? null : Number(item.offset),
        });
      }
    }
    visit(header, '');
    return { entries, contentOffset: 8 + headerSize };
  } finally { fs.closeSync(fd); }
}

export function packageName(relative) {
  const parts = relative.split('/');
  if (parts[0] !== 'node_modules') return parts[0] || '(root)';
  if (parts[1]?.startsWith('@')) return 'node_modules/' + parts.slice(1, 3).join('/');
  return 'node_modules/' + (parts[1] || '(unknown)');
}

function largest(items, n) {
  return [...items].sort((a, b) => b.bytes - a.bytes).slice(0, n).map(({ path: p, bytes }) => ({ path: p, bytes }));
}
function totals(rows, grouping) {
  const result = new Map();
  for (const row of rows) {
    const group = grouping(row);
    result.set(group, (result.get(group) || 0) + row.bytes);
  }
  return [...result.entries()].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
}
function location(relative) {
  const parts = relative.split('/');
  if (relative === 'resources/app.asar') return 'app.asar';
  if (relative.startsWith('resources/app.asar.unpacked/')) return 'app.asar.unpacked';
  if (relative.startsWith('resources/ocr-data/')) return 'OCR extraResources';
  if (parts[0] === 'locales') return 'Electron locales';
  if (parts[0] === 'resources') return 'Outros recursos Electron';
  return 'Runtime Electron e binarios raiz';
}
function checksum(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function packagedDigest(asarPath, entry, contentOffset) {
  if (entry.unpacked || entry.offset === null || entry.bytes > 100 * 1024 * 1024) return null;
  const fd = fs.openSync(asarPath, 'r');
  try {
    const data = Buffer.alloc(entry.bytes);
    if (fs.readSync(fd, data, 0, entry.bytes, contentOffset + entry.offset) !== entry.bytes) return null;
    return checksum(data);
  } finally { fs.closeSync(fd); }
}

export function auditPackage(releaseDir) {
  const unpacked = path.join(releaseDir, 'win-unpacked');
  const asarPath = path.join(unpacked, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error('ASAR do aplicativo nao encontrado em: ' + asarPath);
  const setup = fs.readdirSync(releaseDir).find(name => /^ArtiSys-Financeiro-Setup-.*\.exe$/.test(name));
  if (!setup) throw new Error('Instalador NSIS nao encontrado');
  const installed = walk(unpacked);
  const index = readAsarIndex(asarPath);
  const arEntries = index.entries;
  const isOCR = p => /(?:^|\/)por\.traineddata(?:\.gz)?$/i.test(p);
  const ocrFiles = [
    ...installed.filter(x => isOCR(x.path)).map(x => ({ origin: 'external', path: x.path, bytes: x.bytes, sha256: checksum(fs.readFileSync(x.absolute)) })),
    ...arEntries.filter(x => isOCR(x.path)).map(x => ({ origin: x.unpacked ? 'asar-unpacked' : 'asar', path: x.path, bytes: x.bytes, sha256: packagedDigest(asarPath, x, index.contentOffset) })),
  ];
  const duplicateOCR = ocrFiles.filter((f, i) => f.sha256 && ocrFiles.some((g, j) => j !== i && g.sha256 === f.sha256));
  const nativeExtension = /\.(?:node|dll|so|dylib)$/i;
  const native = installed.filter(x => nativeExtension.test(x.path) && x.path.startsWith('resources/'))
    .map(({ path: p, bytes }) => ({ path: p, bytes }));
  const nativeInAsar = arEntries.filter(x => nativeExtension.test(x.path)).map(({ path: p, bytes, unpacked: u }) => ({ path: p, bytes, unpacked: u }));
  return {
    version: JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version,
    installer: { name: setup, bytes: fs.statSync(path.join(releaseDir, setup)).size },
    installed: { bytes: installed.reduce((sum, f) => sum + f.bytes, 0), files: installed.length },
    installedGroups: totals(installed, x => location(x.path)),
    largestInstalled: largest(installed, 35),
    asar: {
      bytes: fs.statSync(asarPath).size,
      indexedEntries: arEntries.length,
      declaredBytes: arEntries.reduce((sum, x) => sum + x.bytes, 0),
      packedDeclaredBytes: arEntries.filter(x => !x.unpacked).reduce((sum, x) => sum + x.bytes, 0),
      groups: totals(arEntries, x => packageName(x.path)),
      largestEntries: largest(arEntries, 35),
    },
    native: { outsideAsar: native, insideAsar: nativeInAsar },
    ocrFiles,
    duplicateOCR,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const releaseDir = path.resolve(process.argv[2] || 'release');
  try {
    const report = auditPackage(releaseDir);
    const output = path.resolve('qa-artifacts/size-audit/report.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    const mb = bytes => (bytes / 1024 / 1024).toFixed(2) + ' MiB';
    console.log('[SIZE AUDIT] NSIS:', report.installer.name, mb(report.installer.bytes));
    console.log('[SIZE AUDIT] Instalacao expandida:', mb(report.installed.bytes));
    console.log('[SIZE AUDIT] ASAR:', mb(report.asar.bytes), 'entradas:', report.asar.indexedEntries);
    console.log('[SIZE AUDIT] Grupos no pacote:');
    for (const g of report.installedGroups) console.log(' ', mb(g.bytes), g.name);
    console.log('[SIZE AUDIT] Maiores arquivos:');
    for (const f of report.largestInstalled.slice(0, 18)) console.log(' ', mb(f.bytes), f.path);
    console.log('[SIZE AUDIT] Maiores grupos do app.asar:');
    for (const g of report.asar.groups.slice(0, 35)) console.log(' ', mb(g.bytes), g.name);
    console.log('[SIZE AUDIT] Arquivos nativos encontrados:', report.native.outsideAsar.length, 'fora /', report.native.insideAsar.length, 'no indice ASAR');
    for (const n of [...report.native.outsideAsar, ...report.native.insideAsar].sort((a,b) => b.bytes-a.bytes).slice(0, 30)) console.log(' ', mb(n.bytes), n.path);
    console.log('[SIZE AUDIT] OCR modelos e copias:', JSON.stringify(report.ocrFiles));
    console.log('[SIZE AUDIT] OCR hashes duplicados:', report.duplicateOCR.length);
    console.log('[SIZE AUDIT] Relatorio completo:', output);
  } catch (error) {
    console.error('[SIZE AUDIT] Erro:', error.stack || error.message);
    process.exitCode = 1;
  }
}
