import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ocrModule from '../electron/services/attachment-ocr-service.cjs';

const { resolveWorkspaceFile, createAttachmentOcrService } = ocrModule;

test('OCR path stays inside Workspace', () => {
  const root = path.join(os.tmpdir(), 'artisys-ocr-test');
  assert.equal(resolveWorkspaceFile(root, 'comprovantes/nota.png'), path.join(root, 'comprovantes', 'nota.png'));
  assert.throws(() => resolveWorkspaceFile(root, '../segredo.png'), /outside workspace/i);
  assert.throws(() => resolveWorkspaceFile(root, 'C:\\segredo.png'), /outside workspace/i);
});

test('attachment OCR stores text only and leaves financial entry untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-ocr-'));
  fs.writeFileSync(path.join(root, 'nota.png'), Buffer.from('fake-image'));
  const rows = {
    attachment: { id:'a1', entry_id:'e1', workspace_path:'nota.png', filename:'nota.png', extracted_text:null, review_status:'PENDING' },
    entry: { id:'e1', amount_cents:12345, due_at:'2026-09-20', category_id:'cat1' },
  };
  const db = {
    prepare(sql) {
      if (sql.includes('FROM entry_attachments')) return { get: () => ({ ...rows.attachment }) };
      if (sql.includes('UPDATE entry_attachments')) return { run: (_text,_time) => { rows.attachment.extracted_text=_text; return {changes:1}; } };
      if (sql.includes('INSERT INTO audit_log')) return { run: () => ({changes:1}) };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const service = createAttachmentOcrService({
    db,
    workspaceRoot: root,
    executeOcr: async () => ({ provider:'tesseract', text:'TOTAL 123,45', confidence:0.9, blocks:[] }),
  });
  const before = { ...rows.entry };
  const result = await service.extract('a1', {id:'u1',role:'FINANCE'});
  assert.equal(result.extractedText, 'TOTAL 123,45');
  assert.deepEqual(rows.entry, before);
  fs.rmSync(root, {recursive:true,force:true});
});
