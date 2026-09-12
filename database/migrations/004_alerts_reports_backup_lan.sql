CREATE TABLE IF NOT EXISTS alert_states (
  user_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('READ','DISMISSED')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, alert_key)
);
CREATE INDEX IF NOT EXISTS idx_alert_states_user_state ON alert_states(user_id,state,updated_at);

CREATE TABLE IF NOT EXISTS internal_alerts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_internal_alerts_window ON internal_alerts(active,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS account_alert_settings (
  account_id TEXT PRIMARY KEY,
  low_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(low_balance_cents >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES financial_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('MANUAL','AUTO','PRE_MIGRATION','PRE_RESTORE')),
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes >= 0),
  schema_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'VERIFIED' CHECK(status IN ('CREATED','VERIFIED','RESTORED','FAILED')),
  created_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_history_kind_created ON backup_history(kind,created_at DESC);

CREATE TABLE IF NOT EXISTS lan_settings (
  id TEXT PRIMARY KEY CHECK(id='default'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  host TEXT NOT NULL DEFAULT '127.0.0.1',
  port INTEGER NOT NULL DEFAULT 4175 CHECK(port >= 0 AND port <= 65535),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO lan_settings(id,enabled,host,port,updated_at)
VALUES ('default',0,'127.0.0.1',4175,CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS lan_pairing_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lan_pairing_expiry ON lan_pairing_codes(used_at,expires_at);

CREATE TABLE IF NOT EXISTS lan_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  identity_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '["finance.view","registry.view"]',
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lan_sessions_expiry ON lan_sessions(revoked_at,expires_at);

UPDATE app_meta SET value='ops-e10-e13-v4', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
