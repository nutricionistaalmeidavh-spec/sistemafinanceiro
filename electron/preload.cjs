const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('financeiro', {
  system: { health: () => ipcRenderer.invoke('system:health') },
  auth: {
    needsBootstrap: () => ipcRenderer.invoke('auth:needs-bootstrap'),
    bootstrap: (input) => ipcRenderer.invoke('auth:bootstrap', input),
    login: (login, password) => ipcRenderer.invoke('auth:login', login, password),
    session: (token) => ipcRenderer.invoke('auth:session', token),
    logout: (token) => ipcRenderer.invoke('auth:logout', token),
    listUsers: (token) => ipcRenderer.invoke('auth:users:list', token),
    createUser: (token, input) => ipcRenderer.invoke('auth:users:create', token, input),
    setUserActive: (token, userId, active) => ipcRenderer.invoke('auth:users:set-active', token, userId, active),
  },
  finance: {
    listAccounts: (token, filters) => ipcRenderer.invoke('finance:accounts:list', token, filters),
    createAccount: (token, input) => ipcRenderer.invoke('finance:accounts:create', token, input),
    listEntries: (token, filters) => ipcRenderer.invoke('finance:entries:list', token, filters),
    createEntry: (token, input) => ipcRenderer.invoke('finance:entries:create', token, input),
    settleEntry: (token, entryId, input) => ipcRenderer.invoke('finance:entries:settle', token, entryId, input),
    reverseSettlement: (token, settlementId, reason) => ipcRenderer.invoke('finance:settlements:reverse', token, settlementId, reason),
    cancelEntry: (token, entryId, reason) => ipcRenderer.invoke('finance:entries:cancel', token, entryId, reason),
    summary: (token, filters) => ipcRenderer.invoke('finance:summary', token, filters),
  },
  cashflow: {
    listMovements: (token, filters) => ipcRenderer.invoke('cashflow:movements:list', token, filters),
    createMovement: (token, input) => ipcRenderer.invoke('cashflow:movements:create', token, input),
    transfer: (token, input) => ipcRenderer.invoke('cashflow:transfer', token, input),
    balances: (token, filters) => ipcRenderer.invoke('cashflow:balances', token, filters),
    summary: (token, filters) => ipcRenderer.invoke('cashflow:summary', token, filters),
  },
  analytics: {
    dre: (token, filters) => ipcRenderer.invoke('analytics:dre', token, filters),
    indicators: (token, filters) => ipcRenderer.invoke('analytics:indicators', token, filters),
    dashboard: (token, filters) => ipcRenderer.invoke('analytics:dashboard', token, filters),
  },
  recurrence: {
    list: (token, filters) => ipcRenderer.invoke('recurrence:list', token, filters),
    create: (token, input) => ipcRenderer.invoke('recurrence:create', token, input),
    setActive: (token, id, active) => ipcRenderer.invoke('recurrence:set-active', token, id, active),
    generate: (token, asOf) => ipcRenderer.invoke('recurrence:generate', token, asOf),
  },
  registry: {
    listCustomers: (token, filters) => ipcRenderer.invoke('registry:customers:list', token, filters),
    saveCustomer: (token, input) => ipcRenderer.invoke('registry:customers:save', token, input),
    setCustomerActive: (token, id, active) => ipcRenderer.invoke('registry:customers:set-active', token, id, active),
    listCreditors: (token, filters) => ipcRenderer.invoke('registry:creditors:list', token, filters),
    saveCreditor: (token, input) => ipcRenderer.invoke('registry:creditors:save', token, input),
    setCreditorActive: (token, id, active) => ipcRenderer.invoke('registry:creditors:set-active', token, id, active),
    listCategories: (token, filters) => ipcRenderer.invoke('registry:categories:list', token, filters),
    saveCategory: (token, input) => ipcRenderer.invoke('registry:categories:save', token, input),
    setCategoryActive: (token, id, active) => ipcRenderer.invoke('registry:categories:set-active', token, id, active),
  },
});
