CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','FINANCE','MANAGER','READONLY')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'OTHER' CHECK(type IN ('CASH','BANK','CARD','OTHER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_document ON customers(document) WHERE document IS NOT NULL AND document <> '';
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS creditors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creditors_document ON creditors(document) WHERE document IS NOT NULL AND document <> '';
CREATE INDEX IF NOT EXISTS idx_creditors_name ON creditors(name);

CREATE TABLE IF NOT EXISTS financial_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nature TEXT NOT NULL CHECK(nature IN ('REVENUE','EXPENSE')),
  dre_group TEXT NOT NULL DEFAULT 'OPERATING',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name,nature)
);
CREATE INDEX IF NOT EXISTS idx_financial_categories_nature ON financial_categories(nature,active,name);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('PAYABLE','RECEIVABLE')),
  description TEXT NOT NULL,
  category_id TEXT,
  account_id TEXT,
  customer_id TEXT,
  creditor_id TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  issue_at TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','SETTLED','CANCELLED')),
  source_type TEXT,
  source_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  FOREIGN KEY(category_id) REFERENCES financial_categories(id),
  FOREIGN KEY(account_id) REFERENCES financial_accounts(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id),
  FOREIGN KEY(creditor_id) REFERENCES creditors(id),
  CHECK((kind='PAYABLE' AND customer_id IS NULL) OR (kind='RECEIVABLE' AND creditor_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_financial_entries_due_status ON financial_entries(status,due_at);
CREATE INDEX IF NOT EXISTS idx_financial_entries_kind_due ON financial_entries(kind,due_at);
CREATE INDEX IF NOT EXISTS idx_financial_entries_category ON financial_entries(category_id,due_at);
CREATE INDEX IF NOT EXISTS idx_financial_entries_customer ON financial_entries(customer_id,due_at);
CREATE INDEX IF NOT EXISTS idx_financial_entries_creditor ON financial_entries(creditor_id,due_at);
CREATE INDEX IF NOT EXISTS idx_financial_entries_source ON financial_entries(source_type,source_id);

CREATE TABLE IF NOT EXISTS financial_settlements (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  method TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  FOREIGN KEY(entry_id) REFERENCES financial_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_financial_settlements_entry ON financial_settlements(entry_id,occurred_at,created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  actor_id TEXT,
  actor_role TEXT,
  context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity,entity_id,created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id,created_at);

UPDATE app_meta SET value='auth-finance-registry-v2', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
