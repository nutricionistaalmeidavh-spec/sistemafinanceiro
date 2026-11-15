// Synthetic-only Finance UI performance benchmark. Never runs in a packaged Electron build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { summarizeRenderInteraction } from './qa-render-metrics.mjs';

const rows=Number(process.env.ARTISYS_QA_LEDGER_ROWS);
if(![100,1000,10000].includes(rows))throw new Error('ARTISYS_QA_LEDGER_ROWS must be 100, 1000 or 10000');
const root=process.cwd();
const viteCli=path.resolve('node_modules/vite/bin/vite.js');
const electronExe=path.resolve(process.platform==='win32'?'node_modules/electron/dist/electron.exe':'node_modules/electron/dist/electron');
const credential='Qa-'+randomBytes(18).toString('hex');
if(!fs.existsSync(viteCli)||!fs.existsSync(electronExe))throw new Error('Install local Vite and Electron dependencies first');

function stop(child){
  if(!child||child.exitCode!==null)return;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
  else child.kill('SIGTERM');
}
async function ready(){
  for(let i=0;i<120;i++){
    try{const res=await fetch('http://127.0.0.1:5173');if(res.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Vite failed to start');
}
const vite=spawn(process.execPath,[viteCli,'--host','127.0.0.1'],{cwd:root,stdio:'ignore',shell:false});
let app;
try{
  await ready();
  app=await electron.launch({
    executablePath:electronExe,args:[path.resolve('electron/main.cjs')],cwd:root,
    env:{...process.env,ARTISYS_QA:'1',ARTISYS_QA_RESET:'1',ARTISYS_QA_LEDGER_ROWS:String(rows),ARTISYS_QA_PASSWORD:credential,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'},
    timeout:90000
  });
  const page=await app.firstWindow();
  await page.setViewportSize({width:1440,height:900}).catch(()=>{});
  await page.getByLabel('Usuário').fill('admin');
  await page.getByLabel('Senha').fill(credential);
  await page.getByRole('button',{name:'Entrar'}).click();
  await page.getByTestId('app-shell').waitFor();
  await page.evaluate(()=>{window.__ARTISYS_RENDER_STATS={};window.__ARTISYS_FINANCE_IPC_STATS={};});
  async function snapshot(){
    return page.evaluate(()=>({render:window.__ARTISYS_RENDER_STATS?.finance || {},
      table:window.__ARTISYS_RENDER_STATS?.['finance-table'] || {},ipc:{...(window.__ARTISYS_FINANCE_IPC_STATS||{})}}));
  }
  const measures=[];
  async function measure(interaction,action){
    const before=await snapshot(), start=performance.now();
    await action();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await snapshot(), elapsed=performance.now()-start;
    const result=summarizeRenderInteraction(interaction,before,after,elapsed);
    result.table=summarizeRenderInteraction(interaction,{render:before.table},{render:after.table},elapsed);
    measures.push(result);
  }
  const visible=page.locator('[data-testid="page-finance"] .table-panel tbody tr');
  await measure('finance-volume-open',async()=>{
    await page.getByTestId('nav-finance').click();
    await page.getByText('QA Perf 00000').first().waitFor({timeout:45000});
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="page-finance"] .table-panel tbody tr').length===100,{timeout:45000});
  });
  assert.equal(await visible.count(),100,'first screen displays exactly 100 canonical rows');
  await measure('finance-volume-search',async()=>{
    await page.getByTestId('finance-search').fill('QA Perf 00042');
    await page.getByText('QA Perf 00042').first().waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="page-finance"] .table-panel tbody tr').length===1);
  });
  assert.equal(await visible.count(),1);
  await measure('finance-volume-reset',async()=>{
    await page.getByTestId('finance-search').fill('');
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="page-finance"] .table-panel tbody tr').length===100);
  });
  await measure('finance-volume-status',async()=>{
    await page.getByLabel('Filtrar status').selectOption('PARTIAL');
    await page.getByText('Serviços terceirizados').first().waitFor();
  });
  await measure('finance-volume-status-reset',async()=>{
    await page.getByLabel('Filtrar status').selectOption('ALL');
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="page-finance"] .table-panel tbody tr').length===100);
  });
  const report={synthetic:true,environment:'unpackaged-windows-electron-dev',rows,visibleLimit:100,measures};
  const dir=path.resolve('qa-artifacts/render-volume');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'react-finance-'+rows+'.json'),JSON.stringify(report,null,2));
  console.log('REACT_RENDER_VOLUME_OK '+JSON.stringify(report));
}finally{
  if(app)await app.close().catch(()=>{});
  stop(vite);
}
