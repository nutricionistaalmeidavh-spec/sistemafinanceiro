'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, verify } = require('node:crypto');
const PRODUCT = 'artisys-financeiro';
const DAY_MS = 86_400_000;
const CLOCK_TOLERANCE_MS = 5 * 60_000;

function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive:true, mode:0o700 });
  const tmp = filePath + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, text, { flag:'wx', mode:0o600 });
    fs.renameSync(tmp, filePath);
  } finally {
    try { fs.rmSync(tmp, { force:true }); } catch {}
  }
}
function parseIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toISOString() === value ? date : NaN;
}
function decodeLicense(code, publicKey) {
  if (typeof code !== 'string' || code.length < 30 || code.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(code.trim())) throw new Error('Código de licença inválido.');
  let envelope;
  try { envelope=JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8')); }
  catch { throw new Error('Código de licença inválido.'); }
  if (!envelope || typeof envelope !== 'object' || !envelope.payload || typeof envelope.signature !== 'string') throw new Error('Código de licença inválido.');
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object' || payload.product !== PRODUCT) throw new Error('Licença destinada a outro produto.');
  if (payload.type !== 'TRIAL') throw new Error('Tipo de licença inválido.');
  if (typeof payload.licenseId !== 'string' || !/^[A-Za-z0-9_-]{4,100}$/.test(payload.licenseId)) throw new Error('ID da licença inválido.');
  if (typeof payload.customer !== 'string' || payload.customer.trim().length < 2 || payload.customer.length > 150) throw new Error('Cliente da licença inválido.');
  const issued = parseIso(payload.issuedAt);
  const expires = parseIso(payload.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) throw new Error('Datas da licença inválidas.');
  if (expires - issued > 14 * DAY_MS) throw new Error('Avaliação não pode exceder 14 dias.');
  let valid = false;
  try { valid=verify(null, Buffer.from(JSON.stringify(payload)), publicKey, Buffer.from(envelope.signature, 'base64url')); } catch {}
  if (!valid) throw new Error('Assinatura da licença inválida.');
  return { payload, issued, expires };
}
function createLicenseService({ dataDir, publicKey, now = Date.now }) {
  if (!dataDir || !publicKey) throw new TypeError('dataDir e publicKey são obrigatórios');
  const filePath = path.join(dataDir, 'artisys-financeiro-license.json');
  const clockPath = path.join(dataDir, 'artisys-financeiro-license-clock.json');
  const blocked = (reason, message) => ({ active:false, reason, message, mode:'trial' });
  function status() {
    if (!fs.existsSync(filePath)) return blocked('missing', 'Ative a licença de avaliação para continuar.');
    let license;
    try { license=decodeLicense(fs.readFileSync(filePath,'utf8'),publicKey); }
    catch (cause) { return blocked('invalid',cause.message || 'Licença inválida.'); }
    const nowMs = Number(now());
    const {payload,issued,expires} = license;
    if (!Number.isFinite(nowMs)) return blocked('clock_invalid','Data do sistema inválida.');
    if (nowMs + CLOCK_TOLERANCE_MS < issued) return blocked('not_started','Licença ainda não está válida. Verifique a data do computador.');
    let lastSeen = 0;
    try {
      if (fs.existsSync(clockPath)) {
        const parsed = JSON.parse(fs.readFileSync(clockPath,'utf8'));
        if (!Number.isFinite(parsed.lastSeen) || parsed.lastSeen < 0) throw new Error('Registro de relógio inválido');
        lastSeen = parsed.lastSeen;
      }
    } catch { return blocked('clock_invalid','Registro de relógio indisponível. Contate o suporte.'); }
    if (lastSeen && nowMs + CLOCK_TOLERANCE_MS < lastSeen) return blocked('clock_rollback','Relógio do computador foi retrocedido. Corrija a data e hora.');
    if (nowMs >= expires) return blocked('expired','Licença de avaliação expirada.');
    if (nowMs > lastSeen + 60_000) {
      try { atomicWrite(clockPath,JSON.stringify({lastSeen:nowMs})); }
      catch { return blocked('clock_invalid','Não foi possível registrar a data da licença.'); }
    }
    return { active:true, reason:'active', mode:'trial', type:'TRIAL', licenseId:payload.licenseId, customer:payload.customer, expiresAt:payload.expiresAt, daysRemaining:Math.ceil((expires-nowMs)/DAY_MS) };
  }
  function activate(code) {
    const license = decodeLicense(String(code || '').trim(), publicKey);
    const nowMs = Number(now());
    if (nowMs + CLOCK_TOLERANCE_MS < license.issued) throw new Error('Licença ainda não está válida. Verifique a data do computador.');
    if (nowMs >= license.expires) throw new Error('Licença de avaliação expirada.');
    atomicWrite(filePath,code.trim());
    const result=status();
    if (!result.active) throw new Error(result.message);
    return result;
  }
  function requireActive() {
    const state=status();
    if (!state.active) throw new Error(state.message || 'Licença necessária.');
    return state;
  }
  return { status,activate,requireActive };
}
module.exports = { createLicenseService,decodeLicense,PRODUCT };
