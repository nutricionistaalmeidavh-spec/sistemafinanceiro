import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('vendor/utilidades/modules/artisys-ocr');
const packageFile = path.join(root, 'package.json');
if (fs.existsSync(packageFile)) {
  console.log('[ci-bootstrap-ocr] Real/fallback OCR package already available.');
  process.exit(0);
}

fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(packageFile, `${JSON.stringify({
  name: '@artisys/ocr',
  version: '0.1.0-ci-pinned',
  type: 'module',
  exports: './src/index.mjs',
  engines: { node: '>=22' },
  license: 'MIT',
}, null, 2)}\n`, 'utf8');

fs.writeFileSync(path.join(root, 'src', 'index.mjs'), `
function required(value,label){const text=String(value??'').trim();if(!text)throw new TypeError(label+' is required');return text;}
export function normalizeOcrRequest(input={}){return Object.freeze({source:required(input.source,'OCR source'),language:String(input.language||'por'),mode:String(input.mode||'text'),environment:String(input.environment||'native'),prefer:input.prefer?String(input.prefer):null,preprocess:input.preprocess!==false});}
export async function executeOcr(providers={},input={}){const request=normalizeOcrRequest(input);const preferred=request.prefer&&providers[request.prefer]?request.prefer:Object.keys(providers)[0];if(!preferred)throw new Error('No OCR provider configured');const provider=providers[preferred];if(typeof provider.recognize!=='function')throw new TypeError('OCR provider must expose recognize(request)');const raw=await provider.recognize(request);return Object.freeze({provider:preferred,text:String(raw?.text??''),confidence:raw?.confidence==null?null:Number(raw.confidence),blocks:Array.isArray(raw?.blocks)?raw.blocks:[]});}
`, 'utf8');

console.log('[ci-bootstrap-ocr] Prepared credential-free @artisys/ocr fallback.');
