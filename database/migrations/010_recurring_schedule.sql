-- Recorrencia diaria/semanal opcional e reajuste anual; regras antigas continuam mensais.
ALTER TABLE recurring_rules ADD COLUMN interval_days INTEGER CHECK(interval_days IS NULL OR interval_days IN (7,14));
ALTER TABLE recurring_rules ADD COLUMN annual_adjustment_bps INTEGER NOT NULL DEFAULT 0 CHECK(annual_adjustment_bps BETWEEN 0 AND 10000);
UPDATE app_meta SET value='recurrence-canonical-v10',updated_at=CURRENT_TIMESTAMP WHERE key='schema';
