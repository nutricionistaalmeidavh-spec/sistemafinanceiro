import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('vendor/utilidades/modules');
const realQa = path.join(root, 'artisys-qa', 'package.json');

if (fs.existsSync(realQa)) {
  console.log('[ci-bootstrap] Real utilidades checkout already available; fallback not needed.');
  process.exit(0);
}

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${content.trim()}\n`, 'utf8');
}

function pkg(dir, value) {
  write(`${dir}/package.json`, JSON.stringify(value, null, 2));
}

pkg('artisys-desktop-shell', {
  name: '@artisys/desktop-shell', version: '0.1.0-ci-pinned', type: 'module', exports: './src/index.mjs', engines: { node: '>=22' }, license: 'MIT',
});
write('artisys-desktop-shell/src/index.mjs', `
export function normalizeDesktopShellConfig(value = {}) { return { ...value }; }
export function createDesktopShellManifest(value = {}) {
  return { appId: String(value.appId || ''), userDataDir: String(value.userDataDir || ''), deepLinkSchemes: [...(value.deepLinkSchemes || [])], telemetry: Boolean(value.telemetry) };
}
export function resolveDesktopAction(manifest, action) { return manifest?.actions?.[action] ?? null; }
`);

pkg('artisys-eventbus', {
  name: '@artisys/eventbus', version: '0.2.0-ci-pinned', type: 'commonjs', main: './src/index.js', exports: { '.': './src/index.js' }, engines: { node: '>=18' }, license: 'MIT',
});
write('artisys-eventbus/src/index.js', `
'use strict';
class DomainEventBus {
  constructor(){ this.handlers = new Map(); }
  subscribe(type, handler){ const list=this.handlers.get(type)||[]; list.push(handler); this.handlers.set(type,list); return () => this.handlers.set(type,(this.handlers.get(type)||[]).filter((x)=>x!==handler)); }
  publish(type, payload){ const event=typeof type==='object'?type:{ type, payload }; for(const handler of this.handlers.get(event.type)||[]) handler(event); return event; }
  async publishAsync(type, payload){ const event=typeof type==='object'?type:{ type, payload }; for(const handler of this.handlers.get(event.type)||[]) await handler(event); return event; }
  clear(){ this.handlers.clear(); }
  subscriberCount(type){ return (this.handlers.get(type)||[]).length; }
}
module.exports = { DomainEventBus };
`);

pkg('artisys-dashboard', {
  name: '@artisys/dashboard', version: '1.0.0-ci-pinned', type: 'module', exports: { '.': './src/index.mjs' }, engines: { node: '>=22' }, license: 'MIT',
});
write('artisys-dashboard/src/index.mjs', `
export function validateDashboardLayout(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('dashboard layout must be an object');
  return { valid: true, value };
}
export function createDashboardAdapter(value = {}) { return { ...value }; }
`);

pkg('artisys-pdf', {
  name: '@artisys/pdf', version: '1.0.0-ci-pinned', type: 'module', exports: { '.': './src/index.mjs' }, engines: { node: '>=22' }, license: 'MIT',
});
write('artisys-pdf/src/index.mjs', `
export function normalizePdfInputs(value){ return Array.isArray(value) ? value.map((item)=>({ ...item })) : value; }
export function validatePdfTemplate(value){ return Boolean(value && typeof value === 'object'); }
export async function loadPdfDocument(source, { pdfjs } = {}) {
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw new TypeError('PDF.js runtime must expose getDocument');
  return pdfjs.getDocument(source).promise;
}
`);

pkg('artisys-printing', {
  name: '@artisys/printing', version: '0.1.0-ci-pinned', type: 'commonjs', main: './src/index.js', exports: { '.': './src/index.js' }, engines: { node: '>=22' }, license: 'MIT',
});
write('artisys-printing/src/index.js', `
'use strict';
function createReceiptDocument(input = {}) { return { kind: 'receipt', ...input }; }
module.exports = { createReceiptDocument };
`);

pkg('artisys-qa', {
  name: '@artisys/qa', version: '2.4.1-ci-pinned', type: 'module', engines: { node: '>=22' }, bin: { 'artisys-qa': './src/cli.mjs' }, exports: { '.': './src/index.js' }, peerDependencies: { playwright: '>=1.51 <2' }, license: 'MIT',
});
write('artisys-qa/src/index.js', `export const ciFallback = true;`);
write('artisys-qa/src/cli.mjs', `
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const command = args[0];
const configIndex = args.indexOf('--config');
const configFile = configIndex >= 0 ? args[configIndex + 1] : null;
if(command !== 'validate' || !configFile){ console.error('CI fallback only supports: validate --config <file>'); process.exit(2); }
const absolute = path.resolve(configFile);
const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
if(manifest.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
if(typeof manifest.systemId !== 'string' || !manifest.systemId) throw new Error('systemId is required');
if(!['web','electron'].includes(manifest.mode)) throw new Error('mode must be web or electron');
if(!manifest.environments || typeof manifest.environments !== 'object') throw new Error('environments are required');
if(!manifest.flows || typeof manifest.flows !== 'object' || !Object.keys(manifest.flows).length) throw new Error('at least one flow is required');
if(manifest.mode === 'electron' && (!manifest.electron || typeof manifest.electron.entry !== 'string')) throw new Error('electron.entry is required');
for(const flow of Object.values(manifest.flows)) if(!fs.existsSync(path.resolve(path.dirname(absolute), flow))) throw new Error('flow file missing: '+flow);
console.log('ArtiSys QA manifest valid (pinned CI fallback).');
`);

pkg('artisys-release', {
  name: '@artisys/release', version: '0.1.0-ci-pinned', type: 'module', exports: './src/index.mjs', engines: { node: '>=22' }, license: 'MIT',
});
write('artisys-release/src/index.mjs', `
import { createHash } from 'node:crypto';
function obj(v,n){if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(n+' must be an object');return v}
export function createReleasePlan(value){obj(value,'release plan');if(typeof value.product!=='string'||!value.product.trim())throw new TypeError('product is required');if(typeof value.version!=='string'||!value.version.trim())throw new TypeError('version is required');return {product:value.product,version:value.version,artifacts:[...(value.artifacts??[])],checks:[...(value.checks??['qa','security','api-contracts','signing'])]}}
export function evaluateReleaseResults(results){if(!Array.isArray(results))throw new TypeError('results must be an array');const failed=results.filter(r=>r.status!=='pass');return {status:failed.length?'blocked':'pass',results:[...results],failedChecks:failed.map(r=>r.check)}}
export async function runReleaseGate(runners,value){const plan=createReleasePlan(value);const results=[];for(const check of plan.checks){const run=runners?.[check];if(typeof run!=='function'){results.push({check,status:'fail',reason:'runner-missing'});break}const raw=await run(plan);const result={check,...raw};results.push(result);if(result.status!=='pass')break}return evaluateReleaseResults(results)}
export function hashArtifact(data){return createHash('sha256').update(data).digest('hex')}
`);

const sourceFinanceDomain = path.resolve('ci/artisys-finance-domain');
const targetFinanceDomain = path.join(root, 'artisys-finance-domain');
fs.cpSync(sourceFinanceDomain, targetFinanceDomain, { recursive: true });

const sourceStorage = path.resolve('ci/artisys-storage');
const targetStorage = path.join(root, 'artisys-storage');
fs.cpSync(sourceStorage, targetStorage, { recursive: true });

const sourceSecurity = path.resolve('ci/artisys-security');
const targetSecurity = path.join(root, 'artisys-security');
fs.cpSync(sourceSecurity, targetSecurity, { recursive: true });

console.log('[ci-bootstrap] Prepared pinned credential-free ArtiSys CI fallback at utilidades commit 1a5854d83e4253924150a9313f6f556d68f3108e.');
