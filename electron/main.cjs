const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DatabaseService } = require('./services/database.cjs');
const { createAuthService } = require('./services/auth-service.cjs');
const { createFinanceService } = require('./services/finance-service.cjs');
const { createRegistryService } = require('./services/registry-service.cjs');
const { createCashflowService } = require('./services/cashflow-service.cjs');
const { createAnalyticsService } = require('./services/analytics-service.cjs');
const { createRecurrenceService } = require('./services/recurrence-service.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');

let database;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  database = new DatabaseService({
    dataDir: app.getPath('userData'),
    migrationsDir: path.join(__dirname, '..', 'database', 'migrations'),
  });
  database.open();
  const db = database.connection();
  const auth = createAuthService({ db });
  const finance = createFinanceService({ db });
  const registry = createRegistryService({ db });
  const cashflow = createCashflowService({ db });
  const analytics = createAnalyticsService({ db, finance, cashflow });
  const recurrence = createRecurrenceService({ db, finance });
  registerIpcHandlers({ ipcMain, database, auth, finance, registry, cashflow, analytics, recurrence });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => database?.close());
