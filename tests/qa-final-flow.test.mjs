import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('artisys-qa.config.json', 'utf8'));
const flow = JSON.parse(fs.readFileSync('qa/flows/final-screens.json', 'utf8'));
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const workflow = fs.readFileSync('.github/workflows/qa-all-screens.yml', 'utf8');
const captures = flow.steps.filter(step => step.action === 'screenshot').map(step => step.name);

test('QA uses the real Electron application and isolated fictional data', () => {
  assert.equal(config.mode, 'electron');
  assert.equal(config.defaultEnvironment, 'final');
  assert.equal(config.environments.final.env.ARTISYS_QA, '1');
  assert.equal(config.environments.final.env.ARTISYS_QA_RESET, '1');
  assert.equal(config.flows['final-screens'], 'qa/flows/final-screens.json');
});

test('captura login, todas as telas do menu e todas as subabas de cadastro e planejamento', () => {
  const navigations = [...appSource.matchAll(/\bnav\('([^']+)'/g)].map(match => match[1]);
  assert.equal(new Set(navigations).size, 13, 'revisar cobertura quando o menu mudar');
  assert.equal(captures[0], '00-login-final');
  assert.deepEqual(captures, [
    '00-login-final',
    '01-dashboard-final',
    '02-fluxo-caixa-final',
    '03-pagar-receber-final',
    '04-dre-final',
    '05-recorrencias-final',
    '06-cadastros-final',
    '06a-cadastros-credores-final',
    '06b-cadastros-categorias-final',
    '07-alertas-final',
    '08-relatorios-final',
    '09-sistema-lan-final',
    '10-acessos-final',
    '11-extratos-final',
    '12-workspace-final',
    '13-planejamento-centros-final',
    '14-planejamento-orcamento-final',
    '15-planejamento-cenarios-final',
    '16-planejamento-aprovacoes-final',
    '17-planejamento-projecoes-final',
  ]);
  for (const id of navigations.filter(name => name !== 'dashboard')) {
    assert.ok(flow.steps.some(step => step.action === 'click' && step.testId === `nav-${id}`), `Sem navegação para ${id}`);
  }
  for (const title of ['Credores', 'Categorias', 'Orçamento e metas', 'Cenários', 'Aprovações e lote', 'Projeções']) {
    assert.ok(flow.steps.some(step => step.action === 'click' && step.role === 'button' && step.name === title), `Subtela ausente: ${title}`);
  }
});

test('workflow testa no Windows e publica evidências mesmo se houver falha', () => {
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /npm run ci:bootstrap/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run ci:qa-final/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.doesNotMatch(workflow, /gh release create|npm run dist:package/);
});

test('capturador falha caso alguma tela não seja registrada e preserva screenshot da falha', () => {
  const source = fs.readFileSync('scripts/ci-capture-final-screens.mjs', 'utf8');
  assert.match(source, /flow\.steps\.filter\(.*screenshot/);
  assert.match(source, /FINAL_SCREENSHOTS_OK/);
  assert.match(source, /failure\.png/);
  assert.match(source, /run-summary\.json/);
});
