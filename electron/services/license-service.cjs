'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,verify,scryptSync,createDecipheriv,createHash}=require('node:crypto');

const PRODUCT='artisys-financeiro';
const DAY_MS=86_400_000;
const CLOCK_TOLERANCE_MS=5*60_000;
const CATALOG_URL='https://raw.githubusercontent.com/nutricionistaalmeidavh-spec/sistemafinanceiro/main/licenses/catalog.json';
const CODE_PATTERN=/^[A-HJ-NP-Z2-9]{12}(?:[A-HJ-NP-Z2-9]{4})?$/;

function atomicWrite(filePath,text){
  fs.mkdirSync(path.dirname(filePath),{recursive:true,mode:0o700});
  const tmp=filePath+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});fs.renameSync(tmp,filePath);}
  finally{try{fs.rmSync(tmp,{force:true});}catch{}}
}
function parseIso(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))return NaN;
  const date=Date.parse(value);
  return Number.isFinite(date)&&new Date(date).toISOString()===value?date:NaN;
}
function normalizeCode(input){return String(input||'').toUpperCase().trim().replace(/[-\s]/g,'');}
function licenseFingerprint(code){return createHash('sha256').update(normalizeCode(code)).digest('hex');}
function decodeLicense(code,publicKey){
  if(typeof code!=='string'||code.length<30||code.length>8192||!/^[A-Za-z0-9_-]+$/.test(code.trim()))throw new Error('Código de licença inválido.');
  let envelope;
  try{envelope=JSON.parse(Buffer.from(code.trim(),'base64url').toString('utf8'));}catch{throw new Error('Código de licença inválido.');}
  if(!envelope||typeof envelope!=='object'||!envelope.payload||typeof envelope.signature!=='string')throw new Error('Código de licença inválido.');
  const payload=envelope.payload;
  if(!payload||typeof payload!=='object'||payload.product!==PRODUCT)throw new Error('Licença destinada a outro produto.');
  if(!['TRIAL','TERM','PERPETUAL'].includes(payload.type))throw new Error('Tipo de licença inválido.');
  if(typeof payload.licenseId!=='string'||!/^[A-Za-z0-9_-]{4,100}$/.test(payload.licenseId))throw new Error('ID da licença inválido.');
  if(typeof payload.customer!=='string'||payload.customer.trim().length<2||payload.customer.length>150)throw new Error('Cliente da licença inválido.');
  const issued=parseIso(payload.issuedAt);
  const expires=payload.type==='PERPETUAL'?Infinity:parseIso(payload.expiresAt);
  if(!Number.isFinite(issued)||(!Number.isFinite(expires)&&payload.type!=='PERPETUAL')||expires<=issued)throw new Error('Datas da licença inválidas.');
  if(payload.type==='TRIAL'&&expires-issued>14*DAY_MS)throw new Error('Avaliação não pode exceder 14 dias.');
  if(payload.type==='PERPETUAL'&&payload.expiresAt!==undefined)throw new Error('Licença permanente não deve ter vencimento.');
  let valid=false;
  try{valid=verify(null,Buffer.from(JSON.stringify(payload)),publicKey,Buffer.from(envelope.signature,'base64url'));}catch{}
  if(!valid)throw new Error('Assinatura da licença inválida.');
  return {payload,issued,expires};
}
function unlockSealedTrial(shortCode,sealedTrial){
  const fail=()=>new Error('Código de ativação inválido.');
  const normalized=normalizeCode(shortCode);
  if(!CODE_PATTERN.test(normalized))throw fail();
  if(!sealedTrial||sealedTrial.version!==1||sealedTrial.kdf!=='scrypt'||sealedTrial.cipher!=='aes-256-gcm'||sealedTrial.product!==PRODUCT)throw fail();
  try{
    const salt=Buffer.from(sealedTrial.salt,'base64url');
    const iv=Buffer.from(sealedTrial.iv,'base64url');
    const tag=Buffer.from(sealedTrial.tag,'base64url');
    const encrypted=Buffer.from(sealedTrial.ciphertext,'base64url');
    if(salt.length!==24||iv.length!==12||tag.length!==16||encrypted.length<30||encrypted.length>2048)throw fail();
    const key=scryptSync(normalized,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
    const decipher=createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
  }catch{throw fail();}
}
function createLicenseService({dataDir,publicKey,now=Date.now,sealedTrial=null,catalogUrl=CATALOG_URL,fetchImpl=globalThis.fetch}){
  if(!dataDir||!publicKey)throw new TypeError('dataDir e publicKey são obrigatórios');
  const filePath=path.join(dataDir,'artisys-financeiro-license.json');
  const clockPath=path.join(dataDir,'artisys-financeiro-license-clock.json');
  const blocked=(reason,message)=>({active:false,reason,message,mode:'licensed'});
  function status(){
    if(!fs.existsSync(filePath))return blocked('missing','Informe seu código de licença para continuar.');
    let license;
    try{license=decodeLicense(fs.readFileSync(filePath,'utf8'),publicKey);}
    catch(cause){return blocked('invalid',cause.message||'Licença inválida.');}
    const nowMs=Number(now());
    const {payload,issued,expires}=license;
    if(!Number.isFinite(nowMs))return blocked('clock_invalid','Data do sistema inválida.');
    if(nowMs+CLOCK_TOLERANCE_MS<issued)return blocked('not_started','Licença ainda não está válida. Verifique a data do computador.');
    let lastSeen=0;
    try{
      if(fs.existsSync(clockPath)){
        const parsed=JSON.parse(fs.readFileSync(clockPath,'utf8'));
        if(!Number.isFinite(parsed.lastSeen)||parsed.lastSeen<0)throw new Error('Registro de relógio inválido');
        lastSeen=parsed.lastSeen;
      }
    }catch{return blocked('clock_invalid','Registro de relógio indisponível. Contate o suporte.');}
    if(lastSeen&&nowMs+CLOCK_TOLERANCE_MS<lastSeen)return blocked('clock_rollback','Relógio do computador foi retrocedido. Corrija a data e hora.');
    if(nowMs>=expires)return blocked('expired','Licença expirada.');
    if(nowMs>lastSeen+60_000){
      try{atomicWrite(clockPath,JSON.stringify({lastSeen:nowMs}));}
      catch{return blocked('clock_invalid','Não foi possível registrar a data da licença.');}
    }
    return {
      active:true,reason:'active',mode:'licensed',type:payload.type,licenseId:payload.licenseId,customer:payload.customer,
      ...(Number.isFinite(expires)?{expiresAt:payload.expiresAt,daysRemaining:Math.ceil((expires-nowMs)/DAY_MS)}:{})
    };
  }
  function activate(code){
    const input=String(code||'').trim();
    const signed=input.length<=32?unlockSealedTrial(input,sealedTrial):input;
    const license=decodeLicense(signed,publicKey);
    const nowMs=Number(now());
    if(!Number.isFinite(nowMs)||nowMs+CLOCK_TOLERANCE_MS<license.issued)throw new Error('Licença ainda não está válida. Verifique a data do computador.');
    if(nowMs>=license.expires)throw new Error('Licença expirada.');
    const previous=fs.existsSync(filePath)?fs.readFileSync(filePath,'utf8'):null;
    atomicWrite(filePath,signed);
    const result=status();
    if(!result.active){
      if(previous!==null)atomicWrite(filePath,previous);
      else fs.rmSync(filePath,{force:true});
      throw new Error(result.message);
    }
    return result;
  }
  async function activateFromCatalog(code){
    const normalized=normalizeCode(code);
    if(!CODE_PATTERN.test(normalized))throw new Error('Código de ativação inválido. Use 12 ou 16 caracteres.');
    // Licenças antigas já ativadas continuam funcionando offline; bundle legado é opcional.
    if(sealedTrial&&normalized.length===12){try{return activate(normalized);}catch{}}
    if(typeof fetchImpl!=='function')throw new Error('Conecte-se à internet para ativar este código.');
    let response;
    try{response=await fetchImpl(catalogUrl+'?t='+encodeURIComponent(String(now())),{
      method:'GET',headers:{'Accept':'application/json'},cache:'no-store',
      signal:AbortSignal.timeout(10000)
    });}
    catch{throw new Error('Não foi possível consultar as licenças. Verifique a conexão e tente novamente.');}
    if(!response.ok)throw new Error('Catálogo de ativações indisponível. Tente novamente.');
    let catalog;
    try{
      const raw=await response.text();
      if(raw.length>2_000_000)throw new Error('oversize');
      catalog=JSON.parse(raw);
    }catch{throw new Error('Catálogo de ativações inválido.');}
    if(!catalog||catalog.version!==1||catalog.product!==PRODUCT||!catalog.entries||typeof catalog.entries!=='object'||Array.isArray(catalog.entries))throw new Error('Catálogo de ativações inválido.');
    const bundle=catalog.entries[licenseFingerprint(normalized)];
    if(!bundle)throw new Error('Código não encontrado. Verifique o código recebido.');
    return activate(unlockSealedTrial(normalized,bundle));
  }
  function requireActive(){
    const state=status();
    if(!state.active)throw new Error(state.message||'Licença necessária.');
    return state;
  }
  return {status,activate,activateFromCatalog,requireActive};
}
module.exports={createLicenseService,decodeLicense,unlockSealedTrial,licenseFingerprint,normalizeCode,PRODUCT,CATALOG_URL};
