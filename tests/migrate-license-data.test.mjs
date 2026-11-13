import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {migrateLegacyTrialData}=require('../electron/services/migrate-license-data.cjs');
test('copia banco e licenca antigos sem apagar origem nem sobrescrever dados canonicos',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-migrate-'));
  try{
    const old=path.join(root,'ArtiSys Financeiro - Avaliacao');
    const target=path.join(root,'ArtiSys Financeiro');
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old,'sistema-financeiro.sqlite'),'db-legacy');
    fs.writeFileSync(path.join(old,'artisys-financeiro-license.json'),'license');
    const app={getPath:key=>key==='appData'?root:target};
    assert.equal(migrateLegacyTrialData({app,fs,path,platform:'win32'}).migrated,true);
    assert.equal(fs.readFileSync(path.join(target,'sistema-financeiro.sqlite'),'utf8'),'db-legacy');
    assert.equal(fs.readFileSync(path.join(target,'artisys-financeiro-license.json'),'utf8'),'license');
    assert.ok(fs.existsSync(path.join(old,'sistema-financeiro.sqlite')));
    assert.equal(migrateLegacyTrialData({app,fs,path,platform:'win32'}).reason,'canonical-data-exists');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
