-- Additive indexes only: no row quotas, deletions or rewrites of canonical financial data.
-- Keyset page ordering remains stable even when timestamps coincide.
CREATE INDEX IF NOT EXISTS idx_crm_leads_updated_id ON crm_leads(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status_updated_id ON crm_leads(status,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_updated_id ON crm_opportunities(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_pipeline_updated_id ON crm_opportunities(pipeline_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_pipeline_stage_updated_id ON crm_opportunities(pipeline_id,stage_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_finance_kind_due_id ON financial_entries(kind,due_at,id);
CREATE INDEX IF NOT EXISTS idx_finance_created_due ON financial_entries(created_at,due_at,id);
CREATE INDEX IF NOT EXISTS idx_finance_recurrence_due_id ON financial_entries(recurrence_rule_id,due_at,id);
CREATE INDEX IF NOT EXISTS idx_finance_account_due_id ON financial_entries(account_id,due_at,id);
CREATE INDEX IF NOT EXISTS idx_customers_active_name ON customers(active,name COLLATE NOCASE,id);
CREATE INDEX IF NOT EXISTS idx_creditors_active_name ON creditors(active,name COLLATE NOCASE,id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_opportunity_due ON crm_tasks(opportunity_id,done_at,due_at);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity_recent ON crm_activities(opportunity_id,occurred_at DESC,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_finance_settlements_entry_asof ON financial_settlements(entry_id,occurred_at,created_at,id);
