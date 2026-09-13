import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const key = (namespace, path) => `${namespace}:${String(path).replace(/^\/+/, '')}`;
const encode = (value, label) => {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
    return json;
  } catch (error) {
    if (error instanceof TypeError && error.message.endsWith('must be JSON-serializable.')) throw error;
    throw new TypeError(`${label} must be JSON-serializable.`);
  }
};
const decode = (value) => JSON.parse(value);

export class MemoryStorage {
  #data = new Map();
  async put(path, value, options = {}) { this.#data.set(path, { value, metadata: options.metadata ?? {} }); return { path }; }
  async get(path) { return this.#data.get(path) ?? null; }
  async delete(path) { return this.#data.delete(path); }
  async list(prefix = '') { return [...this.#data.keys()].filter((item) => item.startsWith(prefix)).sort(); }
}

export class SqliteStorage {
  #db;
  #closed = false;
  constructor({ filePath = ':memory:' } = {}) {
    if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('filePath is required.');
    if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
    this.#db = new DatabaseSync(filePath);
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filePath !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(`CREATE TABLE IF NOT EXISTS artisys_storage_entries (
      path TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  }
  #assertOpen() { if (this.#closed) throw new Error('Storage is closed.'); }
  async put(path, value, options = {}) {
    this.#assertOpen();
    const normalized = String(path).replace(/^\/+/, '');
    if (!normalized) throw new TypeError('path is required.');
    this.#db.prepare(`INSERT INTO artisys_storage_entries(path,value_json,metadata_json,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET value_json=excluded.value_json,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
      .run(normalized, encode(value, 'value'), encode(options.metadata ?? {}, 'metadata'), new Date().toISOString());
    return { path: normalized };
  }
  async get(path) {
    this.#assertOpen();
    const normalized = String(path).replace(/^\/+/, '');
    const row = this.#db.prepare('SELECT value_json,metadata_json FROM artisys_storage_entries WHERE path=?').get(normalized);
    return row ? { value: decode(row.value_json), metadata: decode(row.metadata_json) } : null;
  }
  async delete(path) {
    this.#assertOpen();
    return Number(this.#db.prepare('DELETE FROM artisys_storage_entries WHERE path=?').run(String(path).replace(/^\/+/, '')).changes) > 0;
  }
  async list(prefix = '') {
    this.#assertOpen();
    const normalized = String(prefix).replace(/^\/+/, '');
    if (!normalized) return this.#db.prepare('SELECT path FROM artisys_storage_entries ORDER BY path').all().map((row) => row.path);
    return this.#db.prepare('SELECT path FROM artisys_storage_entries WHERE substr(path,1,?)=? ORDER BY path')
      .all(normalized.length, normalized).map((row) => row.path);
  }
  async close() { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}

export function namespaceStorage(storage, namespace) {
  if (!storage || !namespace) throw new TypeError('storage and namespace are required');
  return {
    put: (path, value, options) => storage.put(key(namespace, path), value, options),
    get: (path) => storage.get(key(namespace, path)),
    delete: (path) => storage.delete(key(namespace, path)),
    list: async (prefix = '') => (await storage.list(`${namespace}:${prefix}`)).map((item) => item.slice(namespace.length + 1)),
  };
}
