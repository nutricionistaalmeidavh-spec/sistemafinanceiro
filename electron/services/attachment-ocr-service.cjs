'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { writeAudit } = require('./audit.cjs');

const execFileAsync = promisify(execFile);

function resolveWorkspaceFile(workspaceRoot, relativePath) {
  const root = path.resolve(String(workspaceRoot || ''));
  const raw = String(relativePath || '').replace(/\\/g, '/').trim();
  if (!root || !raw || raw.includes('\0') || path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) throw new Error('attachment path outside workspace');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('attachment path outside workspace');
  const full = path.resolve(root, ...normalized.split('/').filter(Boolean));
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error('attachment path outside workspace');
  return full;
}

async function loadOcrContract() {
  const modulePath = path.join(__dirname, '..', '..', 'vendor', 'utilidades', 'modules', 'artisys-ocr', 'src', 'index.mjs');
  if (!fs.existsSync(modulePath)) throw new Error('artisys-ocr module is unavailable');
  return import(pathToFileURL(modulePath).href);
}

async function defaultExecuteOcr(request) {
  const contract = await loadOcrContract();
  const providers = {
    tesseract: {
      recognize: async (normalizedRequest) => {
        try {
          const result = await execFileAsync('tesseract', [String(normalizedRequest.source), 'stdout', '-l', String(normalizedRequest.language || 'por')], {
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
          });
          return { text: result.stdout || '', confidence: null, blocks: [] };
        } catch (error) {
          if (error?.code === 'ENOENT') throw new Error('OCR local indisponível: instale o Tesseract OCR para usar esta opção.');
          throw error;
        }
      },
    },
  };
  return contract.executeOcr(providers, request);
}

function createAttachmentOcrService({ db, workspaceRoot, executeOcr = defaultExecuteOcr, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');
  if (!workspaceRoot) throw new TypeError('workspaceRoot is required.');
  const nowIso = () => String(now());

  async function extract(attachmentId, actor = null) {
    const id = String(attachmentId || '').trim();
    if (!id) throw new TypeError('attachmentId is required');
    const attachment = db.prepare('SELECT * FROM entry_attachments WHERE id=?').get(id);
    if (!attachment) throw new Error('attachment not found');
    const source = resolveWorkspaceFile(workspaceRoot, attachment.workspace_path);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('workspace attachment file not found');
    const extension = path.extname(source).toLowerCase();
    if (!['.png','.jpg','.jpeg','.bmp','.tif','.tiff','.webp'].includes(extension)) {
      throw new Error('OCR local suporta anexos de imagem; PDF escaneado exige um adaptador local de conversão opcional.');
    }
    const result = await executeOcr({ source, language: 'por', mode: 'text', environment: 'native', prefer: 'tesseract', preprocess: true });
    const extractedText = String(result?.text || '').trim();
    const timestamp = nowIso();
    const updated = db.prepare('UPDATE entry_attachments SET extracted_text=?,review_status=\'PENDING\',updated_at=? WHERE id=?').run(extractedText || null, timestamp, id);
    if (!updated.changes) throw new Error('attachment not found');
    writeAudit(db, {
      action: 'planning.attachment.ocr', entity: 'entry-attachment', entityId: id, actor,
      context: { provider: result?.provider || 'unknown', confidence: result?.confidence ?? null, characters: extractedText.length },
    }, nowIso);
    return {
      id,
      entryId: attachment.entry_id,
      extractedText,
      provider: result?.provider || null,
      confidence: result?.confidence ?? null,
      reviewStatus: 'PENDING',
    };
  }

  return { extract };
}

module.exports = { createAttachmentOcrService, resolveWorkspaceFile };
