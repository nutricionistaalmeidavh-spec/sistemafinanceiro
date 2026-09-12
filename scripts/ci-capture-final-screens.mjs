import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const output = path.resolve('qa-artifacts/final/screenshots');
const flow = JSON.parse(fs.readFileSync('qa/flows/final-screens.json', 'utf8'));
const qaPassword = process.env.ARTISYS_QA_PASSWORD || `Qa-${randomBytes(18).toString('hex')}`;
const viteCli = path.resolve('node_modules/vite/bin/vite.js');
const electronExecutable = process.platform === 'win32'
  ? path.resolve('node_modules/electron/dist/electron.exe')
  : path.resolve('node_modules/electron/dist/electron');

fs.rmSync(path.resolve('qa-artifacts/final'), { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

function locator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.role) return page.getByRole(step.role, step.name ? { name: step.name, exact: step.exact ?? false } : undefined);
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.selector) return page.locator(step.selector);
  throw new Error(`Step ${step.action} requires a locator`);
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite did not become ready at ${url}: ${lastError?.message || 'timeout'}`);
}

function stopTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

if (!fs.existsSync(viteCli)) throw new Error(`Vite CLI not found: ${viteCli}`);
const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});
const viteLogs = [];
vite.stdout.on('data', (chunk) => viteLogs.push(String(chunk)));
vite.stderr.on('data', (chunk) => viteLogs.push(String(chunk)));

let app = null;
try {
  await waitForServer('http://127.0.0.1:5173', 60000);
  if (!fs.existsSync(electronExecutable)) throw new Error(`Electron executable not found: ${electronExecutable}`);

  app = await electron.launch({
    executablePath: electronExecutable,
    args: [path.resolve('electron/main.cjs')],
    cwd: root,
    env: {
      ...process.env,
      ARTISYS_QA: '1',
      ARTISYS_QA_RESET: '1',
      ARTISYS_QA_PASSWORD: qaPassword,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  for (const step of flow.steps) {
    switch (step.action) {
      case 'waitFor':
        await locator(page, step).waitFor({ state: step.state || 'visible', timeout: step.timeoutMs || 15000 });
        break;
      case 'fill': {
        const value = step.valueFromEnv === 'ARTISYS_QA_PASSWORD'
          ? qaPassword
          : step.valueFromEnv
            ? process.env[step.valueFromEnv]
            : step.value ?? '';
        if (value == null) throw new Error(`Missing QA value for ${step.valueFromEnv}`);
        await locator(page, step).fill(value);
        break;
      }
      case 'click':
        await locator(page, step).click();
        break;
      case 'waitForTimeout':
        await page.waitForTimeout(step.timeoutMs ?? 250);
        break;
      case 'screenshot': {
        const target = path.join(output, `${step.name}.png`);
        await page.screenshot({ path: target, fullPage: false });
        console.log(`[evidence] ${target}`);
        break;
      }
      default:
        throw new Error(`Unsupported final evidence action: ${step.action}`);
    }
  }

  const files = fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort();
  if (files.length !== 10) throw new Error(`Expected 10 final screenshots, found ${files.length}`);
  console.log(`FINAL_SCREENSHOTS_OK ${files.length}`);
} catch (error) {
  console.error(error.stack || error.message || error);
  if (viteLogs.length) console.error(viteLogs.slice(-30).join(''));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  stopTree(vite);
}
