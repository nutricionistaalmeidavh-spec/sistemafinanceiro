import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createUpdateService}=require('../electron/services/update-service.cjs');
function fixture(){
  const handlers=new Map();
  let downloads=0,installs=0;
  const updater=new EventEmitter();
  updater.checkForUpdates=async()=>{updater.emit('checking-for-update');updater.emit('update-available',{version:'0.1.4',releaseNotes:'Novidades'});};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:60});updater.emit('update-downloaded',{version:'0.1.4'});};
  updater.quitAndInstall=()=>{installs++;};
  const service=createUpdateService({ipcMain:{handle:(id,cb)=>handlers.set(id,cb)},app:{isPackaged:true,getVersion:()=> '0.1.3'},
    BrowserWindow:{getAllWindows:()=>[]},updater,platform:'win32'});
  return {handlers,service,counts:()=>({downloads,installs})};
}
test('verificar nova release nao baixa nem instala automaticamente',async()=>{
  const f=fixture();
  await f.handlers.get('updates:check')();
  assert.equal(f.service.status().state,'available');
  assert.equal(f.service.status().availableVersion,'0.1.4');
  assert.equal(f.counts().downloads,0);
  assert.equal(f.counts().installs,0);
  await f.handlers.get('updates:download')();
  assert.equal(f.service.status().state,'downloaded');
  f.handlers.get('updates:install')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.counts().downloads,1);
  assert.equal(f.counts().installs,1);
});
test('instalar antes de baixar e proibido',()=>{
  const f=fixture();
  assert.throws(()=>f.handlers.get('updates:install')(),/não foi baixada/i);
});
test('updater fica desativado em aplicacoes nao empacotadas',async()=>{
  const handlers=new Map();
  const service=createUpdateService({ipcMain:{handle:(id,cb)=>handlers.set(id,cb)},app:{isPackaged:false,getVersion:()=> '0.1.3'},
    BrowserWindow:{getAllWindows:()=>[]},updater:new EventEmitter(),platform:'win32'});
  assert.equal(service.status().state,'disabled');
  await handlers.get('updates:check')();
  assert.equal(service.status().state,'disabled');
});
