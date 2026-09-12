'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { writeAudit } = require('./audit.cjs');

const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: ['*'],
  FINANCE: ['finance.view', 'finance.manage', 'registry.view', 'registry.manage'],
  MANAGER: ['finance.view', 'finance.manage', 'registry.view', 'registry.manage', 'users.view'],
  READONLY: ['finance.view', 'registry.view'],
});

function normalizeLogin(value) { return String(value ?? '').trim().toLowerCase(); }
function hashPassword(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    return aa.length > 0 && aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch { return false; }
}
function publicUser(row) {
  if (!row) return null;
  return { id: row.id, login: row.login, name: row.name, role: row.role, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}
function permissionsForRole(role) { return [...(ROLE_PERMISSIONS[role] || [])]; }
function hasPermission(user, permission) {
  if (!user || !Boolean(user.active)) return false;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function createAuthService({
  db,
  now = () => new Date().toISOString(),
  tokenFactory = () => randomBytes(32).toString('hex'),
  idFactory = () => `user-${randomUUID()}`,
  sessionTtlMs = 12 * 60 * 60 * 1000,
} = {}) {
  if (!db) throw new TypeError('Database is required.');
  const sessions = new Map();
  const failures = new Map();
  const nowIso = () => String(now());
  const clockMs = () => {
    const value = now();
    if (typeof value === 'number') return value;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : Date.now();
  };
  const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(String(id));
  const getUserByLogin = (login) => db.prepare('SELECT * FROM users WHERE login=?').get(normalizeLogin(login));
  const cleanSessions = () => {
    const current = clockMs();
    for (const [token, session] of sessions) if (session.expiresAt <= current) sessions.delete(token);
  };
  const requireSession = (token) => {
    cleanSessions();
    const session = sessions.get(String(token || ''));
    if (!session) throw new Error('authentication required');
    const user = getUserById(session.userId);
    if (!user || !Boolean(user.active)) {
      sessions.delete(String(token || ''));
      throw new Error('authentication required');
    }
    return user;
  };
  const assertPassword = (password) => {
    if (typeof password !== 'string' || password.length < 10) throw new Error('password must contain at least 10 characters');
  };

  return {
    needsBootstrap() {
      return !db.prepare("SELECT 1 ok FROM users WHERE id='local-admin' OR role='ADMIN' LIMIT 1").get();
    },
    bootstrapAdmin({ password, name = 'Administrador' } = {}) {
      if (!this.needsBootstrap()) throw new Error('administrator already configured');
      assertPassword(password);
      const salt = randomBytes(16).toString('hex');
      const timestamp = nowIso();
      db.prepare(`INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at)
        VALUES ('local-admin','admin',?,'ADMIN',?,?,1,?,?)`).run(String(name || 'Administrador').trim(), hashPassword(password, salt), salt, timestamp, timestamp);
      writeAudit(db, { action: 'auth.bootstrap', entity: 'user', entityId: 'local-admin', actor: { id: 'local-admin', role: 'ADMIN' }, context: { login: 'admin' } }, nowIso);
      return publicUser(getUserById('local-admin'));
    },
    authenticate(login, password) {
      const key = normalizeLogin(login);
      const current = clockMs();
      const failure = failures.get(key);
      if (failure?.blockedUntil > current) throw new Error('too many failed attempts; try again later');
      const user = getUserByLogin(key);
      const valid = user && Boolean(user.active) && typeof password === 'string' && safeEqualHex(hashPassword(password, user.password_salt), user.password_hash);
      if (!valid) {
        const count = (failure?.count || 0) + 1;
        failures.set(key, { count, blockedUntil: count >= 5 ? current + 60_000 : 0 });
        throw new Error('invalid login or password');
      }
      failures.delete(key);
      const token = tokenFactory();
      const expiresAt = current + sessionTtlMs;
      sessions.set(token, { userId: user.id, expiresAt });
      writeAudit(db, { action: 'auth.login', entity: 'user', entityId: user.id, actor: user, context: {} }, nowIso);
      return { token, expiresAt, user: publicUser(user), permissions: permissionsForRole(user.role) };
    },
    logout(token) { sessions.delete(String(token || '')); },
    session(token) {
      const user = requireSession(token);
      return { user: publicUser(user), permissions: permissionsForRole(user.role) };
    },
    require(token, permission) {
      const user = requireSession(token);
      if (!hasPermission(user, permission)) throw new Error(`permission denied: ${permission}`);
      return publicUser(user);
    },
    listUsers(actorToken) {
      this.require(actorToken, 'users.view');
      return db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE, login').all().map(publicUser);
    },
    createUser(actorToken, input = {}) {
      const actor = this.require(actorToken, 'users.manage');
      const login = normalizeLogin(input.login);
      const name = String(input.name || '').trim();
      const role = String(input.role || '').toUpperCase();
      if (!login) throw new Error('login is required');
      if (!name) throw new Error('name is required');
      if (!ROLE_PERMISSIONS[role]) throw new Error('invalid role');
      assertPassword(input.password);
      if (getUserByLogin(login)) throw new Error('login already exists');
      const salt = randomBytes(16).toString('hex');
      const timestamp = nowIso();
      const id = String(idFactory('user'));
      db.prepare(`INSERT INTO users(id,login,name,role,password_hash,password_salt,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?)`).run(id, login, name, role, hashPassword(input.password, salt), salt, timestamp, timestamp);
      writeAudit(db, { action: 'user.create', entity: 'user', entityId: id, actor, context: { login, role } }, nowIso);
      return publicUser(getUserById(id));
    },
    setUserActive(actorToken, userId, active) {
      const actor = this.require(actorToken, 'users.manage');
      if (String(userId) === actor.id && !active) throw new Error('cannot disable current user');
      const timestamp = nowIso();
      const result = db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, timestamp, String(userId));
      if (!result.changes) throw new Error('user not found');
      writeAudit(db, { action: active ? 'user.enable' : 'user.disable', entity: 'user', entityId: userId, actor, context: {} }, nowIso);
      return publicUser(getUserById(userId));
    },
  };
}

module.exports = { ROLE_PERMISSIONS, permissionsForRole, hasPermission, createAuthService };
