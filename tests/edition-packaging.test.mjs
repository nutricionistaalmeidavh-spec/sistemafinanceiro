import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
test('instalador comercial continua com identidade historica e ponto de entrada comercial',()=>{
 assert.equal(pkg.build.appId,'br.com.artisys.sistemafinanceiro');
 assert.equal(pkg.main,'electron/main.cjs');
 assert.equal(pkg.build.productName,'ArtiSys Financeiro');
 assert.match(pkg.build.win.artifactName,/ArtiSys-Financeiro-Setup/);
});
test('pacote trial usa identidade e ponto de entrada isolados sem modificar pacote comercial',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'artisys-edition-'));
 try{
  const file=path.join(dir,'package.json');
  writeFileSync(file,JSON.stringify(pkg,null,2));
  execFileSync(process.execPath,[path.join(root,'scripts/prepare-trial-package.mjs'),'--package',file],{cwd:root});
  const result=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(result.main,'electron/trial-main.cjs');
  assert.equal(result.build.appId,'br.com.artisys.sistemafinanceiro.trial');
  assert.equal(result.build.productName,'ArtiSys Financeiro - Avaliacao');
  assert.match(result.build.win.artifactName,/Avaliacao/);
  assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).main,'electron/main.cjs');
 }finally{rmSync(dir,{force:true,recursive:true})}
});
test('workflow trial prepara pacote de avaliacao sem publicar release em push',()=>{
 const yml=readFileSync(path.join(root,'.github/workflows/trial-installer.yml'),'utf8');
 assert.match(yml,/prepare-trial-package\.mjs/);
 assert.match(yml,/if: github\.event_name == 'workflow_dispatch'/);
 const trial=readFileSync(path.join(root,'electron/trial-main.cjs'),'utf8');
 assert.match(trial,/trial-preload\.cjs/);
 assert.match(trial,/createLicenseService/);
 const commercial=readFileSync(path.join(root,'electron/main.cjs'),'utf8');
 assert.doesNotMatch(commercial,/requireActive\(/);
});
