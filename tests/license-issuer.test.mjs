import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { createLicenseService }=require('../electron/services/license-service.cjs');

test('emissor local produz código curto e pacote assinado/criptografado funcional', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'financeiro-issuer-'));
  try {
    const {privateKey,publicKey}=generateKeyPairSync('ed25519');
    const issuerKey=path.join(dir,'issuer-private.pem');
    fs.writeFileSync(issuerKey,privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
    const codeFile=path.join(dir,'activation-code.txt');
    const bundleFile=path.join(dir,'trial-activation.bundle.json');
    const result=spawnSync(process.execPath,[
      'scripts/issue-trial-license.mjs','--private-key',issuerKey,
      '--customer','Cliente teste automatizado','--days','14',
      '--out-code',codeFile,'--out-bundle',bundleFile
    ],{encoding:'utf8',cwd:process.cwd()});
    assert.equal(result.status,0,result.stderr);
    const code=fs.readFileSync(codeFile,'utf8').trim();
    assert.match(code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const bundle=JSON.parse(fs.readFileSync(bundleFile,'utf8'));
    assert.equal(bundle.version,1);
    const service=createLicenseService({dataDir:path.join(dir,'userData'),publicKey,sealedTrial:bundle});
    const status=service.activate(code);
    assert.equal(status.active,true);
    assert.equal(status.customer,'Cliente teste automatizado');
    assert.ok(status.daysRemaining>=13 && status.daysRemaining<=14);
    assert.ok(!JSON.stringify(bundle).includes('Cliente teste automatizado'));
    assert.ok(!JSON.stringify(bundle).includes(code));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
