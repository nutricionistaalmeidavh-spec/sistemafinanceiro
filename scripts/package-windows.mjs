import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const electronBuilder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cleanRelease() {
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`[package-win] limpeza inicial encontrou ${error.code || error.message}; tentando continuar.`);
  }
}

function runBuild(attempt) {
  console.log(`\n[package-win] tentativa ${attempt}/3`);
  return spawnSync(process.execPath, [electronBuilder, '--win', 'nsis', '--x64', '--publish', 'never'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });
}

cleanRelease();

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const result = runBuild(attempt);
  if (result.error) {
    console.error(`[package-win] falha ao iniciar electron-builder: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status === 0) {
    console.log('\n[package-win] instalador gerado com sucesso.');
    process.exit(0);
  }
  if (attempt < 3) {
    console.warn('[package-win] build falhou; aguardando desbloqueio do Windows e limpando release antes de tentar novamente...');
    sleep(2500);
    cleanRelease();
    sleep(1500);
  }
}

console.error('\n[package-win] falhou apos 3 tentativas. Feche Explorer/antivirus que esteja inspecionando a pasta release e tente novamente.');
process.exit(1);
