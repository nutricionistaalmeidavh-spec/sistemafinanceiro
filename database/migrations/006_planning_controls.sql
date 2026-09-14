CREATE TABLE IF NOT EXISTS cost_centers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES cost_centers(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id,active,name);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_allocations (
  entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  cost_center_id TEXT NOT NULL REFERENCES cost_centers(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  percentage_basis_points INTEGER NOT NULL CHECK(percentage_basis_points > 0 AND percentage_basis_points <= 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(entry_id,cost_center_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_allocations_center ON entry_allocations(cost_center_id,entry_id);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(entry_id,tag_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id,entry_id);

CREATE TABLE IF NOT EXISTS budget_scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'CUSTOM' CHECK(kind IN ('BASE','OPTIMISTIC','PESSIMISTIC','CUSTOM')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES budget_scenarios(id),
  year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2200),
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  nature TEXT NOT NULL CHECK(nature IN ('REVENUE','EXPENSE')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  category_id TEXT REFERENCES financial_categories(id),
  cost_center_id TEXT REFERENCES cost_centers(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scenario_id,year,month,nature,category_id,cost_center_id)
);
CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(scenario_id,year,month,nature);

CREATE TABLE IF NOT EXISTS financial_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('REVENUE','EXPENSE','BALANCE','RESULT')),
  target_cents INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  category_id TEXT REFERENCES financial_categories(id),
  cost_center_id TEXT REFERENCES cost_centers(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_attachments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  workspace_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  extracted_text TEXT,
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','REVIEWED')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_attachments_entry ON entry_attachments(entry_id,created_at);

CREATE TABLE IF NOT EXISTS approval_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(min_amount_cents >= 0),
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK(required_approvals BETWEEN 1 AND 20),
  approver_roles_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  entry_id TEXT REFERENCES financial_entries(id) ON DELETE CASCADE,
  batch_key TEXT,
  policy_id TEXT REFERENCES approval_policies(id),
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK(required_approvals BETWEEN 1 AND 20),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(entry_id IS NOT NULL OR batch_key IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entry ON approval_requests(entry_id,status);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,actor_id)
);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_request ON approval_decisions(request_id,created_at);

INSERT OR IGNORE INTO budget_scenarios(id,name,kind,active,created_at,updated_at) VALUES
 ('base','Base','BASE',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('optimistic','Otimista','OPTIMISTIC',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('pessimistic','Pessimista','PESSIMISTIC',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

UPDATE app_meta SET value='planning-controls-v6', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
