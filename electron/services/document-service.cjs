'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { annotatePdfBuffer, mergePdfBuffers,inspectPdfFormBuffer,fillPdfFormBuffer } = require('./open-document-suite.cjs');

function createDocumentService({ BrowserWindow, dialog } = {}) {
  if (!BrowserWindow || !dialog) throw new TypeError('BrowserWindow and dialog are required');

  async function withHtmlWindow(html, action) {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ''))}`;
      await win.loadURL(dataUrl);
      return await action(win);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  async function savePdf(html, { defaultName = 'documento.pdf' } = {}) {
    return withHtmlWindow(html, async (win) => {
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      const result = await dialog.showSaveDialog({ title: 'Salvar PDF', defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      const finalized = await annotatePdfBuffer(pdf, defaultName.replace(/\.pdf$/i, ''));
      fs.writeFileSync(result.filePath, finalized);
      return { canceled: false, path: result.filePath, bytes: finalized.length };
    });
  }

  async function printHtml(html) {
    return withHtmlWindow(html, (win) => new Promise((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        if (!success) reject(new Error(failureReason || 'print failed'));
        else resolve({ printed: true });
      });
    }));
  }

  async function mergeSelectedPdfs() {
    const selected = await dialog.showOpenDialog({
      title: 'Unir PDFs locais', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
    });
    if (selected.canceled || !selected.filePaths?.length) return { canceled: true };
    if (selected.filePaths.length < 2 || selected.filePaths.length > 10) throw new RangeError('selecione entre 2 e 10 PDFs');
    let combinedSize = 0;
    const buffers = selected.filePaths.map(file => {
      const size = fs.statSync(file).size;
      combinedSize += size;
      if (combinedSize > 60 * 1024 * 1024) throw new RangeError('PDFs excedem 60 MB');
      return fs.readFileSync(file);
    });
    const merged = await mergePdfBuffers(buffers);
    const destination = await dialog.showSaveDialog({
      title: 'Salvar PDF reunido', defaultPath: 'documentos-reunidos.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (destination.canceled || !destination.filePath) return { canceled: true };
    fs.writeFileSync(destination.filePath, merged);
    return { canceled: false, path: destination.filePath, bytes: merged.length };
  }

  let selectedForm = null;
  async function selectPdfForm() {
    const picked = await dialog.showOpenDialog({
      title:'Selecionar formulário PDF',properties:['openFile'],
      filters:[{name:'PDF',extensions:['pdf']}]
    });
    if(picked.canceled || !picked.filePaths?.[0])return {canceled:true};
    const filename=picked.filePaths[0];
    const stats=fs.statSync(filename);
    if(!stats.isFile()||stats.size>20*1024*1024)throw new RangeError('PDF inválido ou maior que 20 MB');
    const raw=fs.readFileSync(filename);
    const fields=await inspectPdfFormBuffer(raw);
    if(!fields.length)throw new Error('PDF não contém campos de formulário editáveis');
    selectedForm={id:crypto.randomUUID(),path:filename,checksum:crypto.createHash('sha256').update(raw).digest('hex'),expires:Date.now()+15*60*1000};
    return {canceled:false,formId:selectedForm.id,fields,filename:require('node:path').basename(filename)};
  }
  async function saveFilledPdf(formId,values) {
    if(!selectedForm||formId!==selectedForm.id||selectedForm.expires<Date.now())throw new Error('Seleção de PDF expirada; selecione o formulário novamente');
    const raw=fs.readFileSync(selectedForm.path);
    const digest=crypto.createHash('sha256').update(raw).digest('hex');
    if(digest!==selectedForm.checksum)throw new Error('PDF original mudou desde a seleção; tente novamente');
    const populated=await fillPdfFormBuffer(raw,values);
    const chosen=await dialog.showSaveDialog({
      title:'Salvar formulário preenchido',defaultPath:'formulario-preenchido.pdf',
      filters:[{name:'PDF',extensions:['pdf']}]
    });
    if(chosen.canceled||!chosen.filePath)return {canceled:true};
    fs.writeFileSync(chosen.filePath,populated,{flag:'w'});
    selectedForm=null;
    return {canceled:false,path:chosen.filePath,bytes:populated.length};
  }

  return { savePdf, printHtml, mergeSelectedPdfs, selectPdfForm, saveFilledPdf };
}

module.exports = { createDocumentService };
