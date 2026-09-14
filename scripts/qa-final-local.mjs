import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const electronDir = path.resolve(root, 'node_modules/electron');
const electronExe = path.resolve(electronDir, 'dist/electron.exe');
const electronInstall = path.resolve(electronDir, 'install.js');
const qaCli = path.resolve(root, 'node_modules/@artisys/qa/src/cli.mjs');

const env = { ...process.env };
// Electron must run as Electron, not as a Node subprocess. Some shells/tools leave
// this variable set and Playwright then reports only "Process failed to launch!".
delete env.ELECTRON_RUN_AS_NODE;

// QA fixture and final-screens must share the exact same credential. Generate a
// throwaway local password when the caller did not provide one explicitly.
if (!env.ARTISYS_QA_PASSWORD || env.ARTISYS_QA_PASSWORD.length < 10) {
  env.ARTISYS_QA_PASSWORD = `Qa-${randomBytes(18).toString('hex')}`;
  console.log('[qa-local] Credencial QA temporaria gerada para esta execucao.');
}
env.ARTISYS_QA = '1';
if (!env.ARTISYS_QA_RESET) env.ARTISYS_QA_RESET = '1';

function ensureElectronBinary() {
  if (fs.existsSync(electronExe)) return;

  if (!fs.existsSync(electronInstall)) {
    console.error(`[qa-local] Electron nao encontrado e install.js ausente em ${electronDir}`);
    process.exit(2);
  }

  console.log('[qa-local] Electron binario ausente; executando instalador oficial do pacote...');
  const install = spawnSync(process.execPath, [electronInstall], {
    cwd: electronDir,
    env,
    stdio: 'inherit',
    windowsHide: false,
  });

  if (install.error || install.status !== 0 || !fs.existsSync(electronExe)) {
    console.error(`[qa-local] Falha ao preparar Electron${install.error ? `: ${install.error.message}` : ` com codigo ${install.status}`}.`);
    process.exit(2);
  }

  console.log('[qa-local] Electron preparado com sucesso.');
}

ensureElectronBinary();

if (!fs.existsSync(qaCli)) {
  console.error(`[qa-local] CLI do ArtiSys QA nao encontrado em ${qaCli}`);
  process.exit(2);
}

const probe = spawnSync(electronExe, ['--version'], {
  cwd: root,
  env,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000,
});
if (probe.error || probe.status !== 0) {
  console.error(`[qa-local] Electron preflight falhou${probe.error ? `: ${probe.error.message}` : ` com codigo ${probe.status}`}.`);
  process.exit(2);
}
console.log(`[qa-local] Electron preflight OK: ${(probe.stdout || '').trim()}`);

const result = spawnSync(process.execPath, [
  qaCli,
  'run',
  '--config', './artisys-qa.config.json',
  '--environment', 'final',
  '--viewport', 'desktop',
  '--flow', 'final-screens',
  '--output', 'qa-artifacts/final',
], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  console.error(`[qa-local] Falha ao iniciar QA: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
