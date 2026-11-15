import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('release v0.1.7 publica o instalador unico com notas corretas sem sobrescrever v0.1.6',()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const workflow=fs.readFileSync(new URL('../.github/workflows/financeiro-release.yml',import.meta.url),'utf8');
 const notes=fs.readFileSync(new URL('../docs/releases/financeiro-v0.1.7.md',import.meta.url),'utf8');
 assert.equal(pkg.version,'0.1.7');
 assert.equal(pkg.build.appId,'br.com.artisys.sistemafinanceiro.trial');
 assert.equal(pkg.build.productName,'ArtiSys Financeiro');
 assert.equal(pkg.build.win.artifactName,'ArtiSys-Financeiro-Setup-${version}.${ext}');
 assert.match(notes,/0\.1\.7/);
 assert.match(notes,/paginação|paginacao/i);
 assert.match(notes,/migra[cç][ãa]o|SQLite/i);
 assert.match(workflow,/\[publish-finance-017\]/);
 assert.match(workflow,/docs\/releases\/financeiro-v0\.1\.7\.md/);
 assert.match(workflow,/gh release create \$tag/);
 assert.match(workflow,/Release existente: \$tag/);
 assert.match(workflow,/latest\.yml/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
});
