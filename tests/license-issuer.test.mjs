import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createLicenseService,licenseFingerprint}=require('../electron/services/license-service.cjs');
const DAY=86400000;
function fixture(type,days=14){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-license-'));
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const privateFile=path.join(dir,'private.pem'),publicFile=path.join(dir,'public.pem');
  const outputFile=path.join(dir,'code.txt'),catalogFile=path.join(dir,'catalog.json');
  fs.writeFileSync(privateFile,privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  fs.writeFileSync(publicFile,publicKey.export({format:'pem',type:'spki'}));
  const result=spawnSync(process.execPath,[
    'scripts/issue-license.mjs','--private-key',privateFile,'--public-key',publicFile,
    '--customer','Cliente QA','--type',type,'--days',String(days),
    '--out-code',outputFile,'--catalog',catalogFile
  ],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const code=fs.readFileSync(outputFile,'utf8').trim();
  const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  const clock={now:Date.now()};
  const service=createLicenseService({
    dataDir:path.join(dir,'userData'),publicKey,now:()=>clock.now,
    fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(catalog)})
  });
  return {dir,code,catalog,clock,service,publicKey};
}
test('emite codigo curto de 16 caracteres sem precisar recompilar o instalador',async()=>{
  const f=fixture('TRIAL',14);
  try{
    assert.match(f.code,/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.equal(f.service.status().active,false);
    const state=await f.service.activateFromCatalog(f.code);
    assert.equal(state.active,true);
    assert.equal(state.type,'TRIAL');
    assert.ok(state.daysRemaining>=13&&state.daysRemaining<=14);
    const offline=createLicenseService({dataDir:path.join(f.dir,'userData'),publicKey:f.publicKey});
    assert.equal(offline.status().active,true);
    assert.ok(f.catalog.entries[licenseFingerprint(f.code)]);
    assert.ok(!JSON.stringify(f.catalog).includes('Cliente QA'));
    assert.ok(!JSON.stringify(f.catalog).includes(f.code));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('licencas com prazo maior e permanente ativam no mesmo aplicativo',async()=>{
  for(const [type,days] of [['TERM',365],['PERPETUAL',0]]){
    const f=fixture(type,days);
    try{
      const state=await f.service.activateFromCatalog(f.code);
      assert.equal(state.type,type);
      if(type==='PERPETUAL'){
        assert.equal(state.expiresAt,undefined);
        f.clock.now+=365*DAY;
        assert.equal(f.service.status().active,true);
      }else{
        assert.ok(state.daysRemaining>=364);
        f.clock.now+=366*DAY;
        assert.equal(f.service.status().reason,'expired');
      }
    }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
  }
});
test('codigo desconhecido e catalogo alterado nao ativam',async()=>{
  const f=fixture('TRIAL',14);
  try{
    await assert.rejects(f.service.activateFromCatalog('AAAA-BBBB-CCCC-DDDD'),/não encontrado/i);
    const key=licenseFingerprint(f.code);
    const bundle=f.catalog.entries[key];
    bundle.tag=(bundle.tag.startsWith('A')?'B':'A')+bundle.tag.slice(1);
    await assert.rejects(f.service.activateFromCatalog(f.code),/inválido/i);
    assert.equal(f.service.status().active,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('emissor recusa chave privada incompatível com app',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-issuer-'));
  try{
    const {privateKey}=generateKeyPairSync('ed25519'),{publicKey}=generateKeyPairSync('ed25519');
    const priv=path.join(dir,'private.pem'),pub=path.join(dir,'public.pem');
    fs.writeFileSync(priv,privateKey.export({format:'pem',type:'pkcs8'}));
    fs.writeFileSync(pub,publicKey.export({format:'pem',type:'spki'}));
    const result=spawnSync(process.execPath,['scripts/issue-license.mjs','--private-key',priv,'--public-key',pub,'--customer','QA',
      '--out-code',path.join(dir,'code.txt'),'--catalog',path.join(dir,'catalog.json')],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/não corresponde/i);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
