import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { summarizeRenderInteraction } from './qa-render-metrics.mjs';

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

  // Tour CRM não bloqueia os dados reais e pode ser reiniciado após o onboarding.
  await page.getByTestId('nav-crm-tour').click();
  await page.getByTestId('crm-tour').waitFor({state:'visible'});
  const guideTitles=['Cadastre um lead','Crie uma oportunidade','Acompanhe o funil','Prepare uma proposta','Confirme os recebíveis'];
  const guideTabs=['Leads','Funil','Funil','Propostas','Funil'];
  for(let step=0;step<guideTitles.length;step++){
    await page.getByTestId('crm-tour').getByRole('heading',{name:guideTitles[step]}).waitFor();
    if(await page.getByRole('tab',{name:guideTabs[step],exact:true}).getAttribute('aria-selected')!=='true'){
      throw new Error('O tour CRM não abriu a aba esperada na etapa '+(step+1));
    }
    await page.getByTestId('crm-tour').getByRole('button',{name:step===guideTitles.length-1?'Concluir tour':'Próxima etapa'}).click();
  }
  await page.getByTestId('crm-tour').waitFor({state:'hidden'});
  await page.getByTestId('crm-tour-restart').click();
  await page.getByTestId('crm-tour').waitFor({state:'visible'});
  const crmTourFolder=path.resolve('qa-artifacts/crm/screenshots');
  fs.mkdirSync(crmTourFolder,{recursive:true});
  await page.screenshot({path:path.join(crmTourFolder,'crm-tour-primeiro-acesso.png'),fullPage:true});
  await page.getByTestId('crm-tour').getByRole('button',{name:'Pular tour'}).click();
  await page.getByTestId('crm-tour').waitFor({state:'hidden'});
  console.log('CRM_FIRST_USE_TOUR_RESTART_SKIP_OK');

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
  await page.getByText('2 parcela(s) vinculada(s) ao Financeiro.').waitFor();
  const crmFolder=path.resolve('qa-artifacts/crm/screenshots');
  fs.mkdirSync(crmFolder,{recursive:true});
  await page.screenshot({path:path.join(crmFolder,'crm-comercial-funil-recebiveis.png'),fullPage:true});
  // The CRM installment link opens the same financial entry, not a second copy.
  await page.getByRole('button',{name:'Abrir no Financeiro'}).first().click();
  await page.getByTestId('finance-focused-row').waitFor({state:'visible'});
  console.log('CRM_CANONICAL_RECEIVABLE_NAVIGATION_OK');
  await page.getByTestId('nav-crm').click();
  await page.getByTestId('page-crm').waitFor({state:'visible'});
  console.log('CRM_LEAD_QUOTE_BILLING_CONFIRMATION_OK');

  // P2: exercita a agenda, indicadores, metas e configuração de funis no Electron real.
  await page.getByRole('tab',{name:'Agenda'}).click();
  await page.getByTestId('crm-p2-agenda').waitFor();
  await page.screenshot({path:path.join(crmFolder,'crm-p2-agenda-inicial.png'),fullPage:true});
  await page.getByTestId('crm-p2-opportunity-select').selectOption({label:'Oportunidade QA Comercial'});
  await page.getByTestId('crm-p2-appointment-form').getByLabel('Assunto').fill('Reunião P2 QA');
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

  // Isolated, per-interaction measurements; do not store financial/user data.
  const financeInteractions=[];
  await page.evaluate(() => { window.__ARTISYS_RENDER_STATS = {}; window.__ARTISYS_FINANCE_IPC_STATS = {}; });
  async function snapshotFinanceRender() {
    return page.evaluate(()=>({
      renders:window.__ARTISYS_RENDER_STATS || {},
      ipc:{...(window.__ARTISYS_FINANCE_IPC_STATS || {})}
    }));
  }
  async function trackFinance(interaction, action) {
    const before=await snapshotFinanceRender();
    const started=performance.now();
    await action();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await snapshotFinanceRender();
    const elapsedMs=performance.now()-started;
    const primary=summarizeRenderInteraction(interaction,
      {render:before.renders.finance,ipc:before.ipc},
      {render:after.renders.finance,ipc:after.ipc},elapsedMs);
    primary.components=Object.fromEntries(['finance-table','finance-entry-form','finance-payment-form','finance-decision-form']
      .map(id=>[id,summarizeRenderInteraction(interaction,{render:before.renders[id]},{render:after.renders[id]},elapsedMs)])
      .filter(([,result])=>result.commits>0));
    financeInteractions.push(primary);
    console.log('REACT_RENDER_INTERACTION '+JSON.stringify(primary));
  }
  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('nav-planning').click();

  // Fluxo real adicional: cadastro -> pagamento parcial -> edicao -> recorrencia.
  // Usa apenas o banco isolado ARTISYS_QA; nunca toca os dados do cliente.
  await trackFinance('finance-open',async()=>{
    await page.getByTestId('nav-finance').click();
    await page.getByText('Aluguel escritório').first().waitFor();
    await page.getByTestId('finance-new-entry').waitFor();
  });
  await trackFinance('finance-search',async()=>{
    await page.getByTestId('finance-search').fill('____qa-no-match____');
    await page.getByText('Nenhum lançamento encontrado com os filtros atuais.').waitFor();
    await page.getByTestId('finance-search').fill('');
    await page.getByText('Aluguel escritório').first().waitFor();
  });
  await trackFinance('finance-status',async()=>{
    await page.getByLabel('Filtrar status').selectOption('PARTIAL');
    await page.getByLabel('Filtrar status').selectOption('ALL');
    await page.getByText('Aluguel escritório').first().waitFor();
  });
  await trackFinance('finance-kind-receivable',async()=>{
    await page.getByRole('button',{name:'Contas a receber'}).click();
    await page.getByText('Mensalidade Cliente Alpha').first().waitFor();
  });
  await trackFinance('finance-kind-payable',async()=>{
    await page.getByRole('button',{name:'Contas a pagar'}).click();
    await page.getByText('Aluguel escritório').first().waitFor();
  });
  await trackFinance('finance-open-drawer',()=>page.getByTestId('finance-new-entry').click());
  const entryForm=page.getByTestId('finance-entry-drawer');
  await trackFinance('finance-form-description',()=>entryForm.getByLabel('Descrição',{exact:true}).fill('Conta E2E de regressão'));
  await trackFinance('finance-form-amount',()=>entryForm.getByLabel('Valor',{exact:true}).fill('100,00'));
  await trackFinance('finance-create',async()=>{
    await entryForm.getByRole('button',{name:'Salvar lançamento'}).click();
    await page.locator('tr').filter({hasText:'Conta E2E de regressão'}).waitFor();
  });
  const entryRow=page.locator('tr').filter({hasText:'Conta E2E de regressão'});
  await entryRow.waitFor();
  await trackFinance('finance-payment-open',()=>entryRow.getByRole('button',{name:'Registrar pagamento'}).click());
  const payForm=page.getByTestId('finance-payment-form');
  await trackFinance('finance-payment-amount',()=>payForm.getByLabel('Valor pago/recebido').fill('40,00'));
  await trackFinance('finance-payment',async()=>{
    await payForm.getByRole('button',{name:'Confirmar registro'}).click();
    await entryRow.getByText('Parcial',{exact:true}).waitFor({timeout:15000});
  });
  await trackFinance('finance-edit-open',()=>entryRow.getByRole('button',{name:'Editar Conta E2E de regressão'}).click());
  await trackFinance('finance-edit-description',()=>entryForm.getByLabel('Descrição',{exact:true}).fill('Conta E2E corrigida'));
  await trackFinance('finance-edit-amount',()=>entryForm.getByLabel('Valor',{exact:true}).fill('120,00'));
  await trackFinance('finance-edit',async()=>{
    await entryForm.getByRole('button',{name:'Salvar alterações'}).click();
    await page.locator('tr').filter({hasText:'Conta E2E corrigida'}).getByText('Parcial',{exact:true}).waitFor({timeout:15000});
  });

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

  await trackFinance('finance-reopen',async()=>{
    await page.getByTestId('nav-finance').click();
    await page.getByTestId('finance-new-entry').waitFor();
  });
  await trackFinance('finance-cancel-new-drawer',()=>page.getByTestId('finance-new-entry').click());
  await entryForm.getByLabel('Descrição',{exact:true}).fill('Conta cancelamento E2E');
  await entryForm.getByLabel('Valor',{exact:true}).fill('25,00');
  await trackFinance('finance-cancel-create',async()=>{
    await entryForm.getByRole('button',{name:'Salvar lançamento'}).click();
    await page.locator('tr').filter({hasText:'Conta cancelamento E2E'}).waitFor();
  });
  const cancelledRow=page.locator('tr').filter({hasText:'Conta cancelamento E2E'});
  await cancelledRow.waitFor({timeout:15000});
  await trackFinance('finance-cancel-open',()=>cancelledRow.getByRole('button',{name:'Cancelar',exact:true}).click());
  const decisionForm=page.getByTestId('finance-decision-form');
  await trackFinance('finance-cancel-reason',()=>decisionForm.getByLabel('Motivo obrigatório').fill('Lançamento duplicado em QA'));
  await trackFinance('finance-cancel',async()=>{
    await decisionForm.getByRole('button',{name:'Confirmar cancelamento'}).click();
    await cancelledRow.getByText('Cancelado',{exact:true}).waitFor({timeout:15000});
  });
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
    const detail={
      synthetic:true, environment:'electron-vite-dev', version:1,
      measuredInteractions:financeInteractions.length,
      interactions:financeInteractions
    };
    fs.writeFileSync(path.join(metricsFolder,'react-interactions.json'),JSON.stringify(detail,null,2));
    if(financeInteractions.some(row=>row.interaction==='finance-cancel' && (row.ipc.listEntries!==1 || row.ipc.summary!==1)))
      throw new Error('finance-cancel should perform exactly one canonical ledger reload');
    for(const name of ['finance-kind-receivable','finance-kind-payable']){
      const counter=financeInteractions.find(row=>row.interaction===name)?.ipc||{};
      if(counter.listAccounts || counter.listCustomers || counter.listCreditors ||
        counter.listEntries!==1 || counter.summary!==1 || counter.listCategories!==1)
        throw new Error(name+' must only reload kind-dependent canonical data: '+JSON.stringify(counter));
    }
    for(const name of ['finance-form-description','finance-form-amount','finance-payment-amount','finance-edit-description','finance-edit-amount','finance-cancel-reason']){
      const child=financeInteractions.find(row=>row.interaction===name)?.components?.['finance-table'];
      // The DEV Profiler may record ~0.1ms when a memoized subtree bails out;
      // fail only on measurable work (>1ms), not on instrumentation noise.
      if((child?.totalReactMs||0)>1)throw new Error(name+' rendered unchanged ledger rows: '+child.totalReactMs+'ms');
    }
    console.log('REACT_RENDER_INTERACTIONS_OK '+JSON.stringify({count:financeInteractions.length,cancelIpc:financeInteractions.find(x=>x.interaction==='finance-cancel')?.ipc}));
    console.log('REACT_RENDER_PROFILER_OK '+JSON.stringify(Object.fromEntries(Object.entries(renders).map(([name,v])=>[name,{commits:v.commits,totalMs:v.totalMs,maxMs:v.maxMs}]))));
  }

  // Mobile-first and keyboard regression check against the real Electron renderer.
  await page.setViewportSize({width:390,height:844});
  await page.getByTestId('mobile-nav-toggle').click();
  await page.getByTestId('nav-crm').click();
  // Wait for the off-canvas menu to finish sliding out before accepting screenshots.
  await page.waitForTimeout(450);
  await page.getByRole('tab',{name:'Funil'}).focus();
  await page.keyboard.press('ArrowRight');
  if(await page.getByRole('tab',{name:'Leads'}).getAttribute('aria-selected')!=='true')
    throw new Error('CRM tabs must be operable by keyboard on mobile');
  await page.screenshot({path:path.join(crmFolder,'crm-mobile-leads.png'),fullPage:true});
  await page.getByRole('tab',{name:'Agenda'}).click();
  await page.getByTestId('crm-p2-agenda').waitFor({state:'visible'});
  await page.screenshot({path:path.join(crmFolder,'crm-mobile-agenda.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if(overflow>3)throw new Error('Horizontal mobile document overflow: '+overflow+'px');
  console.log('CRM_MOBILE_KEYBOARD_AND_REFLOW_OK');

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
