-- Allocation percentages are stored only as a rule template. Each generated entry
-- uses the canonical entry_allocations table and the shared cent normalizer.
ALTER TABLE recurring_rules ADD COLUMN cost_center_allocations_json TEXT;
