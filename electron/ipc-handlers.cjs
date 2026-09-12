'use strict';

function registerIpcHandlers({ ipcMain, database, auth, finance, registry }) {
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

  ipcMain.handle('finance:accounts:list', (_event, token, filters) => {
    auth.require(token, 'finance.view');
    return finance.listAccounts(filters || {});
  });
  ipcMain.handle('finance:accounts:create', (_event, token, input) => {
    const actor = auth.require(token, 'finance.manage');
    return finance.createAccount(input, actor);
  });
  ipcMain.handle('finance:entries:list', (_event, token, filters) => {
    auth.require(token, 'finance.view');
    return finance.listEntries(filters || {});
  });
  ipcMain.handle('finance:entries:create', (_event, token, input) => {
    const actor = auth.require(token, 'finance.manage');
    return finance.createEntry(input, actor);
  });
  ipcMain.handle('finance:entries:settle', (_event, token, entryId, input) => {
    const actor = auth.require(token, 'finance.manage');
    return finance.settleEntry(entryId, input, actor);
  });
  ipcMain.handle('finance:settlements:reverse', (_event, token, settlementId, reason) => {
    const actor = auth.require(token, 'finance.manage');
    return finance.reverseSettlement(settlementId, { reason, actor });
  });
  ipcMain.handle('finance:entries:cancel', (_event, token, entryId, reason) => {
    const actor = auth.require(token, 'finance.manage');
    return finance.cancelEntry(entryId, { reason, actor });
  });
  ipcMain.handle('finance:summary', (_event, token, filters) => {
    auth.require(token, 'finance.view');
    return finance.getSummary(filters || {});
  });

  ipcMain.handle('registry:customers:list', (_event, token, filters) => {
    auth.require(token, 'registry.view');
    return registry.listCustomers(filters || {});
  });
  ipcMain.handle('registry:customers:save', (_event, token, input) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.saveCustomer(input, actor);
  });
  ipcMain.handle('registry:customers:set-active', (_event, token, id, active) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.setCustomerActive(id, active, actor);
  });
  ipcMain.handle('registry:creditors:list', (_event, token, filters) => {
    auth.require(token, 'registry.view');
    return registry.listCreditors(filters || {});
  });
  ipcMain.handle('registry:creditors:save', (_event, token, input) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.saveCreditor(input, actor);
  });
  ipcMain.handle('registry:creditors:set-active', (_event, token, id, active) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.setCreditorActive(id, active, actor);
  });
  ipcMain.handle('registry:categories:list', (_event, token, filters) => {
    auth.require(token, 'registry.view');
    return registry.listCategories(filters || {});
  });
  ipcMain.handle('registry:categories:save', (_event, token, input) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.saveCategory(input, actor);
  });
  ipcMain.handle('registry:categories:set-active', (_event, token, id, active) => {
    const actor = auth.require(token, 'registry.manage');
    return registry.setCategoryActive(id, active, actor);
  });
}

module.exports = { registerIpcHandlers };
