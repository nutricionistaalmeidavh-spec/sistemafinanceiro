'use strict';

const http = require('node:http');
const os = require('node:os');
const { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');
const { mobilePageHtml } = require('../lan/mobile-page.cjs');

function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function safeEqual(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function addMs(iso, ms) { return new Date(Date.parse(String(iso)) + ms).toISOString(); }
function json(res, status, body) { const data = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' }); res.end(data); }
async function readJson(req, limit = 64 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('request body too large'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('invalid JSON body'); }
}

function createLanService({
  db,
  finance,
  cashflow,
  analytics,
  alerts,
  now = () => new Date().toISOString(),
  idFactory = (prefix) => `${prefix}-${randomUUID()}`,
  tokenFactory = () => randomBytes(32).toString('hex'),
  codeFactory = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  pairingTtlMs = 5 * 60 * 1000,
  sessionTtlMs = 12 * 60 * 60 * 1000,
} = {}) {
  if (!db || !finance || !cashflow || !analytics || !alerts) throw new TypeError('db, finance, cashflow, analytics and alerts are required');
  const nowIso = () => String(now());
  let server = null;
  let address = null;
  const pairAttempts = new Map();

  function settings() {
    const row = db.prepare("SELECT * FROM lan_settings WHERE id='default'").get();
    return { enabled: Boolean(row?.enabled), host: row?.host || '127.0.0.1', port: Number(row?.port ?? 4175), updatedAt: row?.updated_at || null };
  }

  function accessibleUrls(host, port) {
    if (!port) return [];
    if (host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}`];
    const urls = [];
    for (const values of Object.values(os.networkInterfaces())) for (const item of values || []) {
      if (item.family === 'IPv4' && !item.internal) urls.push(`http://${item.address}:${port}`);
    }
    return [...new Set(urls)];
  }

  function status() {
    const config = settings();
    return { ...config, running: Boolean(server), address, urls: address ? accessibleUrls(config.host, address.port) : [] };
  }

  function configure({ enabled, host = '127.0.0.1', port = 4175 } = {}, actor = null) {
    const normalizedHost = String(host || '127.0.0.1').trim();
    if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(normalizedHost)) throw new Error('LAN host must be loopback or all interfaces');
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 0 || normalizedPort > 65535) throw new Error('invalid LAN port');
    const timestamp = nowIso();
    db.prepare("UPDATE lan_settings SET enabled=?,host=?,port=?,updated_at=? WHERE id='default'").run(enabled ? 1 : 0, normalizedHost, normalizedPort, timestamp);
    if (!enabled) {
      db.prepare('UPDATE lan_sessions SET revoked_at=? WHERE revoked_at IS NULL').run(timestamp);
      db.prepare('UPDATE lan_pairing_codes SET used_at=COALESCE(used_at,?) WHERE used_at IS NULL').run(timestamp);
    }
    writeAudit(db, { action: enabled ? 'lan.enable' : 'lan.disable', entity: 'lan-settings', entityId: 'default', actor, context: { host: normalizedHost, port: normalizedPort } }, nowIso);
    return status();
  }

  function createPairingCode(actor = null) {
    const config = settings();
    if (!config.enabled) throw new Error('LAN access is disabled');
    const code = codeFactory();
    if (!/^\d{6}$/.test(code)) throw new Error('pairing code generator must return six digits');
    const createdAt = nowIso();
    const id = idFactory('pair');
    const expiresAt = addMs(createdAt, pairingTtlMs);
    db.prepare('DELETE FROM lan_pairing_codes WHERE expires_at<? OR used_at IS NOT NULL').run(createdAt);
    db.prepare('INSERT INTO lan_pairing_codes(id,code_hash,expires_at,used_at,created_by,created_at) VALUES (?,?,?,NULL,?,?)')
      .run(id, hash(code), expiresAt, actor?.id || null, createdAt);
    writeAudit(db, { action: 'lan.pairing.create', entity: 'lan-pairing', entityId: id, actor, context: { expiresAt } }, nowIso);
    return { id, code, expiresAt };
  }

  function notePairAttempt(ip) {
    const key = String(ip || 'unknown');
    const currentMs = Date.parse(nowIso());
    const record = pairAttempts.get(key);
    if (!record || currentMs - record.windowStart >= 60_000) { pairAttempts.set(key, { windowStart: currentMs, count: 1 }); return; }
    record.count += 1;
    if (record.count > 10) throw new Error('too many pairing attempts');
  }

  function exchangePairingCode(code, ip = '') {
    notePairAttempt(ip);
    const normalized = String(code || '').trim();
    if (!/^\d{6}$/.test(normalized)) throw new Error('invalid pairing code');
    const current = nowIso();
    const codeHash = hash(normalized);
    const candidates = db.prepare('SELECT * FROM lan_pairing_codes WHERE used_at IS NULL AND expires_at>=?').all(current);
    const pair = candidates.find((row) => safeEqual(row.code_hash, codeHash));
    if (!pair) throw new Error('invalid or expired pairing code');
    db.prepare('UPDATE lan_pairing_codes SET used_at=? WHERE id=? AND used_at IS NULL').run(current, pair.id);
    const sessionId = idFactory('lan-session');
    const token = tokenFactory();
    const tokenHash = hash(token);
    const expiresAt = addMs(current, sessionTtlMs);
    const identityId = `lan:${sessionId}`;
    const permissions = ['finance.view', 'registry.view'];
    db.prepare('INSERT INTO lan_sessions(id,token_hash,identity_id,permissions_json,expires_at,revoked_at,created_at,last_seen_at) VALUES (?,?,?,?,?,NULL,?,?)')
      .run(sessionId, tokenHash, identityId, JSON.stringify(permissions), expiresAt, current, current);
    return { token, expiresAt, permissions };
  }

  function validateToken(token) {
    const raw = String(token || '');
    if (!raw) throw new Error('LAN authentication required');
    const current = nowIso();
    const tokenHash = hash(raw);
    const rows = db.prepare('SELECT * FROM lan_sessions WHERE revoked_at IS NULL AND expires_at>?').all(current);
    const row = rows.find((item) => safeEqual(item.token_hash, tokenHash));
    if (!row) throw new Error('invalid or expired LAN token');
    db.prepare('UPDATE lan_sessions SET last_seen_at=? WHERE id=?').run(current, row.id);
    return { id: row.id, identityId: row.identity_id, permissions: JSON.parse(row.permissions_json || '[]'), expiresAt: row.expires_at };
  }

  function bearer(req) {
    const header = String(req.headers.authorization || '');
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match?.[1] || '';
  }

  async function route(req, res) {
    const config = settings();
    if (!config.enabled) return json(res, 503, { error: 'LAN access disabled' });
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') {
      const html = Buffer.from(mobilePageHtml(), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); res.end(html); return;
    }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, lan: true });
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      try { const body = await readJson(req); return json(res, 200, exchangePairingCode(body.code, req.socket.remoteAddress)); }
      catch (error) { return json(res, /too many/i.test(error.message) ? 429 : 401, { error: error.message }); }
    }
    let session;
    try { session = validateToken(bearer(req)); } catch (error) { return json(res, 401, { error: error.message }); }
    if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res, 200, analytics.getDashboardSnapshot({ year: Number(url.searchParams.get('year')) || Number(nowIso().slice(0, 4)) }));
    if (req.method === 'GET' && url.pathname === '/api/accounts') return json(res, 200, cashflow.getAccountBalances({ asOf: url.searchParams.get('asOf') || nowIso().slice(0, 10) }));
    if (req.method === 'GET' && url.pathname === '/api/alerts') return json(res, 200, alerts.listAlerts({ userId: session.identityId, asOf: url.searchParams.get('asOf') || nowIso().slice(0, 10) }));
    const ack = /^\/api\/alerts\/(.+)\/ack$/.exec(url.pathname);
    if (req.method === 'POST' && ack) {
      const body = await readJson(req).catch(() => ({}));
      return json(res, 200, alerts.acknowledge(decodeURIComponent(ack[1]), session.identityId, body.state || 'READ'));
    }
    if (req.method === 'GET' && url.pathname === '/api/entries') {
      const filters = {};
      for (const key of ['kind','status','from','to','query']) if (url.searchParams.get(key)) filters[key] = url.searchParams.get(key);
      return json(res, 200, finance.listEntries(filters));
    }
    return json(res, 404, { error: 'not found' });
  }

  async function startConfigured() {
    if (server) return address;
    const config = settings();
    if (!config.enabled) return null;
    server = http.createServer((req, res) => { Promise.resolve(route(req, res)).catch((error) => { if (!res.headersSent) json(res, 500, { error: error.message }); else res.end(); }); });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
    } catch (error) { server = null; throw error; }
    const raw = server.address();
    address = { host: typeof raw === 'object' && raw ? raw.address : config.host, port: typeof raw === 'object' && raw ? raw.port : config.port };
    return address;
  }

  async function stop() {
    if (!server) { address = null; return; }
    const current = server; server = null; address = null;
    await new Promise((resolve, reject) => current.close((error) => error ? reject(error) : resolve()));
  }

  return { settings, status, configure, createPairingCode, exchangePairingCode, validateToken, startConfigured, stop };
}

module.exports = { createLanService };
