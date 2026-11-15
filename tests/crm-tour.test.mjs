import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('a configuração inicial oferece etapa de CRM sem criar dados automaticamente',()=>{
 const guide=read('src/components/FirstUseGuide.tsx');
 assert.match(guide,/type Step=.*'crm'/);
 assert.match(guide,/setStep\(canViewCrm\?'crm':'complete'\)/);
 assert.match(guide,/onOpenCrmTour\?\.\(\)/);
 assert.match(guide,/Agora não/);
});
test('o tour navega pelas áreas reais do CRM e pode ser repetido',()=>{
 const crm=read('src/pages/CrmPage.tsx');
 for(const label of ['Cadastre um lead','Crie uma oportunidade','Acompanhe o funil','Prepare uma proposta','Confirme os recebíveis']){
  assert.ok(crm.includes(label),label);
 }
 assert.match(crm,/setTab\(crmTourSteps\[index\]\.tab\)/);
 assert.match(crm,/data-testid="crm-tour"/);
 assert.match(crm,/data-testid="crm-tour-restart"/);
});
test('o acesso ao tour é independente do primeiro lançamento e respeita a permissão CRM',()=>{
 const app=read('src/App.tsx');
 assert.match(app,/data-testid="nav-crm-tour"/);
 assert.match(app,/can\(session,'crm\.view'\)/);
 assert.match(app,/onOpenCrmTour=\{launchCrmTour\}/);
 assert.match(app,/tourActive=\{showCrmTour\}/);
});
test('ganhar venda não cria recebível sem confirmação',()=>{
 const crm=read('src/pages/CrmPage.tsx');
 assert.match(crm,/api\.crm\.confirmReceivables\(/);
 assert.match(crm,/onClick=\{\(\)=>void confirmBilling\(\)\}/);
 assert.match(crm,/Nenhum recebível é criado sem sua confirmação/);
});
