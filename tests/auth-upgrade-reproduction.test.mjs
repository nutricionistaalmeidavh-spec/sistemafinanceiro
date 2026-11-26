import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { DatabaseService }=require('../electron/services/database.cjs');
const { createAuthService }=require('../electron/services/auth-service.cjs');

test('v13 -> v14 SQLite upgrade and process restart: old session rejected, existing credentials preserved',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finance-auth-upgrade-'));
  const dataDir=path.join(root,'profile'), oldMigrations=path.join(root,'migrations13');
  const migrationsDir=path.resolve('database/migrations');
  fs.mkdirSync(oldMigrations);
  for(const name of fs.readdirSync(migrationsDir)){
    const version=Number(name.match(/^\d+/)?.[0]);
    if(version>0&&version<=13)fs.copyFileSync(path.join(migrationsDir,name),path.join(oldMigrations,name));
  }
  let service;
  try {
    service=new DatabaseService({dataDir,migrationsDir:oldMigrations});
    service.open();
    assert.equal(service.health().userVersion,13);
    const password='Qa-Existing-Password-2026';
    const auth=createAuthService({db:service.connection()});
    auth.bootstrapAdmin({password,name:'QA Migration'});
    const previous=auth.authenticate('admin',password);
    const before=service.connection().prepare("SELECT password_hash,password_salt,active FROM users WHERE login='admin'").get();
    service.close();
    service=new DatabaseService({dataDir,migrationsDir});
    service.open();
    assert.equal(service.health().userVersion,14);
    const after=service.connection().prepare("SELECT password_hash,password_salt,active FROM users WHERE login='admin'").get();
    assert.deepEqual(after,before);
    const restarted=createAuthService({db:service.connection()});
    assert.equal(restarted.needsBootstrap(),false);
    assert.throws(()=>restarted.session(previous.token),/authentication required/);
    assert.equal(restarted.authenticate('admin',password).user.id,previous.user.id);
    assert.throws(()=>restarted.authenticate('admin','Wrong-password-2026'),/invalid login or password/);
    console.log('AUTH_UPGRADE_V13_V14: old session rejected; same password accepted; credentials unchanged');
  } finally { service?.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
