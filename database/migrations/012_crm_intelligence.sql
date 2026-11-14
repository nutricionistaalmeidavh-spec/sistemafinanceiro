-- P2 CRM intelligence: additive-only, never writes financial tables.
CREATE TABLE IF NOT EXISTS crm_pipelines (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_pipeline_name ON crm_pipelines(LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_pipeline_default ON crm_pipelines(is_default) WHERE is_default=1;

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
 id TEXT PRIMARY KEY,
 pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id),
 name TEXT NOT NULL,
 legacy_stage TEXT NOT NULL CHECK(legacy_stage IN ('NEW','QUALIFIED','PROPOSAL','WON','LOST')),
 probability_bps INTEGER NOT NULL CHECK(probability_bps BETWEEN 0 AND 10000),
 position INTEGER NOT NULL CHECK(position>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_pipeline_stage_name ON crm_pipeline_stages(pipeline_id,LOWER(name));
CREATE INDEX IF NOT EXISTS ix_crm_pipeline_stages_order ON crm_pipeline_stages(pipeline_id,active,position,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_pipeline_stage_won_lost ON crm_pipeline_stages(pipeline_id,legacy_stage) WHERE legacy_stage IN ('WON','LOST');

INSERT INTO crm_pipelines(id,name,is_default,active,created_at,updated_at)
VALUES ('crm-pipeline-default','Principal',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO crm_pipeline_stages(id,pipeline_id,name,legacy_stage,probability_bps,position,active,created_at,updated_at) VALUES
 ('crm-stage-new','crm-pipeline-default','Novo contato','NEW',1000,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('crm-stage-qualified','crm-pipeline-default','Qualificado','QUALIFIED',2500,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('crm-stage-proposal','crm-pipeline-default','Proposta','PROPOSAL',6500,2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('crm-stage-won','crm-pipeline-default','Ganho','WON',10000,3,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('crm-stage-lost','crm-pipeline-default','Perdido','LOST',0,4,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

ALTER TABLE crm_opportunities ADD COLUMN pipeline_id TEXT REFERENCES crm_pipelines(id);
ALTER TABLE crm_opportunities ADD COLUMN stage_id TEXT REFERENCES crm_pipeline_stages(id);
ALTER TABLE crm_opportunities ADD COLUMN expected_close_at TEXT;
UPDATE crm_opportunities SET pipeline_id='crm-pipeline-default',
 stage_id=(SELECT id FROM crm_pipeline_stages WHERE pipeline_id='crm-pipeline-default' AND legacy_stage=crm_opportunities.stage LIMIT 1);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_pipeline ON crm_opportunities(pipeline_id,stage_id,owner_id);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_expected_close ON crm_opportunities(expected_close_at,stage,owner_id);

ALTER TABLE crm_stage_history ADD COLUMN from_custom_stage_id TEXT REFERENCES crm_pipeline_stages(id);
ALTER TABLE crm_stage_history ADD COLUMN to_custom_stage_id TEXT REFERENCES crm_pipeline_stages(id);

CREATE TABLE IF NOT EXISTS crm_sales_goals (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 month TEXT NOT NULL CHECK(LENGTH(month)=7 AND SUBSTR(month,5,1)='-'),
 target_cents INTEGER NOT NULL CHECK(target_cents>0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,month)
);
CREATE INDEX IF NOT EXISTS ix_crm_sales_goals_month ON crm_sales_goals(month,owner_id);

CREATE TABLE IF NOT EXISTS crm_appointments (
 id TEXT PRIMARY KEY,
 opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
 title TEXT NOT NULL,
 scheduled_date TEXT NOT NULL CHECK(LENGTH(scheduled_date)=10),
 scheduled_time TEXT NOT NULL CHECK(LENGTH(scheduled_time)=5),
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 1440),
 kind TEXT NOT NULL DEFAULT 'MEETING' CHECK(kind IN ('MEETING','CALL','FOLLOWUP','OTHER')),
 status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','DONE','CANCELLED')),
 owner_id TEXT REFERENCES users(id),
 notes TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_appointments_date ON crm_appointments(scheduled_date,scheduled_time,status,owner_id);
CREATE INDEX IF NOT EXISTS ix_crm_appointments_opportunity ON crm_appointments(opportunity_id);

CREATE TRIGGER IF NOT EXISTS trg_crm_stage_pipeline_guard_insert
 BEFORE INSERT ON crm_opportunities
 WHEN NEW.stage_id IS NOT NULL AND (
   NEW.pipeline_id IS NULL OR NOT EXISTS(
     SELECT 1 FROM crm_pipeline_stages s WHERE s.id=NEW.stage_id AND s.pipeline_id=NEW.pipeline_id AND s.legacy_stage=NEW.stage
   )
 )
 BEGIN SELECT RAISE(ABORT,'CRM stage/pipeline mismatch'); END;

CREATE TRIGGER IF NOT EXISTS trg_crm_stage_pipeline_guard_update
 BEFORE UPDATE OF stage_id,pipeline_id,stage ON crm_opportunities
 WHEN NEW.stage_id IS NOT NULL AND (
   NEW.pipeline_id IS NULL OR NOT EXISTS(
     SELECT 1 FROM crm_pipeline_stages s WHERE s.id=NEW.stage_id AND s.pipeline_id=NEW.pipeline_id AND s.legacy_stage=NEW.stage
   )
 )
 BEGIN SELECT RAISE(ABORT,'CRM stage/pipeline mismatch'); END;
