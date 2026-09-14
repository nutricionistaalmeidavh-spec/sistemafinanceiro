'use strict';

function registerPlanningIpcHandlers({ ipcMain, auth, planning }) {
  if (!ipcMain?.handle || !auth || !planning) throw new TypeError('planning IPC dependencies are required');
  const view = (token) => auth.require(token, 'finance.view');
  const manage = (token) => auth.require(token, 'finance.manage');

  ipcMain.handle('planning:cost-centers:list', (_event, token, filters) => { view(token); return planning.listCostCenters(filters || {}); });
  ipcMain.handle('planning:cost-centers:save', (_event, token, input) => planning.saveCostCenter(input || {}, manage(token)));
  ipcMain.handle('planning:tags:list', (_event, token, filters) => { view(token); return planning.listTags(filters || {}); });
  ipcMain.handle('planning:tags:save', (_event, token, input) => planning.saveTag(input || {}, manage(token)));
  ipcMain.handle('planning:allocations:get', (_event, token, entryId) => { view(token); return planning.getEntryAllocations(entryId); });
  ipcMain.handle('planning:allocations:set', (_event, token, entryId, allocations) => planning.setEntryAllocations(entryId, allocations || [], manage(token)));
  ipcMain.handle('planning:entry-tags:get', (_event, token, entryId) => { view(token); return planning.getEntryTags(entryId); });
  ipcMain.handle('planning:entry-tags:set', (_event, token, entryId, tagIds) => planning.setEntryTags(entryId, tagIds || [], manage(token)));

  ipcMain.handle('planning:scenarios:list', (_event, token, filters) => { view(token); return planning.listScenarios(filters || {}); });
  ipcMain.handle('planning:scenarios:save', (_event, token, input) => planning.saveScenario(input || {}, manage(token)));
  ipcMain.handle('planning:budgets:list', (_event, token, filters) => { view(token); return planning.listBudgets(filters || {}); });
  ipcMain.handle('planning:budgets:save', (_event, token, input) => planning.saveBudget(input || {}, manage(token)));
  ipcMain.handle('planning:budgets:compare', (_event, token, filters) => { view(token); return planning.compareBudget(filters || {}); });
  ipcMain.handle('planning:goals:list', (_event, token, filters) => { view(token); return planning.listGoals(filters || {}); });
  ipcMain.handle('planning:goals:save', (_event, token, input) => planning.saveGoal(input || {}, manage(token)));

  ipcMain.handle('planning:attachments:list', (_event, token, entryId) => { view(token); return planning.listAttachments(entryId); });
  ipcMain.handle('planning:attachments:add', (_event, token, entryId, input) => planning.addAttachment(entryId, input || {}, manage(token)));
  ipcMain.handle('planning:attachments:review', (_event, token, id) => planning.reviewAttachment(id, manage(token)));

  ipcMain.handle('planning:approval-policies:list', (_event, token, filters) => { view(token); return planning.listApprovalPolicies(filters || {}); });
  ipcMain.handle('planning:approval-policies:save', (_event, token, input) => planning.saveApprovalPolicy(input || {}, manage(token)));
  ipcMain.handle('planning:approvals:list', (_event, token, filters) => { view(token); return planning.listApprovalRequests(filters || {}); });
  ipcMain.handle('planning:approvals:request', (_event, token, input) => planning.requestApproval(input || {}, manage(token)));
  ipcMain.handle('planning:approvals:decide', (_event, token, requestId, input) => planning.decideApproval(requestId, input || {}, manage(token)));

  ipcMain.handle('planning:bulk', (_event, token, input) => planning.runBulkOperation(input || {}, manage(token)));
  ipcMain.handle('planning:projection', (_event, token, input) => { view(token); return planning.getProjection(input || {}); });
}

module.exports = { registerPlanningIpcHandlers };
