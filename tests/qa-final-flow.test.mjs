import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('artisys-qa.config.json','utf8'));
const flow = JSON.parse(fs.readFileSync('qa/flows/final-screens.json','utf8'));

test('final QA runs the real Electron app with isolated fixture', () => {
  assert.equal(config.mode, 'electron');
  assert.equal(config.defaultEnvironment, 'final');
  assert.equal(config.environments.final.env.ARTISYS_QA, '1');
  assert.equal(config.environments.final.env.ARTISYS_QA_RESET, '1');
  assert.equal(config.environments.final.startCommand, 'npm run dev');
  assert.equal(config.environments.final.readyUrl, 'http://127.0.0.1:5173');
  assert.equal(config.flows['final-screens'], 'qa/flows/final-screens.json');
});

test('final screenshot flow captures every delivered product screen', () => {
  const names = flow.steps.filter((step)=>step.action==='screenshot').map((step)=>step.name);
  assert.deepEqual(names, [
    '01-dashboard-final',
    '02-fluxo-caixa-final',
    '03-pagar-receber-final',
    '04-dre-final',
    '05-recorrencias-final',
    '06-cadastros-final',
    '07-alertas-final',
    '08-relatorios-final',
    '09-sistema-lan-final',
    '10-acessos-final',
    '11-extratos-final',
    '12-workspace-final',
  ]);
});
