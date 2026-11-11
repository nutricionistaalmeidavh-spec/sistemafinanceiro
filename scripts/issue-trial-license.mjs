import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, sign, createPrivateKey } from 'node:crypto';

const args = process.argv.slice(2);
const value = (flag, fallback='') => { const at=args.indexOf(flag); return at>=0 ? args[at+1]||'' : fallback; };
const keyFile=value('--private-key');
const customer=value('--customer');
const days=Number(value('--days','14'));
const out=value('--out');
if (!keyFile || !customer.trim() || !out || !Number.isInteger(days) || days<1 || days>14) {
  console.error('Uso: node scripts/issue-trial-license.mjs --private-key /caminho/issuer-private.pem --customer "Cliente" --days 14 --out /caminho/licenca.txt');
  process.exit(2);
}
const key=createPrivateKey(fs.readFileSync(keyFile,'utf8'));
if (key.asymmetricKeyType!=='ed25519') throw new Error('Chave privada Ed25519 obrigatória');
const now = new Date();
const payload = {
  product:'artisys-financeiro',
  licenseId:'TRIAL-'+randomUUID(),
  customer:customer.trim(),
  issuedAt:now.toISOString(),
  expiresAt:new Date(now.getTime()+days*86400000).toISOString(),
  type:'TRIAL'
};
const signature=sign(null,Buffer.from(JSON.stringify(payload)),key).toString('base64url');
const code=Buffer.from(JSON.stringify({payload,signature})).toString('base64url');
fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
fs.writeFileSync(out, code+'\n', {mode:0o600,flag:'wx'});
console.log('Licença:', payload.licenseId, 'Cliente:', payload.customer, 'Validade:', payload.expiresAt);
console.log('Salvo em:',path.resolve(out));
