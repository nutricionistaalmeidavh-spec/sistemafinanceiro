import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const output = path.resolve('qa-artifacts/final/screenshots');
const flow = JSON.parse(fs.readFileSync('qa/flows/final-screens.json', 'utf8'));
const qaPassword = process.env.ARTISYS_QA_PASSWORD || `Qa-${randomBytes(18).toString('hex')}`;
const packagedExecutable = process.platform === 'win32'
  ? path.resolve('release/win-unpacked/ArtiSys Financeiro.exe')
  : null;
const electronExecutable = process.platform === 'win32'
  ? path.resolve('node_modules/electron/dist/electron.exe')
  : path.resolve('node_modules/electron/dist/electron');
const usePackagedApp = Boolean(packagedExecutable && fs.existsSync(packagedExecutable));
const executablePath = usePackagedApp ? packagedExecutable : electronExecutable;
const viteCli = path.resolve('node_modules/vite/bin/vite.js');

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

let vite = null;
const viteLogs = [];
if (!usePackagedApp) {
  if (!fs.existsSync(viteCli)) throw new Error(`Vite CLI not found: ${viteCli}`);
  vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  vite.stdout.on('data', (chunk) => viteLogs.push(String(chunk)));
  vite.stderr.on('data', (chunk) => viteLogs.push(String(chunk)));
}

