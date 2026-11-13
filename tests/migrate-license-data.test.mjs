import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {migrateLegacyTrialData}=require('../electron/services/migrate-license-data.cjs');

test('primeiro acesso copia banco, WAL, workspace, backups e licenca ativa sem apagar os arquivos da avaliacao',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-migrate-'));
  try{
    const old=path.join(root,'ArtiSys Financeiro - Avaliacao');
    const target=path.join(root,'ArtiSys Financeiro');
    fs.mkdirSync(old);
    const files={
      'sistema-financeiro.sqlite':'db-legacy',
      'sistema-financeiro.sqlite-wal':'wal-legacy',
      'sistema-financeiro.sqlite-shm':'shm-legacy',
      'workspace-meta.sqlite':'workspace-legacy',
      'artisys-financeiro-license.json':'signed-license-legacy',
      'artisys-financeiro-license-clock.json':'{"lastSeen":12345}',
      'workspace/contratos/contrato.txt':'documento',
      'backups/diario.sqlite':'backup'
    };
    for(const [name,value] of Object.entries(files)){
      const absolute=path.join(old,name);
      fs.mkdirSync(path.dirname(absolute),{recursive:true});
      fs.writeFileSync(absolute,value);
    }
    const app={getPath:key=>key==='appData'?root:target};
    assert.deepEqual(migrateLegacyTrialData({app,fs,path,platform:'win32'}),{migrated:true,reason:'copied'});
    for(const [name,value] of Object.entries(files)){
      assert.equal(fs.readFileSync(path.join(old,name),'utf8'),value,`origem preservada: ${name}`);
      assert.equal(fs.readFileSync(path.join(target,name),'utf8'),value,`destino migrado: ${name}`);
    }
    assert.equal(migrateLegacyTrialData({app,fs,path,platform:'win32'}).reason,'canonical-data-exists');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('nao sobrescreve banco canonico preexistente nem mistura perfil de licenca legado',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-migrate-'));
  try{
    const old=path.join(root,'ArtiSys Financeiro - Avaliacao');
    const target=path.join(root,'ArtiSys Financeiro');
    fs.mkdirSync(old);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(old,'sistema-financeiro.sqlite'),'db-old');
    fs.writeFileSync(path.join(old,'artisys-financeiro-license.json'),'license-old');
    fs.writeFileSync(path.join(target,'sistema-financeiro.sqlite'),'db-current');
    const app={getPath:key=>key==='appData'?root:target};
    assert.equal(migrateLegacyTrialData({app,fs,path,platform:'win32'}).reason,'canonical-data-exists');
    assert.equal(fs.readFileSync(path.join(target,'sistema-financeiro.sqlite'),'utf8'),'db-current');
    assert.equal(fs.existsSync(path.join(target,'artisys-financeiro-license.json')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('chave publica do app continua correspondente a avaliacao 0.1.0 ja ativada',()=>{
  const publicKey=fs.readFileSync('electron/services/license-public.pem','utf8').replace(/\r\n/g,'\n');
  assert.equal(publicKey.trim(),[
    '-----BEGIN PUBLIC KEY-----',
    'MCowBQYDK2VwAyEABzQASNFMzVcOKDon0JtxQq/wID7Ii+NlXBHruSqkNcg=',
    '-----END PUBLIC KEY-----'
  ].join('\n'));
});
