import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url),'utf8');

test('QA onboarding is isolated to an unpackaged Electron fixture and skips pre-seeding',()=>{
 const main = read('electron/main.cjs');
 const fixture = read('electron/services/qa-fixture-service.cjs');
 assert.match(main,/qaMode = process\.env\.ARTISYS_QA === '1' && !app\.isPackaged/);
 assert.match(main,/onboardingOnly:process\.env\.ARTISYS_QA_ONBOARDING === '1'/);
 assert.match(fixture,/if \(onboardingOnly\) return \{ seeded: false/);
 assert.ok(fixture.indexOf('if (onboardingOnly)') < fixture.indexOf('  withTransaction(db, () => {'));
});

test('real CRM video captures first-use, Kanban, client and explicitly confirmed receivables',()=>{
 const video = read('scripts/qa-tour-video.mjs');
 for (const contract of [
  "recordVideo:{dir:target",
  "ARTISYS_QA:'1'",
  "ARTISYS_QA_RESET:'1'",
  "ARTISYS_QA_ONBOARDING:'1'",
  "Configuração passo a passo",
  "Conhecer CRM na prática",
  "Cadastre um lead",
  "Crie uma oportunidade",
  "Acompanhe o funil",
  "Prepare uma proposta",
  "Confirme os recebíveis",
  "Cadastrar lead",
  "Mover oportunidade",
  "Criar proposta",
  "Converter lead em cliente",
  "Prévia, sem lançamento financeiro",
  "Confirmar e criar 2 recebível(is)",
  "Cliente Demonstração QA",
  "await video.saveAs(videoPath)"
 ]) assert.ok(video.includes(contract),'missing QA video scene: '+contract);
});

test('GitHub Actions stores WebM, screenshots, and pass/fail report even if QA fails',()=>{
 const workflow = read('.github/workflows/qa-tour-video.yml');
 assert.match(workflow,/pull_request:/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/npm run ci:bootstrap/);
 assert.match(workflow,/node scripts\/qa-tour-video\.mjs/);
 assert.match(workflow,/qa-artifacts\/crm\/video\/\*\*\/\*/);
 assert.match(workflow,/if: always\(\)/);
});
