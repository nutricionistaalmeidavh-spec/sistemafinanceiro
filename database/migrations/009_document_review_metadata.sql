-- Preserve OCR review metadata and original import format without weakening existing financial constraints.
ALTER TABLE entry_attachments ADD COLUMN ocr_confidence REAL CHECK(ocr_confidence IS NULL OR (ocr_confidence>=0 AND ocr_confidence<=1));
ALTER TABLE entry_attachments ADD COLUMN ocr_provider TEXT;
ALTER TABLE bank_import_batches ADD COLUMN original_source_type TEXT;
UPDATE bank_import_batches SET original_source_type=source_type WHERE original_source_type IS NULL;
CREATE INDEX IF NOT EXISTS idx_bank_batch_original_source ON bank_import_batches(original_source_type,created_at);
UPDATE app_meta SET value='document-review-metadata-v9', updated_at=CURRENT_TIMESTAMP WHERE key='schema';
