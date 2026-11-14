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
// Segurança: somente Electron desempacotado pode habilitar fixture e bypass QA.
const usePackagedApp = false;
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
try {
  if (!usePackagedApp) await waitForServer('http://127.0.0.1:5173', 60000);
  if (!fs.existsSync(executablePath)) throw new Error(`Electron executable not found: ${executablePath}`);

  const appEnv = {
    ...process.env,
    ARTISYS_QA: '1',
    ARTISYS_QA_RESET: '1',
    ARTISYS_QA_PASSWORD: qaPassword,
  };
  if (!usePackagedApp) appEnv.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173';

  app = await electron.launch({
    executablePath,
    args: usePackagedApp ? [] : [path.resolve('electron/main.cjs')],
    cwd: root,
    env: appEnv,
    timeout: 60000,
  });
  const page = await app.firstWindow();
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
        console.log(`[evidence] ${target}`);
        break;
      }
      default:
        throw new Error(`Unsupported final evidence action: ${step.action}`);
    }
  }


  // CRM comercial end-to-end em fixture isolada; a venda ganha não deve gerar dinheiro.
  await page.getByTestId('nav-crm').click();
  await page.getByTestId('page-crm').waitFor({state:'visible'});
  await page.getByRole('tab',{name:'Leads'}).click();
  await page.getByLabel('Nome',{exact:true}).fill('Lead Comercial QA');
  await page.getByLabel('E-mail',{exact:true}).fill('crm-qa@example.test');
  await page.getByRole('button',{name:'Cadastrar lead'}).click();
  await page.getByText('Lead Comercial QA').first().waitFor();
  await page.getByRole('tab',{name:'Funil'}).click();
  await page.getByLabel('Lead ou cliente').selectOption({label:'Lead Comercial QA'});
  await page.getByLabel('Nome da oportunidade').fill('Oportunidade QA Comercial');
  await page.getByLabel('Estimativa (R$)').fill('100,00');
  await page.getByRole('button',{name:'Adicionar',exact:true}).click();
  await page.getByTestId('crm-opportunity-detail').waitFor({state:'visible'});
  await page.getByPlaceholder('Produto ou serviço').fill('Serviço QA');
  await page.getByLabel('Valor unitário').fill('100,00');
  await page.getByRole('button',{name:'Criar proposta'}).click();
  await page.getByLabel('Mover oportunidade').selectOption('WON');
  await page.getByText('Venda ganha. Nenhum recebível é criado sem sua confirmação.').waitFor();
  await page.getByRole('button',{name:'Converter lead em cliente'}).click();
  await page.getByLabel('Parcelas').selectOption('2');
  await page.getByRole('button',{name:'Visualizar recebíveis'}).click();
  await page.getByText('Prévia, sem lançamento financeiro').waitFor();
  await page.getByRole('button',{name:'Confirmar e criar 2 recebível(is)'}).click();
  await page.getByText('2 parcela(s) já vinculada(s) ao Financeiro.').waitFor();
  const crmFolder=path.resolve('qa-artifacts/crm/screenshots');
  fs.mkdirSync(crmFolder,{recursive:true});
  await page.screenshot({path:path.join(crmFolder,'crm-comercial-funil-recebiveis.png'),fullPage:true});
  console.log('CRM_LEAD_QUOTE_BILLING_CONFIRMATION_OK');

  // P2: exercita a agenda, indicadores, metas e configuração de funis no Electron real.
  await page.getByRole('tab',{name:'Agenda'}).click();
  await page.getByTestId('crm-p2-agenda').waitFor();
  await page.getByLabel('Oportunidade',{exact:true}).selectOption({label:'Oportunidade QA Comercial'});
  await page.getByLabel('Assunto').fill('Reunião P2 QA');
  await page.getByRole('button',{name:'Salvar compromisso'}).click();
  await page.getByText('Reunião P2 QA').first().waitFor({timeout:15000});
  await page.screenshot({path:path.join(crmFolder,'crm-p2-agenda.png'),fullPage:true});
  await page.getByRole('tab',{name:'Indicadores'}).click();
  await page.getByTestId('crm-p2-reports').waitFor();
  await page.getByText('Taxa de fechamento').waitFor();
  await page.screenshot({path:path.join(crmFolder,'crm-p2-relatorios.png'),fullPage:true});
  await page.getByRole('tab',{name:'Metas'}).click();
  await page.getByTestId('crm-p2-goals').waitFor();
  await page.getByText('Meta por vendedor').waitFor();
  await page.getByRole('tab',{name:'Configurar funis'}).click();
  await page.getByTestId('crm-p2-pipelines').waitFor();
  await page.getByText('Etapas e probabilidades').waitFor();
  console.log('CRM_P2_AGENDA_REPORTS_PIPELINES_OK');

  // Instrument the actual React render/commit cost in QA only (Vite dev).
  await page.evaluate(() => { window.__ARTISYS_RENDER_STATS = {}; });
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('nav-planning').click();

  // Fluxo real adicional: cadastro -> pagamento parcial -> edicao -> recorrencia.
  // Usa apenas o banco isolado ARTISYS_QA; nunca toca os dados do cliente.
  await page.getByTestId('nav-finance').click();
  await page.getByTestId('finance-new-entry').click();
  const entryForm=page.getByTestId('finance-entry-drawer');
  await entryForm.getByLabel('Descrição',{exact:true}).fill('Conta E2E de regressão');
  await entryForm.getByLabel('Valor',{exact:true}).fill('100,00');
  await entryForm.getByRole('button',{name:'Salvar lançamento'}).click();
  const entryRow=page.locator('tr').filter({hasText:'Conta E2E de regressão'});
  await entryRow.waitFor();
  await entryRow.getByRole('button',{name:'Registrar pagamento'}).click();
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
  const recurringRow=page.getByTestId('page-recurring').locator('table').first().locator('tbody tr').filter({hasText:'Recorrência E2E'});
  await recurringRow.waitFor({timeout:15000});
  await recurringRow.getByRole('button',{name:'Editar'}).click();
  await recurringForm.getByLabel('Valor',{exact:true}).fill('99,90');
  await recurringForm.getByRole('button',{name:'Salvar alterações'}).click();
  await recurringRow.locator('td').nth(2).getByText('R$ 99,90',{exact:true}).waitFor({timeout:15000});
  await recurringRow.getByRole('button',{name:'Ver lançamentos'}).click();
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

  const files = fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort();
  if (files.length !== 12) throw new Error(`Expected 12 final screenshots, found ${files.length}`);
  console.log(`FINAL_SCREENSHOTS_OK ${files.length}`);
} catch (error) {
  console.error(error.stack || error.message || error);
  if (viteLogs.length) console.error(viteLogs.slice(-30).join(''));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  stopTree(vite);
}
