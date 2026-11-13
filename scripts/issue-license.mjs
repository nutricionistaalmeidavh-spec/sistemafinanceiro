#!/usr/bin/env node
// Emissão totalmente local: a chave privada jamais sai do computador do emissor.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,randomInt,sign,createPrivateKey,createPublicKey,verify,scryptSync,createCipheriv,createHash} from 'node:crypto';
const args=process.argv.slice(2);
const arg=(name,fallback='')=>{const i=args.indexOf(name);return i>=0?args[i+1]||'':fallback;};
const privatePath=arg('--private-key');
const customer=arg('--customer');
const type=arg('--type','TRIAL').toUpperCase();
const days=Number(arg('--days','14'));
const outCode=arg('--out-code');
const catalogFile=path.resolve(arg('--catalog','licenses/catalog.json'));
const knownKey=path.resolve('electron/services/license-public.pem');
const root=process.cwd();
if(!privatePath||!customer.trim()||customer.trim().length>150||!outCode||!['TRIAL','TERM','PERPETUAL'].includes(type)||
  (type!=='PERPETUAL'&&(!Number.isInteger(days)||days<1||(type==='TRIAL'&&days>14)))){
  console.error('Uso: node scripts/issue-license.mjs --private-key /seguro/issuer-private.pem --customer "Nome" --type TRIAL|TERM|PERPETUAL --days 14 --out-code /seguro/codigo.txt [--catalog licenses/catalog.json]');
  process.exit(2);
}
const keyPath=path.resolve(privatePath);
const codePath=path.resolve(outCode);
if(keyPath===root||keyPath.startsWith(root+path.sep))throw new Error('A chave privada deve ficar fora do repositório.');
if(codePath===root||codePath.startsWith(root+path.sep))throw new Error('O código do cliente deve ficar fora do repositório.');
const privateKey=createPrivateKey(fs.readFileSync(keyPath,'utf8'));
if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('A chave privada precisa ser Ed25519.');
const publicKey=fs.readFileSync(knownKey,'utf8');
const probe=randomBytes(32);
if(!verify(null,probe,publicKey,sign(null,probe,privateKey)))throw new Error('Chave privada não corresponde à chave pública do aplicativo.');
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const raw=Array.from({length:16},()=>alphabet[randomInt(alphabet.length)]).join('');
const readable=raw.match(/.{4}/g).join('-');
const now=new Date();
const payload={
  product:'artisys-financeiro',licenseId:'LICENSE-'+randomUUID(),customer:customer.trim(),
  issuedAt:now.toISOString(),
  ...(type==='PERPETUAL'?{}:{expiresAt:new Date(now.getTime()+days*86400000).toISOString()}),
  type
};
const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
const signed=Buffer.from(JSON.stringify({payload,signature})).toString('base64url');
const salt=randomBytes(24),iv=randomBytes(12);
const key=scryptSync(raw,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
const cipher=createCipheriv('aes-256-gcm',key,iv);
const ciphertext=Buffer.concat([cipher.update(signed,'utf8'),cipher.final()]);
const bundle={
  version:1,kdf:'scrypt',cipher:'aes-256-gcm',product:'artisys-financeiro',
  salt:salt.toString('base64url'),iv:iv.toString('base64url'),
  tag:cipher.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')
};
const catalog=fs.existsSync(catalogFile)?JSON.parse(fs.readFileSync(catalogFile,'utf8')):{version:1,product:'artisys-financeiro',entries:{}};
if(catalog.version!==1||catalog.product!=='artisys-financeiro'||!catalog.entries||typeof catalog.entries!=='object')throw new Error('Catálogo incompatível.');
const fingerprint=createHash('sha256').update(raw).digest('hex');
if(catalog.entries[fingerprint])throw new Error('Colisão de código; execute novamente.');
fs.mkdirSync(path.dirname(codePath),{recursive:true});
fs.writeFileSync(codePath,readable+'\n',{flag:'wx',mode:0o600});
catalog.entries[fingerprint]=bundle;
fs.mkdirSync(path.dirname(catalogFile),{recursive:true});
fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');
console.log('Código:',readable);
console.log('Cliente:',customer.trim());
console.log('Tipo:',type);
console.log('Validade:',payload.expiresAt||'permanente');
console.log('Código salvo em:',codePath);
console.log('Catálogo atualizado:',catalogFile);
console.log('Publique APENAS o catálogo no GitHub (branch main). Não é necessário gerar novo instalador.');
