ALTER TABLE financial_settlements ADD COLUMN account_id TEXT REFERENCES financial_accounts(id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  type TEXT NOT NULL CHECK(type IN ('OPENING','DEPOSIT','WITHDRAWAL','TRANSFER','ADJUSTMENT')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  occurred_at TEXT NOT NULL,
  note TEXT,
  transfer_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES financial_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_account_date ON cash_movements(account_id,occurred_at,created_at);
CREATE INDEX IF NOT EXISTS idx_cash_movements_transfer ON cash_movements(transfer_id) WHERE transfer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('PAYABLE','RECEIVABLE')),
  description TEXT NOT NULL,
  category_id TEXT REFERENCES financial_categories(id),
  account_id TEXT REFERENCES financial_accounts(id),
  customer_id TEXT REFERENCES customers(id),
  creditor_id TEXT REFERENCES creditors(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  start_date TEXT NOT NULL,
  end_date TEXT,
  due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
  interval_months INTEGER NOT NULL DEFAULT 1 CHECK(interval_months BETWEEN 1 AND 12),
  max_occurrences INTEGER CHECK(max_occurrences IS NULL OR max_occurrences > 0),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK(generated_count >= 0),
  next_due_at TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((kind='PAYABLE' AND customer_id IS NULL) OR (kind='RECEIVABLE' AND creditor_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_due ON recurring_rules(active,next_due_at);

ALTER TABLE financial_entries ADD COLUMN recurrence_rule_id TEXT REFERENCES recurring_rules(id);
ALTER TABLE financial_entries ADD COLUMN recurrence_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_entries_recurrence_key ON financial_entries(recurrence_key) WHERE recurrence_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_settlements_account_date ON financial_settlements(account_id,occurred_at) WHERE reversed_at IS NULL;

UPDATE app_meta SET value='cashflow-analytics-recurrence-v3', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
