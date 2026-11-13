import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
test('identidade e instalador sao unicos e o ponto de entrada exige licença',()=>{
  assert.equal(pkg.main,'electron/main.cjs');
  assert.equal(pkg.build.appId,'br.com.artisys.sistemafinanceiro.trial');
  assert.equal(pkg.build.nsis.guid,undefined,'o NSIS deve derivar o GUID da identidade do instalador legado');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,undefined,'não apagar dados do usuário no upgrade');
  assert.equal(pkg.build.productName,'ArtiSys Financeiro');
  assert.ok(pkg.build.win.artifactName.startsWith('ArtiSys-Financeiro-Setup-'));
  assert.equal(pkg.build.publish[0].provider,'github');
  assert.ok(pkg.build.files.every(item=>!String(item).includes('trial')));
  const main=fs.readFileSync('electron/main.cjs','utf8');
  assert.match(main,/createLicenseService/);
  assert.match(main,/license\.requireActive\(\)/);
  assert.match(main,/ipcMain:licensedIpc/);
  assert.match(main,/createUpdateService/);
  assert.match(fs.readFileSync('electron/preload.cjs','utf8'),/license:activate/);
});
test('um unico workflow de publicacao com gatilho explicito e protegido',()=>{
  const files=fs.readdirSync('.github/workflows').filter(name=>name.endsWith('.yml'));
  const publishing=files.filter(name=>fs.readFileSync('.github/workflows/'+name,'utf8').includes('gh release create'));
  assert.deepEqual(publishing,['financeiro-release.yml']);
  const wf=fs.readFileSync('.github/workflows/financeiro-release.yml','utf8');
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/github\.event_name == 'workflow_dispatch'/);
  assert.match(wf,/latest\.yml/);
});
test('QA nao abre bypass num aplicativo instalado',()=>{
  assert.match(fs.readFileSync('electron/main.cjs','utf8'),/ARTISYS_QA === '1' && !app\.isPackaged/);
  assert.match(fs.readFileSync('scripts/ci-capture-final-screens.mjs','utf8'),/usePackagedApp = false/);
});
