'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const { dreHtml,cashflowHtml,toDreDocxBuffer,toCashflowDocxBuffer }=require('./services/financial-documents.cjs');
const { verifyAndPreviewPackage }=require('./services/open-document-suite.cjs');
const { writeAudit }=require('./services/audit.cjs');
const {toOdsBuffer}=require('./services/open-format-service.cjs');
const { toDreXlsxBuffer } = require('./services/planning-export-service.cjs');

function registerIpcHandlers({ ipcMain, app, dialog, database, auth, finance, registry, cashflow, analytics, recurrence, alerts, reports, backup, lan, documents, statements, workspace }) {
  if (!ipcMain?.handle) throw new TypeError('ipcMain is required');
  const broadcast = (event, result) => {
    // Notify the renderer only after the canonical SQLite operation succeeds.
    event?.sender?.send?.('finance:data-changed', { scope: 'financial-ledger' });
    return result;
  };
  ipcMain.handle('system:health', () => database.health());

  ipcMain.handle('auth:needs-bootstrap', () => auth.needsBootstrap());
  ipcMain.handle('auth:bootstrap', (_event, input) => auth.bootstrapAdmin(input));
  ipcMain.handle('auth:login', (_event, login, password) => auth.authenticate(login, password));
  ipcMain.handle('auth:session', (_event, token) => auth.session(token));
  ipcMain.handle('auth:logout', (_event, token) => auth.logout(token));
  ipcMain.handle('auth:users:list', (_event, token) => auth.listUsers(token));
  ipcMain.handle('auth:users:create', (_event, token, input) => auth.createUser(token, input));
  ipcMain.handle('auth:users:set-active', (_event, token, userId, active) => auth.setUserActive(token, userId, active));

  ipcMain.handle('finance:accounts:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return finance.listAccounts(filters || {}); });
  ipcMain.handle('finance:accounts:create', (event, token, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.createAccount(input, actor)); });
  ipcMain.handle('finance:entries:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return finance.listEntries(filters || {}); });
  ipcMain.handle('finance:entries:create', (event, token, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.createEntry(input, actor)); });
  ipcMain.handle('finance:entries:update', (event, token, entryId, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.updateEntry(entryId, input, actor)); });
  ipcMain.handle('finance:entries:settle', (event, token, entryId, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.settleEntry(entryId, input, actor)); });
  ipcMain.handle('finance:settlements:reverse', (event, token, settlementId, reason) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.reverseSettlement(settlementId, { reason, actor })); });
  ipcMain.handle('finance:entries:cancel', (event, token, entryId, reason) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, finance.cancelEntry(entryId, { reason, actor })); });
  ipcMain.handle('finance:summary', (_event, token, filters) => { auth.require(token, 'finance.view'); return finance.getSummary(filters || {}); });

  ipcMain.handle('statements:ods:inspect', async (_event,token,dataBase64)=>{auth.require(token,'finance.view');return statements.inspectOds(dataBase64);});
  ipcMain.handle('statements:cnab:inspect', (_event,token,content)=>{auth.require(token,'finance.view');return statements.inspectCnab(content);});
  ipcMain.handle('statements:xlsx:inspect', async (_event,token,dataBase64) => {
    auth.require(token,'finance.view');
    return statements.inspectXlsx(dataBase64);
  });
  ipcMain.handle('statements:preview', async (_event, token, input) => { auth.require(token, 'finance.view'); return statements.preview(input || {}); });
  ipcMain.handle('statements:commit', async (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return statements.commit(input || {}, actor); });
  ipcMain.handle('statements:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.listTransactions(filters || {}); });
  ipcMain.handle('statements:suggest-transfers', async (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.suggestTransfers(filters || {}); });
  ipcMain.handle('statements:suggest-entries', async (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.suggestEntries(filters || {}); });
  ipcMain.handle('statements:decision', async (event, token, input) => { const actor = auth.require(token, 'finance.manage'); const result = await statements.recordDecision(input || {}, actor); return input?.registerSettlement ? broadcast(event, result) : result; });

  ipcMain.handle('workspace:list', (_event, token, relativePath) => { auth.require(token, 'finance.view'); return workspace.list(relativePath || ''); });
  ipcMain.handle('workspace:tree', (_event, token) => { auth.require(token, 'finance.view'); return workspace.tree(); });
  ipcMain.handle('workspace:search', (_event, token, query) => { auth.require(token, 'finance.view'); return workspace.search(query || ''); });
  ipcMain.handle('workspace:trash:list', (_event, token) => { auth.require(token, 'finance.view'); return workspace.listTrash(); });
  ipcMain.handle('workspace:preferences', (_event, token) => { auth.require(token, 'finance.view'); return workspace.preferences(); });
  ipcMain.handle('workspace:create-folder', (_event, token, parentPath, name) => { auth.require(token, 'finance.manage'); return workspace.createFolder(parentPath || '', name); });
  ipcMain.handle('workspace:create-file', (_event, token, parentPath, name, content) => { auth.require(token, 'finance.manage'); return workspace.createFile(parentPath || '', name, content || ''); });
  ipcMain.handle('workspace:import-paths', (_event, token, targetPath, sourcePaths) => {
    auth.require(token, 'finance.manage');
    if (!Array.isArray(sourcePaths)) throw new TypeError('sourcePaths must be an array');
    const paths = sourcePaths.filter((value) => typeof value === 'string' && value.trim()).slice(0, 200);
    return workspace.importFiles(targetPath || '', paths);
  });
  ipcMain.handle('workspace:rename', (_event, token, relativePath, name) => { auth.require(token, 'finance.manage'); return workspace.rename(relativePath, name); });
  ipcMain.handle('workspace:move', (_event, token, relativePath, targetPath) => { auth.require(token, 'finance.manage'); return workspace.move(relativePath, targetPath || ''); });
  ipcMain.handle('workspace:copy', (_event, token, relativePath, targetPath) => { auth.require(token, 'finance.manage'); return workspace.copy(relativePath, targetPath || ''); });
  ipcMain.handle('workspace:trash', (_event, token, relativePath) => { auth.require(token, 'finance.manage'); return workspace.trash(relativePath); });
  ipcMain.handle('workspace:trash:restore', (_event, token, id) => { auth.require(token, 'finance.manage'); return workspace.restore(id); });
  ipcMain.handle('workspace:trash:delete', (_event, token, id) => { auth.require(token, 'finance.manage'); return workspace.deleteForever(id); });
  ipcMain.handle('workspace:preferences:set', (_event, token, input) => { auth.require(token, 'finance.manage'); return workspace.setPreferences(input || {}); });
  ipcMain.handle('workspace:import-select', async (_event, token, targetPath) => {
    auth.require(token, 'finance.manage');
    if (!dialog) throw new Error('file dialog unavailable');
    const selected = await dialog.showOpenDialog({ title: 'Adicionar arquivos ao Workspace', properties: ['openFile', 'multiSelections'] });
    if (selected.canceled || !selected.filePaths?.length) return { canceled: true, items: [] };
    return { canceled: false, items: await workspace.importFiles(targetPath || '', selected.filePaths) };
  });
  ipcMain.handle('workspace:open', (_event, token, relativePath) => { auth.require(token, 'finance.view'); return workspace.open(relativePath); });
  ipcMain.handle('workspace:reveal', (_event, token, relativePath) => { auth.require(token, 'finance.view'); return workspace.reveal(relativePath); });

  ipcMain.handle('cashflow:movements:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.listMovements(filters || {}); });
  ipcMain.handle('cashflow:movements:create', (event, token, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, cashflow.createManualMovement(input, actor)); });
  ipcMain.handle('cashflow:transfer', (event, token, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, cashflow.transfer(input, actor)); });
  ipcMain.handle('cashflow:balances', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.getAccountBalances(filters || {}); });
  ipcMain.handle('cashflow:summary', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.getCashflowSummary(filters || {}); });

  ipcMain.handle('analytics:dre', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getDre(filters || {}); });
  ipcMain.handle('analytics:dre-docx', async (_event,token,filters)=>{
    auth.require(token,'finance.view');
    const report=analytics.getDre(filters||{});
    return {filename:'dre-financeira.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:(await toDreDocxBuffer(report)).toString('base64')};
  });
  ipcMain.handle('analytics:dre-pdf', async (_event,token,filters)=>{
    auth.require(token,'finance.view');
    return documents.savePdf(dreHtml(analytics.getDre(filters||{})),{defaultName:'dre-financeira.pdf'});
  });
  ipcMain.handle('cashflow:docx', async (_event,token,filters)=>{
    auth.require(token,'finance.view');
    const snapshot={summary:cashflow.getCashflowSummary(filters||{}),movements:cashflow.listMovements(filters||{})};
    return {filename:'fluxo-de-caixa.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dataBase64:(await toCashflowDocxBuffer(snapshot)).toString('base64')};
  });
  ipcMain.handle('cashflow:pdf', async (_event,token,filters)=>{
    auth.require(token,'finance.view');
    const snapshot={summary:cashflow.getCashflowSummary(filters||{}),movements:cashflow.listMovements(filters||{})};
    return documents.savePdf(cashflowHtml(snapshot),{defaultName:'fluxo-de-caixa.pdf'});
  });
  ipcMain.handle('analytics:dre-xlsx', async (_event, token, filters) => {
    auth.require(token, 'finance.view');
    const report = analytics.getDre(filters || {});
    const workbook = await toDreXlsxBuffer(report);
    return { filename:'dre-financeira.xlsx', mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64:workbook.toString('base64') };
  });
  ipcMain.handle('analytics:indicators', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getIndicators(filters || {}); });
  ipcMain.handle('analytics:dashboard', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getDashboardSnapshot(filters || {}); });

  ipcMain.handle('recurrence:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return recurrence.listRules(filters || {}); });
  ipcMain.handle('recurrence:create', (event, token, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, recurrence.createRule(input, actor)); });
  ipcMain.handle('recurrence:update', (event, token, id, input) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, recurrence.updateRule(id, input, actor)); });
  ipcMain.handle('recurrence:set-active', (event, token, id, active) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, recurrence.setRuleActive(id, active, actor)); });
  ipcMain.handle('recurrence:generate', (event, token, asOf) => { const actor = auth.require(token, 'finance.manage'); return broadcast(event, recurrence.generateDue({ asOf, actor })); });

  ipcMain.handle('alerts:list', (_event, token, filters) => { const actor = auth.require(token, 'finance.view'); return alerts.listAlerts({ ...(filters || {}), userId: actor.id }); });
  ipcMain.handle('alerts:ack', (_event, token, alertKey, state) => { const actor = auth.require(token, 'finance.view'); return alerts.acknowledge(alertKey, actor.id, state); });
  ipcMain.handle('alerts:thresholds:list', (_event, token) => { auth.require(token, 'finance.view'); return alerts.listAccountThresholds(); });
  ipcMain.handle('alerts:thresholds:set', (_event, token, accountId, thresholdCents, enabled) => { const actor = auth.require(token, 'finance.manage'); return alerts.setAccountThreshold(accountId, thresholdCents, actor, enabled); });
  ipcMain.handle('alerts:internal:save', (_event, token, input) => { const actor = auth.require(token, 'system.manage'); return alerts.saveInternalAlert(input, actor); });

  ipcMain.handle('reports:financial', (_event, token, filters) => { auth.require(token, 'finance.view'); return reports.financialReport(filters || {}); });
  ipcMain.handle('reports:receipt', (_event, token, settlementId) => { auth.require(token, 'finance.view'); return reports.settlementReceipt(settlementId); });
  ipcMain.handle('reports:ods', (_event,token,filters)=>{
    auth.require(token,'finance.view');
    const report=reports.financialReport(filters||{});
    const rows=report.rows.map(r=>[r.dueAt,r.kind,r.description,r.status,r.amountCents/100,r.settledCents/100,r.openCents/100,r.account,r.category,r.counterparty]);
    const bytes=toOdsBuffer({sheetName:'Lançamentos',headers:['Vencimento','Tipo','Descrição','Status','Valor (R$)','Baixado (R$)','Em aberto (R$)','Conta','Categoria','Contraparte'],rows});
    return {filename:'relatorio-financeiro.ods',mime:'application/vnd.oasis.opendocument.spreadsheet',dataBase64:bytes.toString('base64')};
  });
  ipcMain.handle('reports:csv', (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.csv', mime: 'text/csv;charset=utf-8', data: reports.toCsv(report) }; });
  ipcMain.handle('reports:xlsx', async (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64: (await reports.toStyledXlsxBuffer(report)).toString('base64') }; });
  ipcMain.handle('reports:docx', async (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: (await reports.toDocxBuffer(report)).toString('base64') }; });
  ipcMain.handle('reports:json', (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.json', mime: 'application/json;charset=utf-8', data: reports.toJsonBuffer(report).toString('utf8') }; });
  const archiveSelections=new Map();
  ipcMain.handle('reports:archive:select', async (_event,token)=>{
    auth.require(token,'finance.view');
    const chosen=await dialog.showOpenDialog({title:'Importar pacote financeiro ZIP',properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});
    if(chosen.canceled||!chosen.filePaths?.[0])return {canceled:true};
    const filename=chosen.filePaths[0];
    const info=fs.statSync(filename);
    if(!info.isFile()||info.size>80*1024*1024)throw new RangeError('Pacote maior que 80 MB');
    const raw=fs.readFileSync(filename);
    const preview=verifyAndPreviewPackage(raw);
    const id=crypto.randomUUID();
    archiveSelections.clear();
    archiveSelections.set(id,{filename,sha256:preview.sha256,expires:Date.now()+10*60*1000});
    return {canceled:false,archiveId:id,filename:path.basename(filename),preview};
  });
  ipcMain.handle('reports:archive:import', async (_event,token,archiveId)=>{
    const actor=auth.require(token,'finance.manage');
    const data=archiveSelections.get(archiveId);
    if(!data||data.expires<Date.now())throw new Error('Seleção do pacote expirada');
    const raw=fs.readFileSync(data.filename);
    const preview=verifyAndPreviewPackage(raw);
    if(preview.sha256!==data.sha256)throw new Error('Arquivo ZIP mudou após a prévia');
    const dir=path.join(app.getPath('userData'),'financial-report-archives');
    fs.mkdirSync(dir,{recursive:true});
    const output=path.join(dir,data.sha256+'.zip');
    fs.writeFileSync(output,raw,{flag:'wx'});
    writeAudit(database.connection(),{action:'financial.report.archive.import',entity:'report-archive',entityId:data.sha256,actor,
      context:{sha256:data.sha256,rows:preview.summary.rows,totals:preview.summary,filename:path.basename(data.filename)}});
    archiveSelections.delete(archiveId);
    return {imported:true,sha256:data.sha256,rows:preview.summary.rows,mode:'reference-only'};
  });
  ipcMain.handle('reports:form:select', async (_event,token)=>{auth.require(token,'finance.view');return documents.selectPdfForm();});
  ipcMain.handle('reports:form:fill', async (_event,token,formId,values)=>{auth.require(token,'finance.view');return documents.saveFilledPdf(formId,values);});
  ipcMain.handle('reports:package', async (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.zip', mime: 'application/zip', dataBase64: (await reports.toPackageBuffer(report)).toString('base64') }; });
  ipcMain.handle('reports:merge-pdf', async (_event, token) => { auth.require(token, 'finance.view'); return documents.mergeSelectedPdfs(); });
  ipcMain.handle('reports:pdf', async (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return documents.savePdf(reports.toPrintableHtml(report), { defaultName: 'relatorio-financeiro.pdf' }); });
  ipcMain.handle('reports:print', async (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return documents.printHtml(reports.toPrintableHtml(report)); });
  ipcMain.handle('reports:receipt-pdf', async (_event, token, settlementId) => { auth.require(token, 'finance.view'); const receipt = reports.settlementReceipt(settlementId); return documents.savePdf(reports.toPrintableHtml(receipt), { defaultName: `recibo-${settlementId}.pdf` }); });
  ipcMain.handle('reports:receipt-print', async (_event, token, settlementId) => { auth.require(token, 'finance.view'); return documents.printHtml(reports.toPrintableHtml(reports.settlementReceipt(settlementId))); });

  ipcMain.handle('backup:list', (_event, token, filters) => { auth.require(token, 'system.manage'); return backup.listBackups(filters || {}); });
  ipcMain.handle('backup:create', (_event, token) => { auth.require(token, 'system.manage'); return backup.createBackup({ kind: 'MANUAL' }); });
  ipcMain.handle('backup:verify', (_event, token, filePath) => { auth.require(token, 'system.manage'); return backup.verifyBackup(filePath); });
  ipcMain.handle('backup:restore-select', async (_event, token) => {
    const actor = auth.require(token, 'system.manage');
    if (!dialog) throw new Error('file dialog unavailable');
    const selected = await dialog.showOpenDialog({ title: 'Restaurar backup', properties: ['openFile'], filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }] });
    if (selected.canceled || !selected.filePaths?.[0]) return { canceled: true };
    const result = backup.restoreBackup(selected.filePaths[0], actor);
    if (app?.relaunch && app?.exit) setTimeout(() => { app.relaunch(); app.exit(0); }, 350);
    return { ...result, canceled: false, restarting: Boolean(app?.relaunch) };
  });

  ipcMain.handle('lan:status', (_event, token) => { auth.require(token, 'system.manage'); return lan.status(); });
  ipcMain.handle('lan:configure', async (_event, token, input) => {
    const actor = auth.require(token, 'system.manage');
    await lan.stop();
    const result = lan.configure(input || {}, actor);
    if (result.enabled) await lan.startConfigured();
    return lan.status();
  });
  ipcMain.handle('lan:pairing-code', (_event, token) => { const actor = auth.require(token, 'system.manage'); return lan.createPairingCode(actor); });

  ipcMain.handle('registry:customers:list', (_event, token, filters) => { auth.require(token, 'registry.view'); return registry.listCustomers(filters || {}); });
  ipcMain.handle('registry:customers:save', (_event, token, input) => { const actor = auth.require(token, 'registry.manage'); return registry.saveCustomer(input, actor); });
  ipcMain.handle('registry:customers:set-active', (_event, token, id, active) => { const actor = auth.require(token, 'registry.manage'); return registry.setCustomerActive(id, active, actor); });
  ipcMain.handle('registry:creditors:list', (_event, token, filters) => { auth.require(token, 'registry.view'); return registry.listCreditors(filters || {}); });
  ipcMain.handle('registry:creditors:save', (_event, token, input) => { const actor = auth.require(token, 'registry.manage'); return registry.saveCreditor(input, actor); });
  ipcMain.handle('registry:creditors:set-active', (_event, token, id, active) => { const actor = auth.require(token, 'registry.manage'); return registry.setCreditorActive(id, active, actor); });
  ipcMain.handle('registry:categories:list', (_event, token, filters) => { auth.require(token, 'registry.view'); return registry.listCategories(filters || {}); });
  ipcMain.handle('registry:categories:save', (_event, token, input) => { const actor = auth.require(token, 'registry.manage'); return registry.saveCategory(input, actor); });
  ipcMain.handle('registry:categories:set-active', (_event, token, id, active) => { const actor = auth.require(token, 'registry.manage'); return registry.setCategoryActive(id, active, actor); });
}

module.exports = { registerIpcHandlers };