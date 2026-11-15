import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('release historica v0.1.7 preserva documentacao e identidade do aplicativo',()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const notes=fs.readFileSync(new URL('../docs/releases/financeiro-v0.1.7.md',import.meta.url),'utf8');
 assert.match(notes,/0\.1\.7/);
 assert.match(notes,/paginação|paginacao/i);
 assert.match(notes,/migra[cç][ãa]o|SQLite/i);
 assert.equal(pkg.build.appId,'br.com.artisys.sistemafinanceiro.trial');
 assert.equal(pkg.build.productName,'ArtiSys Financeiro');
 assert.equal(pkg.build.win.artifactName,'ArtiSys-Financeiro-Setup-${version}.${ext}');
});
