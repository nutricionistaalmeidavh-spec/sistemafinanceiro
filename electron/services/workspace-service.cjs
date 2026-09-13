'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function safeName(value) {
  const name = String(value ?? '').trim();
  if (!name || name === '.' || name === '..') throw new Error('invalid workspace name');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || WINDOWS_RESERVED.test(name)) throw new Error('invalid workspace name');
  return name;
}

function normalizeRelative(value = '') {
  const raw = String(value ?? '').replace(/\\/g, '/').trim();
  if (!raw) return '';
  if (raw.includes('\0') || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) throw new Error('invalid workspace path');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('path outside workspace');
  return normalized === '.' ? '' : normalized;
}

function parentOf(relativePath) {
  const parent = path.posix.dirname(relativePath || '');
  return parent === '.' ? '' : parent;
}

function fileInfo(fullPath, relativePath) {
  const stat = fs.statSync(fullPath);
  const folder = stat.isDirectory();
  return {
    name: path.basename(fullPath),
    path: relativePath.replace(/\\/g, '/'),
    parentPath: parentOf(relativePath.replace(/\\/g, '/')),
    type: folder ? 'folder' : 'file',
    extension: folder ? '' : path.extname(fullPath).slice(1).toLowerCase(),
    size: folder ? 0 : stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

function createWorkspaceService({
  rootDir,
  storageFile = null,
  metadataStorage = null,
  shell = null,
  now = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
} = {}) {
  if (!rootDir) throw new TypeError('rootDir is required');
  const root = path.resolve(rootDir);
  const trashRoot = path.join(root, '.trash');
  fs.mkdirSync(trashRoot, { recursive: true });
  let ownedStorage = null;
  let storagePromise = null;

  async function storage() {
    if (metadataStorage) return metadataStorage;
    if (!storagePromise) {
      storagePromise = import('@artisys/storage').then(({ SqliteStorage, namespaceStorage }) => {
        ownedStorage = new SqliteStorage({ filePath: storageFile || path.join(root, '.workspace-meta.sqlite') });
        return namespaceStorage(ownedStorage, 'personal-workspace');
      });
    }
    return storagePromise;
  }

  function resolveInside(relativePath = '', { allowTrash = false } = {}) {
    const rel = normalizeRelative(relativePath);
    if (!allowTrash && (rel === '.trash' || rel.startsWith('.trash/'))) throw new Error('invalid workspace path');
    const full = path.resolve(root, ...rel.split('/').filter(Boolean));
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error('path outside workspace');
    return { rel, full };
  }

  function requireExisting(relativePath, options) {
    const resolved = resolveInside(relativePath, options);
    if (!fs.existsSync(resolved.full)) throw new Error('workspace item not found');
    return resolved;
  }

  function requireDirectory(relativePath) {
    const resolved = requireExisting(relativePath);
    if (!fs.statSync(resolved.full).isDirectory()) throw new Error('workspace path is not a folder');
    return resolved;
  }

  function destinationFor(targetDir, name) {
    const target = requireDirectory(targetDir);
    const cleaned = safeName(name);
    const full = path.join(target.full, cleaned);
    if (fs.existsSync(full)) throw new Error('workspace item already exists');
    return { full, rel: target.rel ? `${target.rel}/${cleaned}` : cleaned };
  }

  function uniqueDestination(targetDir, name) {
    const target = requireDirectory(targetDir);
    const cleaned = safeName(name);
    const ext = path.extname(cleaned);
    const stem = ext ? cleaned.slice(0, -ext.length) : cleaned;
    let candidate = cleaned;
    let index = 1;
    while (fs.existsSync(path.join(target.full, candidate))) candidate = `${stem} (${index++})${ext}`;
    return { full: path.join(target.full, candidate), rel: target.rel ? `${target.rel}/${candidate}` : candidate, name: candidate };
  }

  async function list(relativePath = '') {
    const current = requireDirectory(relativePath);
    const items = fs.readdirSync(current.full, { withFileTypes: true })
      .filter((entry) => entry.name !== '.trash' && entry.name !== '.workspace-meta.sqlite' && !entry.name.startsWith('.workspace-meta.sqlite-'))
      .map((entry) => {
        const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
        return fileInfo(path.join(current.full, entry.name), rel);
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) : a.type === 'folder' ? -1 : 1));
    return { path: current.rel, parentPath: parentOf(current.rel), items };
  }

  async function tree(relativePath = '', depth = 0, maxDepth = 8) {
    const current = requireDirectory(relativePath);
    const node = { name: current.rel ? path.basename(current.full) : 'Workspace', path: current.rel, children: [] };
    if (depth >= maxDepth) return node;
    const directories = fs.readdirSync(current.full, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '.trash')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    for (const entry of directories) {
      const child = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      node.children.push(await tree(child, depth + 1, maxDepth));
    }
    return node;
  }

  async function createFolder(parentPath, name) {
    const destination = destinationFor(parentPath, name);
    fs.mkdirSync(destination.full);
    return fileInfo(destination.full, destination.rel);
  }

  async function createFile(parentPath, name, content = '') {
    const destination = destinationFor(parentPath, name);
    fs.writeFileSync(destination.full, String(content ?? ''), { encoding: 'utf8', flag: 'wx' });
    return fileInfo(destination.full, destination.rel);
  }

  async function importFiles(targetPath, sourcePaths = []) {
    requireDirectory(targetPath);
    const imported = [];
    for (const sourceValue of sourcePaths) {
      const source = path.resolve(String(sourceValue || ''));
      if (!sourceValue || !fs.existsSync(source)) continue;
      if (source === root || source.startsWith(root + path.sep)) continue;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) continue;
      const destination = uniqueDestination(targetPath, path.basename(source));
      if (stat.isDirectory()) {
        fs.cpSync(source, destination.full, {
          recursive: true,
          errorOnExist: true,
          force: false,
          filter: (entry) => !fs.lstatSync(entry).isSymbolicLink(),
        });
      } else {
        fs.copyFileSync(source, destination.full, fs.constants.COPYFILE_EXCL);
      }
      imported.push(fileInfo(destination.full, destination.rel));
    }
    return imported;
  }

  async function rename(relativePath, newName) {
    const source = requireExisting(relativePath);
    if (!source.rel) throw new Error('workspace root cannot be renamed');
    const destination = destinationFor(parentOf(source.rel), newName);
    fs.renameSync(source.full, destination.full);
    return fileInfo(destination.full, destination.rel);
  }

  async function move(relativePath, targetPath) {
    const source = requireExisting(relativePath);
    if (!source.rel) throw new Error('workspace root cannot be moved');
    const target = requireDirectory(targetPath);
    if (fs.statSync(source.full).isDirectory() && (target.full === source.full || target.full.startsWith(`${source.full}${path.sep}`))) throw new Error('cannot move a folder into itself');
    const destination = destinationFor(target.rel, path.basename(source.full));
    fs.renameSync(source.full, destination.full);
    return fileInfo(destination.full, destination.rel);
  }

  async function copy(relativePath, targetPath) {
    const source = requireExisting(relativePath);
    if (!source.rel) throw new Error('workspace root cannot be copied');
    const destination = destinationFor(targetPath, path.basename(source.full));
    fs.cpSync(source.full, destination.full, { recursive: true, errorOnExist: true, force: false });
    return fileInfo(destination.full, destination.rel);
  }

  async function trash(relativePath) {
    const source = requireExisting(relativePath);
    if (!source.rel) throw new Error('workspace root cannot be deleted');
    const id = idFactory();
    const storedName = `${id}--${path.basename(source.full)}`;
    const storedFull = path.join(trashRoot, storedName);
    fs.renameSync(source.full, storedFull);
    const record = {
      id,
      name: path.basename(source.full),
      originalPath: source.rel,
      storedName,
      deletedAt: now(),
      type: fs.statSync(storedFull).isDirectory() ? 'folder' : 'file',
    };
    const meta = await storage();
    await meta.put(`trash/${id}`, record);
    return record;
  }

  async function listTrash() {
    const meta = await storage();
    const keys = await meta.list('trash/');
    const rows = [];
    for (const key of keys) {
      const entry = await meta.get(key);
      if (!entry?.value) continue;
      const record = entry.value;
      if (fs.existsSync(path.join(trashRoot, record.storedName))) rows.push(record);
      else await meta.delete(key);
    }
    return rows.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  }

  async function restore(id) {
    const meta = await storage();
    const entry = await meta.get(`trash/${id}`);
    if (!entry?.value) throw new Error('trash item not found');
    const record = entry.value;
    const stored = path.join(trashRoot, record.storedName);
    if (!fs.existsSync(stored)) {
      await meta.delete(`trash/${id}`);
      throw new Error('trash item not found');
    }
    let targetParent = parentOf(record.originalPath);
    try { requireDirectory(targetParent); } catch { targetParent = ''; }
    const destination = uniqueDestination(targetParent, record.name);
    fs.renameSync(stored, destination.full);
    await meta.delete(`trash/${id}`);
    return fileInfo(destination.full, destination.rel);
  }

  async function deleteForever(id) {
    const meta = await storage();
    const entry = await meta.get(`trash/${id}`);
    if (!entry?.value) return false;
    fs.rmSync(path.join(trashRoot, entry.value.storedName), { recursive: true, force: true });
    await meta.delete(`trash/${id}`);
    return true;
  }

  async function search(query, { limit = 200 } = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase('pt-BR');
    if (!needle) return [];
    const results = [];
    const walk = (dirFull, dirRel) => {
      if (results.length >= limit) return;
      for (const entry of fs.readdirSync(dirFull, { withFileTypes: true })) {
        if (entry.name === '.trash' || entry.name.startsWith('.workspace-meta.sqlite')) continue;
        const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        const full = path.join(dirFull, entry.name);
        if (entry.name.toLocaleLowerCase('pt-BR').includes(needle)) results.push(fileInfo(full, rel));
        if (entry.isDirectory()) walk(full, rel);
        if (results.length >= limit) break;
      }
    };
    walk(root, '');
    return results;
  }

  async function open(relativePath) {
    const source = requireExisting(relativePath);
    if (!shell?.openPath) return { opened: false, reason: 'shell-unavailable' };
    const error = await shell.openPath(source.full);
    if (error) throw new Error(error);
    return { opened: true };
  }

  async function reveal(relativePath) {
    const source = requireExisting(relativePath);
    if (!shell?.showItemInFolder) return { revealed: false, reason: 'shell-unavailable' };
    shell.showItemInFolder(source.full);
    return { revealed: true };
  }

  async function preferences() {
    const meta = await storage();
    const entry = await meta.get('preferences');
    return entry?.value || { viewMode: 'list', sortBy: 'name', sortDirection: 'asc' };
  }

  async function setPreferences(next) {
    const current = await preferences();
    const value = { ...current, ...(next || {}) };
    if (!['list', 'grid'].includes(value.viewMode)) value.viewMode = 'list';
    if (!['name', 'modifiedAt', 'size', 'type'].includes(value.sortBy)) value.sortBy = 'name';
    if (!['asc', 'desc'].includes(value.sortDirection)) value.sortDirection = 'asc';
    const meta = await storage();
    await meta.put('preferences', value);
    return value;
  }

  async function close() {
    if (ownedStorage?.close) await ownedStorage.close();
  }

  return {
    list,
    tree,
    createFolder,
    createFile,
    importFiles,
    rename,
    move,
    copy,
    trash,
    listTrash,
    restore,
    deleteForever,
    search,
    open,
    reveal,
    preferences,
    setPreferences,
    close,
    rootDir: root,
  };
}

module.exports = { createWorkspaceService, normalizeRelative, safeName };
