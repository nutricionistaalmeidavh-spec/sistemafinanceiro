'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { createCanvas } = require('@napi-rs/canvas');
const { writeAudit } = require('./audit.cjs');

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
function offlineLanguageDirectory() {
  const candidates = [
    path.join(process.resourcesPath || '', 'ocr-data'),
    path.resolve(__dirname, '../../resources/ocr-data'),
  ];
  const location = candidates.find(dir => fs.existsSync(path.join(dir, 'por.traineddata.gz')));
  if (!location) throw new Error('Modelo OCR português offline indisponível. Reinstale uma versão que inclua o arquivo por.traineddata.gz.');
  return location;
}
async function recognizeLocal(source, language) {
  if (language !== 'por') throw new TypeError('Idioma OCR não empacotado: ' + language);
  const worker = await createWorker('por', 1, { langPath: offlineLanguageDirectory(), cacheMethod: 'none' });
  try {
    if (path.extname(source).toLowerCase() !== '.pdf') {
      const result = (await worker.recognize(source)).data;
      return { text: result.text || '', confidence: Number(result.confidence ?? 0) / 100, blocks: [] };
    }
    if (fs.statSync(source).size > MAX_PDF_BYTES) throw new RangeError('PDF OCR excede 15 MB');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(source)), useSystemFonts: true }).promise;
    try {
      if (pdf.numPages > MAX_PDF_PAGES) throw new RangeError('PDF OCR limitado a 10 páginas');
      const texts = []; const confidences = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1.5 });
        if (viewport.width * viewport.height > 5_000_000) throw new RangeError('Página PDF muito grande para OCR');
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const result = (await worker.recognize(canvas.toBuffer('image/png'))).data;
        texts.push(result.text || '');
        confidences.push(Number(result.confidence || 0) / 100);
        page.cleanup();
      }
      return { text: texts.join('\n\n'), confidence: confidences.reduce((a,b)=>a+b,0) / (confidences.length || 1), blocks: [] };
    } finally { if (typeof pdf.destroy === 'function') await pdf.destroy(); else if (typeof pdf.cleanup === 'function') await pdf.cleanup(); }
  } finally { await worker.terminate(); }
}


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

async function defaultExecuteOcr(request) {
  const contract = await import('@artisys/ocr');
  const providers = {
    tesseract: {
      recognize: async (normalizedRequest) =>
        recognizeLocal(String(normalizedRequest.source), String(normalizedRequest.language || 'por')),
    },
  };
  return contract.executeOcr(providers, request);
}

function updateAttachmentExtractedText(db, id, value, actor = null, now = () => new Date().toISOString()) {
  if(!db)throw new TypeError('database is required');
  const attachmentId=String(id||'').trim();
  if(!attachmentId)throw new TypeError('attachmentId is required');
  if(typeof value!=='string'||!value.trim()||value.length>50000)throw new TypeError('texto corrigido inválido ou maior que 50 mil caracteres');
  const attachment=db.prepare('SELECT id,extracted_text,review_status FROM entry_attachments WHERE id=?').get(attachmentId);
  if(!attachment)throw new Error('attachment not found');
  const timestamp=now();
  const oldHash=require('node:crypto').createHash('sha256').update(attachment.extracted_text||'').digest('hex');
  const newHash=require('node:crypto').createHash('sha256').update(value).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare("UPDATE entry_attachments SET extracted_text=?,review_status='PENDING',updated_at=? WHERE id=?").run(value,timestamp,attachmentId);
    writeAudit(db,{action:'planning.attachment.ocr.correct',entity:'entry-attachment',entityId:attachmentId,actor,context:{oldHash,newHash,changed:oldHash!==newHash}},now);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return db.prepare('SELECT * FROM entry_attachments WHERE id=?').get(attachmentId);
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
    const realSource = fs.realpathSync(source);
    const realRoot = fs.realpathSync(workspaceRoot);
    if (realSource !== realRoot && !realSource.startsWith(realRoot + path.sep)) throw new Error('attachment path outside workspace');
    const extension = path.extname(source).toLowerCase();
    if (!['.png','.jpg','.jpeg','.bmp','.tif','.tiff','.webp','.pdf'].includes(extension)) {
      throw new Error('OCR local aceita PNG, JPG, BMP, TIFF, WEBP ou PDF.');
    }
    const result = await executeOcr({ source, language: 'por', mode: 'text', environment: 'native', prefer: 'tesseract', preprocess: true });
    const extractedText = String(result?.text || '').trim();
    const timestamp = nowIso();
    const updated = db.prepare('UPDATE entry_attachments SET extracted_text=?,review_status=\'PENDING\',updated_at=?,ocr_confidence=?,ocr_provider=? WHERE id=?').run(extractedText || null, timestamp, result?.confidence == null ? null : Math.max(0,Math.min(1,Number(result.confidence))), String(result?.provider||'local'), id);
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

  return { extract, correct: (id,text,actor)=>updateAttachmentExtractedText(db,id,text,actor,nowIso) };
}

module.exports = { createAttachmentOcrService, resolveWorkspaceFile, recognizeLocal, updateAttachmentExtractedText };
