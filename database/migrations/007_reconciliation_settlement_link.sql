-- Links remain reconciliation evidence, while settlements stay the canonical cash source.
-- Settlement references make the optional 'reconcile and pay' workflow auditable/idempotent.
ALTER TABLE bank_reconciliation_links ADD COLUMN settlement_id TEXT REFERENCES financial_settlements(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_reconciliation_settlement ON bank_reconciliation_links(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_settlements_entry_active ON financial_settlements(entry_id,reversed_at);
UPDATE app_meta SET value='reconciliation-settlement-link-v7', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
