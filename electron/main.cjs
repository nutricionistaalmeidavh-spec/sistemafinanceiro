const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { DatabaseService } = require('./services/database.cjs');
const { createAuthService } = require('./services/auth-service.cjs');
const { createFinanceService } = require('./services/finance-service.cjs');
const { createRegistryService } = require('./services/registry-service.cjs');
const { createCashflowService } = require('./services/cashflow-service.cjs');
const { createAnalyticsService } = require('./services/analytics-service.cjs');
const { createRecurrenceService } = require('./services/recurrence-service.cjs');
const { createAlertService } = require('./services/alert-service.cjs');
const { createReportService } = require('./services/report-service.cjs');
const { createBackupService } = require('./services/backup-service.cjs');
const { createLanService } = require('./services/lan-service.cjs');
const { createDocumentService } = require('./services/document-service.cjs');
const { createStatementImportService } = require('./services/statement-import-service.cjs');
const { createWorkspaceService } = require('./services/workspace-service.cjs');
const { createPlanningService } = require('./services/planning-service.cjs');
const { createAttachmentOcrService } = require('./services/attachment-ocr-service.cjs');
const { seedQaFixture } = require('./services/qa-fixture-service.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { registerPlanningIpcHandlers } = require('./planning-ipc.cjs');

const qaMode = process.env.ARTISYS_QA === '1';
if (qaMode) {
  const qaUserData = path.join(os.tmpdir(), 'artisys-financeiro-qa');
  if (process.env.ARTISYS_QA_RESET === '1') fs.rmSync(qaUserData, { recursive: true, force: true });
  app.setPath('userData', qaUserData);
}

let database;
let lanService;
let workspaceService;

function createWindow() {
  const window = new BrowserWindow({
    width: qaMode ? 1440 : 1280,
    height: qaMode ? 900 : 800,
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

app.whenReady().then(async () => {
  database = new DatabaseService({
    dataDir: app.getPath('userData'),
    migrationsDir: path.join(__dirname, '..', 'database', 'migrations'),
  });
  database.open();
  const db = database.connection();
  const auth = createAuthService({ db });
  if (qaMode) seedQaFixture({ db, auth });
  const finance = createFinanceService({ db });
  const registry = createRegistryService({ db });
  const cashflow = createCashflowService({ db });
  const analytics = createAnalyticsService({ db, finance, cashflow });
  const recurrence = createRecurrenceService({ db, finance });
  const alerts = createAlertService({ db, finance, cashflow });
  const reports = createReportService({ db, finance, analytics });
  const planning = createPlanningService({ db, cashflow });
  const backup = createBackupService({ database, backupsDir: path.join(app.getPath('userData'), 'backups') });
  const documents = createDocumentService({ BrowserWindow, dialog });
  const statements = createStatementImportService({ db });
  const workspaceRoot = path.join(app.getPath('userData'), 'workspace');
  workspaceService = createWorkspaceService({
    rootDir: workspaceRoot,
    storageFile: path.join(app.getPath('userData'), 'workspace-meta.sqlite'),
    shell,
  });
  const attachmentOcr = createAttachmentOcrService({ db, workspaceRoot });
  lanService = createLanService({ db, finance, cashflow, analytics, alerts });

  try { backup.runAutomaticBackup(); } catch (error) { console.error('Automatic backup failed:', error); }
  try { await lanService.startConfigured(); } catch (error) { console.error('LAN server failed to start:', error); }

  registerIpcHandlers({ ipcMain, app, dialog, database, auth, finance, registry, cashflow, analytics, recurrence, alerts, reports, backup, lan: lanService, documents, statements, workspace: workspaceService });
  registerPlanningIpcHandlers({ ipcMain, auth, planning, attachmentOcr });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  lanService?.stop().catch(() => {});
  workspaceService?.close().catch(() => {});
  database?.close();
});