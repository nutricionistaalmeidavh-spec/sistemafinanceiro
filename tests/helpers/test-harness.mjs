import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseService } = require('../../electron/services/database.cjs');
const { createFinanceService } = require('../../electron/services/finance-service.cjs');
const { createCashflowService } = require('../../electron/services/cashflow-service.cjs');
const { createAnalyticsService } = require('../../electron/services/analytics-service.cjs');
const { createRecurrenceService } = require('../../electron/services/recurrence-service.cjs');
const { createStatementImportService } = require('../../electron/services/statement-import-service.cjs');

export function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemafinanceiro-e06e09-'));
  const database = new DatabaseService({ dataDir: path.join(root, 'data'), migrationsDir: path.resolve('database/migrations'), databaseFactory: (filename) => new DatabaseSync(filename) });
  database.open();
  const db = database.connection();
  const now = () => '2026-09-12T12:00:00.000Z';
  const finance = createFinanceService({ db, now });
  const cashflow = createCashflowService({ db, now });
  const analytics = createAnalyticsService({ db, finance, cashflow, now });
  const recurrence = createRecurrenceService({ db, finance, now });
  const statements = createStatementImportService({ db, now });
  return { root, database, db, finance, cashflow, analytics, recurrence, statements, cleanup() { database.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
