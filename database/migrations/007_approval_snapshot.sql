-- Snapshot imutavel do valor quando uma aprovacao e solicitada.
-- Pedidos legados sem snapshot nao liberam novos pagamentos automaticamente.
ALTER TABLE approval_requests ADD COLUMN entry_amount_cents_at_request INTEGER;
CREATE INDEX IF NOT EXISTS idx_approval_requests_snapshot
  ON approval_requests(entry_id,status,entry_amount_cents_at_request);
