import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLicenseService } = require('../electron/services/license-service.cjs');
const DAY = 86_400_000;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'financeiro-license-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  let now = Date.parse('2026-11-11T12:00:00.000Z');
  const service = createLicenseService({ dataDir:dir, publicKey, now:()=>now });
  const payload = { product:'artisys-financeiro', licenseId:'TRIAL-0001', customer:'Cliente de teste', issuedAt:new Date(now).toISOString(), expiresAt:new Date(now+14*DAY).toISOString(), type:'TRIAL' };
  const encode = (item, key = privateKey) => Buffer.from(JSON.stringify({ payload:item, signature:sign(null, Buffer.from(JSON.stringify(item)),key).toString('base64url') })).toString('base64url');
  return {dir, service, payload, encode, setNow:(value)=>{now=value;}, current:()=>now, privateKey };
}

test('avaliação exige uma licença antes do primeiro acesso', () => {
  const {dir,service}=fixture();
  assert.equal(service.status().active,false);
  assert.throws(()=>service.requireActive(),/licença/i);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('licença assinada ativa o produto offline e persiste entre sessões', () => {
  const {dir,service,payload,encode}=fixture();
  const current=service.activate(encode(payload));
  assert.equal(current.active,true);
  assert.equal(current.customer,'Cliente de teste');
  assert.equal(current.daysRemaining,14);
  assert.doesNotThrow(()=>service.requireActive());
  assert.equal(service.status().active,true);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('licença falsificada ou produto diferente não ativa', () => {
  const {dir,service,payload,encode}=fixture();
  assert.throws(()=>service.activate(encode({...payload, customer:'outro'}).replace(/.$/,'_')),/licença|assinatura|código/i);
  assert.throws(()=>service.activate(encode({...payload,product:'outro-produto'})),/produto/i);
  assert.equal(service.status().active,false);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('licença expirada bloqueia todas as operações', () => {
  const {dir,service,payload,encode,setNow,current}=fixture();
  service.activate(encode(payload));
  setNow(current()+14*DAY+1);
  assert.equal(service.status().active,false);
  assert.equal(service.status().reason,'expired');
  assert.throws(()=>service.requireActive(),/expirada/i);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('rollback de relógio é sinalizado e não reativa a licença', () => {
  const {dir,service,payload,encode,setNow,current}=fixture();
  service.activate(encode(payload));
  setNow(current()+DAY);
  service.status();
  setNow(Date.parse('2026-11-11T12:00:00.000Z'));
  assert.equal(service.status().reason,'clock_rollback');
  assert.throws(()=>service.requireActive(),/relógio/i);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('prazo maior do que 14 dias não pode ser usado na build de avaliação', () => {
  const {dir,service,payload,encode}=fixture();
  assert.throws(()=>service.activate(encode({...payload,expiresAt:new Date(Date.parse(payload.issuedAt)+15*DAY).toISOString()})),/14 dias/i);
  fs.rmSync(dir,{recursive:true,force:true});
});
