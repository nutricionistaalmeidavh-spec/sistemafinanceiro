import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, randomInt, sign, createPrivateKey, scryptSync, createCipheriv } from 'node:crypto';

const args=process.argv.slice(2);
const arg=(key,fallback='')=>{
  const index=args.indexOf(key);
  return index>=0 ? args[index+1]||'' : fallback;
};
const privatePath=arg('--private-key');
const customer=arg('--customer');
const days=Number(arg('--days','14'));
const outCode=arg('--out-code');
const outBundle=arg('--out-bundle');
if(!privatePath || !customer.trim() || customer.trim().length>150 || !outCode || !outBundle || !Number.isInteger(days) || days<1 || days>14) {
  console.error('Uso: node scripts/issue-trial-license.mjs --private-key /local/issuer-private.pem --customer "Cliente" --days 14 --out-code /local/ativacao.txt --out-bundle electron/services/trial-activation.bundle.json');
  process.exit(2);
}
const privateKey=createPrivateKey(fs.readFileSync(privatePath,'utf8'));
if(privateKey.asymmetricKeyType!=='ed25519') throw new Error('A chave privada precisa ser Ed25519.');
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const raw=Array.from({length:12},()=>alphabet[randomInt(0,alphabet.length)]).join('');
const shortCode=raw.match(/.{4}/g).join('-');
const now=new Date();
const payload={
  product:'artisys-financeiro',
  licenseId:'TRIAL-'+randomUUID(),
  customer:customer.trim(),
  issuedAt:now.toISOString(),
  expiresAt:new Date(now.getTime()+days*86400000).toISOString(),
  type:'TRIAL'
};
const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
const entitlement=Buffer.from(JSON.stringify({payload,signature})).toString('base64url');
const salt=randomBytes(24);
const iv=randomBytes(12);
const key=scryptSync(raw,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
const cipher=createCipheriv('aes-256-gcm',key,iv);
const ciphertext=Buffer.concat([cipher.update(entitlement,'utf8'),cipher.final()]);
const bundle={
  version:1,
  kdf:'scrypt',
  cipher:'aes-256-gcm',
  product:'artisys-financeiro',
  salt:salt.toString('base64url'),
  iv:iv.toString('base64url'),
  tag:cipher.getAuthTag().toString('base64url'),
  ciphertext:ciphertext.toString('base64url')
};
const codeFile=path.resolve(outCode);
const bundleFile=path.resolve(outBundle);
const root=process.cwd();
if(codeFile===root || codeFile.startsWith(root+path.sep)) throw new Error('Salve o código do cliente fora do repositório.');
if(codeFile===bundleFile) throw new Error('O código e o pacote devem ter arquivos diferentes.');
fs.mkdirSync(path.dirname(codeFile),{recursive:true});
fs.mkdirSync(path.dirname(bundleFile),{recursive:true});
fs.writeFileSync(codeFile,shortCode+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(bundleFile,JSON.stringify(bundle,null,2)+'\n',{mode:0o600});
console.log('Código curto:',shortCode);
console.log('Cliente:',payload.customer);
console.log('Validade:',payload.expiresAt);
console.log('Código salvo em:',codeFile);
console.log('Pacote criptografado salvo em:',bundleFile);
console.log('IMPORTANTE: recompilar o instalador para cada pacote/cliente.');
