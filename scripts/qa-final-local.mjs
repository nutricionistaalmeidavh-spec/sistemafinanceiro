import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const electronDir = path.resolve(root, 'node_modules/electron');
const electronExe = path.resolve(electronDir, 'dist/electron.exe');
const electronInstall = path.resolve(electronDir, 'install.js');
const qaCli = path.resolve(root, 'node_modules/@artisys/qa/src/cli.mjs');
const qaOutputRoot = path.resolve(root, 'qa-artifacts/final');

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

function findLatestQaSummary() {
  if (!fs.existsSync(qaOutputRoot)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(qaOutputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summary = path.join(qaOutputRoot, entry.name, 'run-summary.json');
    if (!fs.existsSync(summary)) continue;
    const stat = fs.statSync(summary);
    candidates.push({ summary, dir: path.dirname(summary), mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

function printQaFailureDetails() {
  try {
    const latest = findLatestQaSummary();
    if (!latest) {
      console.error('[qa-local] QA falhou e nenhum run-summary.json foi encontrado.');
      return;
    }
    const summary = JSON.parse(fs.readFileSync(latest.summary, 'utf8'));
    const failedStep = Array.isArray(summary.steps)
      ? [...summary.steps].reverse().find(step => step?.status === 'failed')
      : null;

    console.error('\n[qa-local] ===== DETALHE DA FALHA QA =====');
    if (failedStep) {
      console.error(`[qa-local] Passo: ${failedStep.name || failedStep.action || failedStep.index}`);
      if (failedStep.error) console.error(`[qa-local] Erro do passo: ${failedStep.error}`);
    }
    if (summary.failure?.message) console.error(`[qa-local] Falha: ${summary.failure.message}`);

    const failureShot = path.join(latest.dir, 'screenshots', 'failure.png');
    if (fs.existsSync(failureShot)) console.error(`[qa-local] Screenshot: ${failureShot}`);
    console.error(`[qa-local] Resumo: ${latest.summary}`);
    console.error('[qa-local] ================================\n');
  } catch (error) {
    console.error(`[qa-local] Nao foi possivel ler o diagnostico do QA: ${error.message}`);
  }
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
  printQaFailureDetails();
  process.exit(2);
}

if ((result.status ?? 2) !== 0) printQaFailureDetails();
process.exit(result.status ?? 2);
