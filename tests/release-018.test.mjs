import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('release 0.1.9 otimiza o instalador e preserva tour CRM e atualizacao por cima',()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const workflow=fs.readFileSync(new URL('../.github/workflows/financeiro-release.yml',import.meta.url),'utf8');
 const previousNotes=fs.readFileSync(new URL('../docs/releases/financeiro-v0.1.8.md',import.meta.url),'utf8');
 const notes=fs.readFileSync(new URL('../docs/releases/financeiro-v0.1.9.md',import.meta.url),'utf8');
 assert.equal(pkg.version,'0.1.9');
 assert.equal(pkg.build.appId,'br.com.artisys.sistemafinanceiro.trial');
 assert.equal(pkg.build.productName,'ArtiSys Financeiro');
 assert.equal(pkg.build.win.artifactName,'ArtiSys-Financeiro-Setup-${version}.${ext}');
 assert.match(previousNotes,/Tour guiado do CRM/i);
 assert.match(previousNotes,/paginação por cursor/i);
 assert.match(notes,/instalador otimizado/i);
 assert.match(notes,/OCR/i);
 assert.match(workflow,/\[publish-finance-019\]/);
 assert.match(workflow,/docs\/releases\/financeiro-v0\.1\.9\.md/);
 assert.match(workflow,/gh release create \$tag/);
 assert.match(workflow,/Release existente: \$tag/);
 assert.match(workflow,/latest\.yml/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
});
