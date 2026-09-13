ALTER TABLE financial_accounts ADD COLUMN ownership TEXT NOT NULL DEFAULT 'BUSINESS' CHECK(ownership IN ('BUSINESS','PERSONAL'));

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('CSV','OFX','PDF','MANUAL')),
  document_id TEXT NOT NULL,
  filename TEXT,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  parsed_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_import_batches_account_date ON bank_import_batches(account_id,created_at);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES bank_import_batches(id),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  normalized_description TEXT NOT NULL,
  counterparty TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
  category_label TEXT,
  source_fingerprint TEXT NOT NULL UNIQUE,
  business_fingerprint TEXT NOT NULL,
  rule_id TEXT,
  rule_reason TEXT,
  rule_confidence REAL NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','AUTO_CLASSIFIED','REVIEWED','MATCHED')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date ON bank_transactions(account_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_business_fp ON bank_transactions(business_fingerprint);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_review ON bank_transactions(review_status,occurred_at);

CREATE TABLE IF NOT EXISTS bank_reconciliation_feedback (
  transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(transaction_id,entry_id)
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_links (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  decision TEXT NOT NULL CHECK(decision IN ('accepted','manual')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(transaction_id,entry_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_links_entry ON bank_reconciliation_links(entry_id);

UPDATE app_meta SET value='statement-import-reconciliation-v5', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
