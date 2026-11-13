#!/usr/bin/env node
'use strict';
// Produz o pacote trial em um workspace de build; o repositorio continua comercial por padrao.
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);
const index=args.indexOf('--package');
if(index!==-1&&!args[index+1]) throw new Error('Missing --package argument');
const file=path.resolve(index<0?'package.json':args[index+1]);
const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
if(pkg.main!=='electron/main.cjs'||pkg.build?.appId!=='br.com.artisys.sistemafinanceiro'){
 throw new Error('Unexpected commercial identity; aborting trial packaging');
}
pkg.main='electron/trial-main.cjs';
pkg.build.appId='br.com.artisys.sistemafinanceiro.trial';
pkg.build.productName='ArtiSys Financeiro - Avaliacao';
pkg.build.win.artifactName='ArtiSys-Financeiro-Avaliacao-Setup-${version}.${ext}';
pkg.build.files=pkg.build.files.filter(x=>!String(x).startsWith('!electron/trial-')&&!String(x).startsWith('!electron/services/trial-')&&x!=='!electron/services/license-service.cjs');
fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
console.log('TRIAL_PACKAGE_READY '+pkg.build.appId);