let app = null;
let page = null;
const diagnostics = { startedAt: new Date().toISOString(), status: 'running', screenshots: [], errors: [] };
try {
  if (!usePackagedApp) await waitForServer('http://127.0.0.1:5173', 60000);
  if (!fs.existsSync(executablePath) && !usePackagedApp) {
    const installScript = path.resolve('node_modules/electron/install.js');
    if (!fs.existsSync(installScript)) throw new Error(`Electron installer missing: ${installScript}`);
    const install = spawnSync(process.execPath, [installScript], {
      cwd: path.dirname(installScript),
      env: process.env,
      stdio: 'inherit',
      timeout: 180000,
    });
    if (install.error || install.status !== 0) throw new Error(`Electron binary install failed: ${install.error?.message || install.status}`);
  }
  if (!fs.existsSync(executablePath)) throw new Error(`Electron executable not found: ${executablePath}`);

  const appEnv = {
    ...process.env,
    ARTISYS_QA: '1',
    ARTISYS_QA_RESET: '1',
    ARTISYS_QA_PASSWORD: qaPassword,
  };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  if (!usePackagedApp) appEnv.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173';

  app = await electron.launch({
    executablePath,
    args: usePackagedApp ? [] : [path.resolve('electron/main.cjs')],
    cwd: root,
    env: appEnv,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => diagnostics.errors.push(String(error?.message || error)));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  for (const step of flow.steps) {
    switch (step.action) {
      case 'waitFor':
        await locator(page, step).first().waitFor({ state: step.state || 'visible', timeout: step.timeoutMs || 15000 });
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
        diagnostics.screenshots.push(path.basename(target));
        console.log(`[evidence] ${target}`);
        break;
      }
      default:
        throw new Error(`Unsupported final evidence action: ${step.action}`);
    }
  }

  // Instrument the actual React render/commit cost in QA only (Vite dev).
  await page.evaluate(() => { window.__ARTISYS_RENDER_STATS = {}; });
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('nav-planning').click();

  // Fluxo real adicional: cadastro -> pagamento parcial -> edicao -> recorrencia.
  // Usa apenas o banco isolado ARTISYS_QA; nunca toca os dados do cliente.
  await page.getByTestId('nav-finance').click();
  await page.getByTestId('finance-new-entry').click();
  await page.screenshot({ path: path.join(output, '18-novo-lancamento-final.png') });
  diagnostics.screenshots.push('18-novo-lancamento-final.png');
  const entryForm=page.getByTestId('finance-entry-drawer');
  await entryForm.getByLabel('Descrição',{exact:true}).fill('Conta E2E de regressão');
  await entryForm.getByLabel('Valor',{exact:true}).fill('100,00');
  await entryForm.getByRole('button',{name:'Salvar lançamento'}).click();
  const entryRow=page.locator('tr').filter({hasText:'Conta E2E de regressão'});
  await entryRow.waitFor();
  await entryRow.getByRole('button',{name:'Registrar pagamento'}).click();
  await page.getByTestId('finance-payment-form').waitFor();
  await page.screenshot({ path: path.join(output, '19-registrar-pagamento-final.png') });
  diagnostics.screenshots.push('19-registrar-pagamento-final.png');
  const payForm=page.getByTestId('finance-payment-form');
  await payForm.getByLabel('Valor pago/recebido').fill('40,00');
  await payForm.getByRole('button',{name:'Confirmar registro'}).click();
  await entryRow.getByText('Parcial',{exact:true}).waitFor({timeout:15000});
  await entryRow.getByRole('button',{name:'Editar Conta E2E de regressão'}).click();
  await entryForm.getByLabel('Descrição',{exact:true}).fill('Conta E2E corrigida');
  await entryForm.getByLabel('Valor',{exact:true}).fill('120,00');
  await entryForm.getByRole('button',{name:'Salvar alterações'}).click();
  await page.locator('tr').filter({hasText:'Conta E2E corrigida'}).getByText('Parcial',{exact:true}).waitFor({timeout:15000});

  await page.getByTestId('nav-recurring').click();
  const recurringForm=page.getByTestId('recurring-form');
  await recurringForm.getByLabel('Descrição',{exact:true}).fill('Recorrência E2E');
  await recurringForm.getByLabel('Valor',{exact:true}).fill('89,90');
  await recurringForm.getByRole('button',{name:'Salvar recorrência'}).click();
  const recurringRow=page.locator('tr').filter({hasText:'Recorrência E2E'});
  await recurringRow.waitFor({timeout:15000});
  await recurringRow.getByRole('button',{name:'Editar'}).click();
  await recurringForm.getByLabel('Valor',{exact:true}).fill('99,90');
  await recurringForm.getByRole('button',{name:'Salvar alterações'}).click();
  await recurringRow.getByText('R$ 99,90').waitFor({timeout:15000});
  await recurringRow.getByRole('button',{name:'Ver lançamentos'}).click();
  await page.getByTestId('recurring-history').waitFor();
  await page.screenshot({ path: path.join(output, '20-historico-recorrencia-final.png') });
  diagnostics.screenshots.push('20-historico-recorrencia-final.png');
  const history=page.getByTestId('recurring-history');
  await history.getByText('R$ 89,90',{exact:false}).first().waitFor({timeout:15000});
  await history.getByRole('button',{name:'Fechar',exact:true}).click();

  await page.getByTestId('nav-finance').click();
  await page.getByTestId('finance-new-entry').click();
  await entryForm.getByLabel('Descrição',{exact:true}).fill('Conta cancelamento E2E');
  await entryForm.getByLabel('Valor',{exact:true}).fill('25,00');
  await entryForm.getByRole('button',{name:'Salvar lançamento'}).click();
  const cancelledRow=page.locator('tr').filter({hasText:'Conta cancelamento E2E'});
  await cancelledRow.waitFor({timeout:15000});
  await cancelledRow.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByTestId('finance-decision-form').waitFor();
  await page.screenshot({ path: path.join(output, '21-confirmar-cancelamento-final.png') });
  diagnostics.screenshots.push('21-confirmar-cancelamento-final.png');
  const decisionForm=page.getByTestId('finance-decision-form');
  await decisionForm.getByLabel('Motivo obrigatório').fill('Lançamento duplicado em QA');
  await decisionForm.getByRole('button',{name:'Confirmar cancelamento'}).click();
  await cancelledRow.getByText('Cancelado',{exact:true}).waitFor({timeout:15000});
  console.log('FINANCE_RECURRENCE_HISTORY_AND_CANCEL_OK');
  console.log('FINANCE_USER_JOURNEY_OK');

  if (!usePackagedApp) {
    const renders = await page.evaluate(() => window.__ARTISYS_RENDER_STATS || {});
    for (const view of ['dashboard','planning','finance']) {
      if (!(renders[view]?.commits > 0)) throw new Error(`React Profiler missing QA commits for ${view}`);
    }
    const metricsFolder=path.resolve('qa-artifacts/final/metrics');
    fs.mkdirSync(metricsFolder,{recursive:true});
    fs.writeFileSync(path.join(metricsFolder,'react-renders.json'),JSON.stringify(renders,null,2));
    console.log('REACT_RENDER_PROFILER_OK '+JSON.stringify(renders));
  }


  // Fluxos adicionais de primeiro uso e ativacao: processos Electron reais, mas
  // em bancos QA diferentes, sem tocar na fixture financeira nem nas licencas do cliente.
  if (!usePackagedApp) {
    const captureExtra = async (filename) => {
      await page.screenshot({ path: path.join(output, filename) });
      diagnostics.screenshots.push(filename);
      console.log('[evidence] ' + path.join(output, filename));
    };
    const launchVariant = async (entry, flags) => {
      if (app) await app.close();
      app = null;
      page = null;
      app = await electron.launch({
        executablePath: electronExecutable,
        args: [path.resolve(entry)],
        cwd: root,
        env: { ...appEnv, ...flags },
        timeout: 60000,
      });
      page = await app.firstWindow();
      await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
      page.on('pageerror', error => diagnostics.errors.push(String(error?.message || error)));
    };

    await launchVariant('electron/main.cjs', { ARTISYS_QA_EMPTY: '1' });
    await page.getByRole('button', { name: 'Criar administrador' }).waitFor({ timeout: 20000 });
    await captureExtra('22-criar-administrador-final.png');
    await page.getByLabel('Senha', { exact: true }).fill(qaPassword);
    await page.getByRole('button', { name: 'Criar administrador' }).click();
    await page.getByTestId('app-shell').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Configuração passo a passo' }).click();
    const guide = page.getByRole('dialog', { name: 'Preparar o financeiro' });
    await guide.getByLabel('Nome da conta').waitFor({ timeout: 15000 });
    await captureExtra('23-guia-conta-final.png');
    await guide.getByLabel('Nome da conta').fill('Banco Demonstrativo QA');
    await guide.getByRole('button', { name: 'Salvar e continuar' }).click();
    await guide.getByLabel('Saldo inicial (R$)').waitFor({ timeout: 15000 });
    await captureExtra('24-guia-saldo-final.png');
    await guide.getByLabel('Saldo inicial (R$)').fill('1500,00');
    await guide.getByRole('button', { name: 'Continuar', exact: true }).click();
    await guide.getByText('Registre seu primeiro lançamento').waitFor({ timeout: 15000 });
    await captureExtra('25-guia-lancamento-final.png');
    await guide.getByLabel('Descrição', { exact: true }).fill('Despesa demonstrativa QA');
    await guide.getByLabel('Valor (R$)').fill('99,90');
    await guide.getByRole('button', { name: 'Concluir primeiro lançamento' }).click();
    await guide.getByText('Pronto para usar').waitFor({ timeout: 15000 });
    await captureExtra('26-guia-concluido-final.png');
    await guide.getByRole('button', { name: 'Ver meu financeiro' }).click();
    await page.getByText('Banco Demonstrativo QA').first().waitFor({ timeout: 15000 });
    await captureExtra('27-dashboard-primeiro-uso-final.png');

    await launchVariant('electron/trial-main.cjs', { ARTISYS_QA_LICENSE_SCREEN: '1' });
    await page.getByRole('heading', { name: 'Ativar avaliação' }).waitFor({ timeout: 20000 });
    await captureExtra('28-ativar-licenca-final.png');
  }

  const files = fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort();
  const expected = flow.steps.filter(step => step.action === 'screenshot').length + 4 + (usePackagedApp ? 0 : 7);
  if (files.length !== expected) throw new Error(`Expected ${expected} final screenshots, found ${files.length}`);
  diagnostics.status = 'passed';
  console.log(`FINAL_SCREENSHOTS_OK ${files.length}`);
} catch (error) {
  diagnostics.status = 'failed';
  diagnostics.failure = String(error?.stack || error?.message || error);
  if (page) {
    try {
      await page.screenshot({ path: path.join(output, 'failure.png') });
      diagnostics.screenshots.push('failure.png');
    } catch (screenshotError) {
      diagnostics.errors.push('Failure screenshot unavailable: ' + String(screenshotError?.message || screenshotError));
    }
  }
  console.error(error.stack || error.message || error);
  if (viteLogs.length) console.error(viteLogs.slice(-30).join(''));
  process.exitCode = 1;
} finally {
  diagnostics.finishedAt = new Date().toISOString();
  diagnostics.screenshots = fs.readdirSync(output).filter(filename => filename.endsWith('.png')).sort();
  fs.writeFileSync(path.resolve('qa-artifacts/final/run-summary.json'), JSON.stringify(diagnostics, null, 2));
  if (app) await app.close().catch(() => {});
  stopTree(vite);
}
