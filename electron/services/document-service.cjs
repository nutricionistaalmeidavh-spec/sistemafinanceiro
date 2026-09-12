'use strict';

const fs = require('node:fs');

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
      fs.writeFileSync(result.filePath, pdf);
      return { canceled: false, path: result.filePath, bytes: pdf.length };
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

  return { savePdf, printHtml };
}

module.exports = { createDocumentService };
