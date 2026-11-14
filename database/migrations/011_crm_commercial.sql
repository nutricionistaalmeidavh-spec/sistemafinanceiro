-- CRM comercial local-first. Dados financeiros permanecem canônicos no FinanceService.
CREATE TABLE IF NOT EXISTS crm_leads (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT,
 source TEXT NOT NULL DEFAULT 'MANUAL', status TEXT NOT NULL DEFAULT 'NEW'
 CHECK(status IN ('NEW','QUALIFIED','CONVERTED','DISCARDED')),
 customer_id TEXT REFERENCES customers(id), notes TEXT,
 owner_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_leads_document ON crm_leads(document) WHERE document IS NOT NULL AND document <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_leads_email ON crm_leads(LOWER(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS ix_crm_leads_status ON crm_leads(status,updated_at);

CREATE TABLE IF NOT EXISTS crm_opportunities (
 id TEXT PRIMARY KEY, lead_id TEXT REFERENCES crm_leads(id),
 customer_id TEXT REFERENCES customers(id), title TEXT NOT NULL,
 amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents >= 0),
 stage TEXT NOT NULL DEFAULT 'NEW'
 CHECK(stage IN ('NEW','QUALIFIED','PROPOSAL','WON','LOST')),
 owner_id TEXT REFERENCES users(id), loss_reason TEXT,
 closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(lead_id IS NOT NULL OR customer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_stage ON crm_opportunities(stage,updated_at);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_lead ON crm_opportunities(lead_id);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_customer ON crm_opportunities(customer_id);

CREATE TABLE IF NOT EXISTS crm_stage_history (
 id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 from_stage TEXT, to_stage TEXT NOT NULL, actor_id TEXT, changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_stage_history_deal ON crm_stage_history(opportunity_id,changed_at);

CREATE TABLE IF NOT EXISTS crm_activities (
 id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 kind TEXT NOT NULL CHECK(kind IN ('CALL','EMAIL','WHATSAPP','MEETING','NOTE')),
 note TEXT NOT NULL, actor_id TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_activities_deal ON crm_activities(opportunity_id,occurred_at);

CREATE TABLE IF NOT EXISTS crm_tasks (
 id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 title TEXT NOT NULL, due_at TEXT, done_at TEXT, owner_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_tasks_due ON crm_tasks(done_at,due_at);

CREATE TABLE IF NOT EXISTS crm_quotes (
 id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 version INTEGER NOT NULL CHECK(version>=1), status TEXT NOT NULL DEFAULT 'DRAFT'
 CHECK(status IN ('DRAFT','SENT','ACCEPTED','REJECTED')),
 total_cents INTEGER NOT NULL CHECK(total_cents>0),
 notes TEXT, created_by TEXT, created_at TEXT NOT NULL,
 UNIQUE(opportunity_id,version)
);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_opportunity ON crm_quotes(opportunity_id,version);

CREATE TABLE IF NOT EXISTS crm_quote_items (
 id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES crm_quotes(id),
 description TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>0),
 total_cents INTEGER NOT NULL CHECK(total_cents>0),
 position INTEGER NOT NULL, UNIQUE(quote_id,position)
);

CREATE TABLE IF NOT EXISTS crm_billing_links (
 id TEXT PRIMARY KEY,
 opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 quote_id TEXT NOT NULL REFERENCES crm_quotes(id),
 installment_no INTEGER NOT NULL CHECK(installment_no>=1),
 financial_entry_id TEXT NOT NULL UNIQUE REFERENCES financial_entries(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 due_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(opportunity_id,installment_no),
 UNIQUE(quote_id,installment_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_financial_source
 ON financial_entries(source_type,source_id)
 WHERE source_type='CRM_QUOTE_INSTALLMENT';

UPDATE app_meta SET value='crm-commercial-v11',updated_at=CURRENT_TIMESTAMP WHERE key='schema';
