import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';

// Full, unmocked Electron + SQLite QA run. This is NEVER enabled in packaged builds.
// The disposable QA profile is reset before boot and contains only synthetic data.
const root = process.cwd();
const target = path.resolve('qa-artifacts/crm/video');
const shots = path.join(target, 'screenshots');
const qaPassword = 'Qa-' + randomBytes(20).toString('hex');
const viteCli = path.resolve('node_modules/vite/bin/vite.js');
const electronExe = process.platform === 'win32'
  ? path.resolve('node_modules/electron/dist/electron.exe')
  : path.resolve('node_modules/electron/dist/electron');
const videoPath = path.join(target, 'qa-primeiro-acesso-crm.webm');
fs.mkdirSync(shots, { recursive: true });

function terminate(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio:'ignore' });
  } else child.kill('SIGTERM');
}
async function ready(url, maxMs = 60000) {
  const expires = Date.now() + maxMs;
  while (Date.now() < expires) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Vite did not start at ' + url);
}
const viteEnv = { ...process.env };
delete viteEnv.ELECTRON_RUN_AS_NODE;
const vite = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
  cwd:root, env:viteEnv, stdio:'ignore', shell:false
});
let app;
let video;
let fail;
const errors = [];
try {
  if (!fs.existsSync(electronExe)) throw new Error('Electron executable unavailable: ' + electronExe);
  await ready('http://127.0.0.1:5173');
  const env = {
    ...viteEnv,
    ARTISYS_QA:'1',
    ARTISYS_QA_RESET:'1',
    ARTISYS_QA_ONBOARDING:'1',
    ARTISYS_QA_PASSWORD:qaPassword,
    VITE_DEV_SERVER_URL:'http://127.0.0.1:5173',
  };
  app = await electron.launch({
    executablePath:electronExe,
    args:[path.resolve('electron/main.cjs')],
    cwd:root,
    env,
    timeout:60000,
    recordVideo:{dir:target,size:{width:1440,height:900},fps:25}
  });
  const page = await app.firstWindow();
  video = page.video();
  if (!video) throw new Error('Playwright Electron did not enable video recording');
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({width:1440,height:900});
  const pause = (ms=500) => page.waitForTimeout(ms);
  const shot = async (name) => {
    await pause(350);
    await page.screenshot({path:path.join(shots,name+'.png'),fullPage:false});
    console.log('QA_SCENE_OK ' + name);
  };

  // The administrator exists; money, customers and opportunities do not.
  await page.getByLabel('Usuário',{exact:true}).waitFor({state:'visible',timeout:25000});
  await page.getByLabel('Usuário',{exact:true}).fill('admin');
  await page.getByLabel('Senha',{exact:true}).fill(qaPassword);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByTestId('app-shell').waitFor({state:'visible',timeout:25000});
  await page.getByTestId('first-use-guide').waitFor({state:'visible',timeout:25000});
  await shot('01-dashboard-primeiro-acesso');

  // Real onboarding: create account, opening balance and first entry via the UI.
  await page.getByRole('button',{name:'Configuração passo a passo'}).click();
  await page.getByTestId('first-use-guide').last().waitFor({state:'visible'});
  await shot('02-configuracao-financeira');
  await page.getByLabel('Nome da conta').fill('Banco Demonstração QA');
  await page.getByRole('button',{name:'Salvar e continuar'}).click();
  await page.getByText('Qual o saldo inicial desta conta?').waitFor();
  await shot('03-saldo-inicial');
  await page.getByLabel('Saldo inicial (R$)').fill('1500,00');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByText('Registre seu primeiro lançamento').waitFor();
  await page.getByLabel('Descrição',{exact:true}).fill('Primeiro lançamento QA');
  await page.getByLabel('Valor (R$)').fill('250,00');
  await shot('04-primeiro-lancamento');
  await page.getByRole('button',{name:'Concluir primeiro lançamento'}).click();
  await page.getByTestId('first-use-crm-step').waitFor();
  await shot('05-iniciar-tour-crm');
  await page.getByRole('button',{name:'Conhecer CRM na prática'}).click();

  // Guided tour step 1: lead creation.
  const tour = page.getByTestId('crm-tour');
  await tour.getByRole('heading',{name:'Cadastre um lead'}).waitFor();
  await shot('06-tour-cadastrar-lead');
  await page.getByLabel('Nome',{exact:true}).fill('Cliente Demonstração QA');
  await page.getByLabel('E-mail',{exact:true}).fill('cliente-demo-qa@example.test');
  await page.getByRole('button',{name:'Cadastrar lead'}).click();
  await page.getByText('Cliente Demonstração QA').first().waitFor({timeout:15000});
  await shot('07-lead-cadastrado');

  // Step 2: opportunity linked to canonical lead record.
  await tour.getByRole('button',{name:'Próxima etapa'}).click();
  await tour.getByRole('heading',{name:'Crie uma oportunidade'}).waitFor();
  const party = page.getByLabel('Lead ou cliente');
  await party.selectOption({label:'Cliente Demonstração QA'});
  await page.getByLabel('Nome da oportunidade').fill('Implantação ArtiSys QA');
  await page.getByLabel('Estimativa (R$)').fill('1200,00');
  await shot('08-nova-oportunidade');
  await page.getByRole('button',{name:'Adicionar',exact:true}).click();
  await page.getByTestId('crm-opportunity-detail').waitFor({state:'visible'});
  await page.getByText('Implantação ArtiSys QA').first().waitFor();

  // Step 3: show movement through the real Kanban with canonical stage updates.
  await tour.getByRole('button',{name:'Próxima etapa'}).click();
  await tour.getByRole('heading',{name:'Acompanhe o funil'}).waitFor();
  await shot('09-kanban-contato');
  await page.getByLabel('Mover oportunidade').selectOption('QUALIFIED');
  await page.getByLabel('Mover oportunidade').selectOption('PROPOSAL');
  await page.getByText('Implantação ArtiSys QA').first().waitFor();
  await shot('10-kanban-proposta');

  // Proposal created using the existing domain workflow (no mock billing).
  await page.getByPlaceholder('Produto ou serviço').fill('Implantação e treinamento QA');
  await page.getByLabel('Valor unitário').fill('1200,00');
  await page.getByRole('button',{name:'Criar proposta'}).click();
  await pause(600);
  await shot('11-proposta-comercial');
  await tour.getByRole('button',{name:'Próxima etapa'}).click();
  await tour.getByRole('heading',{name:'Prepare uma proposta'}).waitFor();
  await shot('12-tour-propostas');

  // Step 5: advance the deal to WON and explicitly approve receivables.
  await tour.getByRole('button',{name:'Próxima etapa'}).click();
  await tour.getByRole('heading',{name:'Confirme os recebíveis'}).waitFor();
  await page.getByTestId('crm-opportunity-detail').waitFor({state:'visible'});
  await shot('13-tour-recebiveis');
  await page.getByLabel('Mover oportunidade').selectOption('WON');
  await page.getByText('Venda ganha. Nenhum recebível é criado sem sua confirmação.').waitFor();
  await shot('14-kanban-ganho');
  await page.getByRole('button',{name:'Converter lead em cliente'}).click();
  await page.getByText('Cliente vinculado ao Financeiro.').waitFor();
  await shot('15-cliente-convertido');
  await page.getByLabel('Parcelas').selectOption('2');
  await page.getByRole('button',{name:'Visualizar recebíveis'}).click();
  await page.getByText('Prévia, sem lançamento financeiro').waitFor();
  await shot('16-previa-sem-baixa');
  await page.getByRole('button',{name:'Confirmar e criar 2 recebível(is)'}).click();
  await page.getByText('2 parcela(s) vinculada(s) ao Financeiro.').waitFor();
  await shot('17-recebiveis-canonicos');
  await tour.getByRole('button',{name:'Concluir tour'}).click();
  await tour.waitFor({state:'hidden'});
  await shot('18-crm-tour-concluido');

  // Show final canonical customer registry and return to the CRM.
  await page.getByTestId('nav-registry').click();
  await page.getByText('Cliente Demonstração QA').first().waitFor({timeout:15000});
  await shot('19-cliente-nos-cadastros');
  await page.getByTestId('nav-crm').click();
  await page.getByRole('tab',{name:'Funil',exact:true}).waitFor();
  await shot('20-kanban-final');
  if (errors.length) throw new Error('Electron renderer errors: ' + errors.join('; '));
  fs.writeFileSync(path.join(target,'qa-result.json'),JSON.stringify({
    status:'passed',synthetic:true,runner:process.platform,
    scenarios:['first-use','account','opening-balance','first-entry','crm-tour-5-steps','lead','kanban','quote','conversion','billing-confirmation','canonical-customer'],
    screenshots:20,video:path.basename(videoPath)
  },null,2));
  console.log('QA_ONBOARDING_CRM_VIDEO_PASSED');
} catch(error) {
  fail = error;
  fs.writeFileSync(path.join(target,'qa-result.json'),JSON.stringify({
    status:'failed',synthetic:true,error:String(error),pageErrors:errors
  },null,2));
  console.error('QA_ONBOARDING_CRM_VIDEO_FAILED',error);
} finally {
  if (app) await app.close().catch(e => console.error('Electron shutdown:',e));
  if (video) {
    try { await video.saveAs(videoPath); console.log('QA_VIDEO_SAVED ' + videoPath); }
    catch(e) { fail ||= e; console.error('Failed to save video:',e); }
  }
  terminate(vite);
}
if (fail) process.exitCode = 1;
