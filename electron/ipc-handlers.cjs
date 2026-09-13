'use strict';

function registerIpcHandlers({ ipcMain, app, dialog, database, auth, finance, registry, cashflow, analytics, recurrence, alerts, reports, backup, lan, documents, statements }) {
  if (!ipcMain?.handle) throw new TypeError('ipcMain is required');
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
  ipcMain.handle('finance:accounts:create', (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return finance.createAccount(input, actor); });
  ipcMain.handle('finance:entries:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return finance.listEntries(filters || {}); });
  ipcMain.handle('finance:entries:create', (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return finance.createEntry(input, actor); });
  ipcMain.handle('finance:entries:settle', (_event, token, entryId, input) => { const actor = auth.require(token, 'finance.manage'); return finance.settleEntry(entryId, input, actor); });
  ipcMain.handle('finance:settlements:reverse', (_event, token, settlementId, reason) => { const actor = auth.require(token, 'finance.manage'); return finance.reverseSettlement(settlementId, { reason, actor }); });
  ipcMain.handle('finance:entries:cancel', (_event, token, entryId, reason) => { const actor = auth.require(token, 'finance.manage'); return finance.cancelEntry(entryId, { reason, actor }); });
  ipcMain.handle('finance:summary', (_event, token, filters) => { auth.require(token, 'finance.view'); return finance.getSummary(filters || {}); });

  ipcMain.handle('statements:preview', async (_event, token, input) => { auth.require(token, 'finance.view'); return statements.preview(input || {}); });
  ipcMain.handle('statements:commit', async (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return statements.commit(input || {}, actor); });
  ipcMain.handle('statements:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.listTransactions(filters || {}); });
  ipcMain.handle('statements:suggest-transfers', async (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.suggestTransfers(filters || {}); });
  ipcMain.handle('statements:suggest-entries', async (_event, token, filters) => { auth.require(token, 'finance.view'); return statements.suggestEntries(filters || {}); });
  ipcMain.handle('statements:decision', async (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return statements.recordDecision(input || {}, actor); });

  ipcMain.handle('cashflow:movements:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.listMovements(filters || {}); });
  ipcMain.handle('cashflow:movements:create', (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return cashflow.createManualMovement(input, actor); });
  ipcMain.handle('cashflow:transfer', (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return cashflow.transfer(input, actor); });
  ipcMain.handle('cashflow:balances', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.getAccountBalances(filters || {}); });
  ipcMain.handle('cashflow:summary', (_event, token, filters) => { auth.require(token, 'finance.view'); return cashflow.getCashflowSummary(filters || {}); });

  ipcMain.handle('analytics:dre', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getDre(filters || {}); });
  ipcMain.handle('analytics:indicators', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getIndicators(filters || {}); });
  ipcMain.handle('analytics:dashboard', (_event, token, filters) => { auth.require(token, 'finance.view'); return analytics.getDashboardSnapshot(filters || {}); });

  ipcMain.handle('recurrence:list', (_event, token, filters) => { auth.require(token, 'finance.view'); return recurrence.listRules(filters || {}); });
  ipcMain.handle('recurrence:create', (_event, token, input) => { const actor = auth.require(token, 'finance.manage'); return recurrence.createRule(input, actor); });
  ipcMain.handle('recurrence:set-active', (_event, token, id, active) => { const actor = auth.require(token, 'finance.manage'); return recurrence.setRuleActive(id, active, actor); });
  ipcMain.handle('recurrence:generate', (_event, token, asOf) => { const actor = auth.require(token, 'finance.manage'); return recurrence.generateDue({ asOf, actor }); });

  ipcMain.handle('alerts:list', (_event, token, filters) => { const actor = auth.require(token, 'finance.view'); return alerts.listAlerts({ ...(filters || {}), userId: actor.id }); });
  ipcMain.handle('alerts:ack', (_event, token, alertKey, state) => { const actor = auth.require(token, 'finance.view'); return alerts.acknowledge(alertKey, actor.id, state); });
  ipcMain.handle('alerts:thresholds:list', (_event, token) => { auth.require(token, 'finance.view'); return alerts.listAccountThresholds(); });
  ipcMain.handle('alerts:thresholds:set', (_event, token, accountId, thresholdCents, enabled) => { const actor = auth.require(token, 'finance.manage'); return alerts.setAccountThreshold(accountId, thresholdCents, actor, enabled); });
  ipcMain.handle('alerts:internal:save', (_event, token, input) => { const actor = auth.require(token, 'system.manage'); return alerts.saveInternalAlert(input, actor); });

  ipcMain.handle('reports:financial', (_event, token, filters) => { auth.require(token, 'finance.view'); return reports.financialReport(filters || {}); });
  ipcMain.handle('reports:receipt', (_event, token, settlementId) => { auth.require(token, 'finance.view'); return reports.settlementReceipt(settlementId); });
  ipcMain.handle('reports:csv', (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.csv', mime: 'text/csv;charset=utf-8', data: reports.toCsv(report) }; });
  ipcMain.handle('reports:xlsx', (_event, token, filters) => { auth.require(token, 'finance.view'); const report = reports.financialReport(filters || {}); return { filename: 'relatorio-financeiro.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64: reports.toXlsxBuffer(report).toString('base64') }; });
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