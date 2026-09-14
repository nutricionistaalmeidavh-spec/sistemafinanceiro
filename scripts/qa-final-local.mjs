import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const electronExe = path.resolve(root, 'node_modules/electron/dist/electron.exe');
const qaCli = path.resolve(root, 'node_modules/@artisys/qa/src/cli.mjs');

if (!fs.existsSync(electronExe)) {
  console.error(`[qa-local] Electron nao encontrado em ${electronExe}`);
  process.exit(2);
}
if (!fs.existsSync(qaCli)) {
  console.error(`[qa-local] CLI do ArtiSys QA nao encontrado em ${qaCli}`);
  process.exit(2);
}

const env = { ...process.env };
// Electron must run as Electron, not as a Node subprocess. Some shells/tools leave
// this variable set and Playwright then reports only "Process failed to launch!".
delete env.ELECTRON_RUN_AS_NODE;

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
