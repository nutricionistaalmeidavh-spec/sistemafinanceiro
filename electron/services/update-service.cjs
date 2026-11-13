'use strict';

// O mesmo canal "latest" atende todas as licenças. Download e instalação exigem clique do usuário.
function createUpdateService({ipcMain,app,BrowserWindow,updater,platform=process.platform}){
  const enabled=Boolean(updater&&app.isPackaged&&platform==='win32');
  let state={state:enabled?'idle':'disabled',currentVersion:app.getVersion()};
  let checking=false;
  let downloading=false;
  const snapshot=()=>({...state});
  function report(next){
    state={...state,...next};
    for(const window of BrowserWindow.getAllWindows()){
      if(!window.isDestroyed())window.webContents.send('updates:status-changed',snapshot());
    }
    return snapshot();
  }
  if(enabled){
    updater.autoDownload=false;
    updater.autoInstallOnAppQuit=false;
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.channel='latest';
    updater.on('checking-for-update',()=>report({state:'checking',message:undefined}));
    updater.on('update-available',(info)=>report({
      state:'available',availableVersion:info.version,
      releaseNotes:typeof info.releaseNotes==='string'?info.releaseNotes.slice(0,800):undefined,
      message:undefined
    }));
    updater.on('update-not-available',()=>report({state:'up-to-date',message:undefined}));
    updater.on('download-progress',(progress)=>report({state:'downloading',percent:Math.min(100,Math.max(0,Math.round(progress.percent||0)))}));
    updater.on('update-downloaded',(info)=>report({state:'downloaded',availableVersion:info.version,percent:100,message:undefined}));
    updater.on('error',(err)=>report({state:'error',message:err?.message||'Falha ao consultar atualização.'}));
  }
  async function check(manual=false){
    if(!enabled)return snapshot();
    if(checking||downloading||state.state==='downloaded')return snapshot();
    checking=true;
    report({state:'checking',message:undefined});
    try{await updater.checkForUpdates();}
    catch(error){
      if(manual)report({state:'error',message:'Não foi possível verificar atualizações. Confira sua conexão.'});
      else report({state:'idle',message:undefined});
      console.error('[updates] Verificação indisponível:',error?.message||error);
    }finally{checking=false;}
    return snapshot();
  }
  async function download(){
    if(!enabled||state.state!=='available'||downloading)throw new Error('Nenhuma atualização disponível para baixar.');
    downloading=true;
    report({state:'downloading',percent:0,message:undefined});
    try{await updater.downloadUpdate();}
    catch(error){
      report({state:'error',message:'Falha no download da atualização. Tente novamente.'});
      throw error;
    }finally{downloading=false;}
    return snapshot();
  }
  function install(){
    if(!enabled||state.state!=='downloaded')throw new Error('A atualização ainda não foi baixada e validada.');
    // Electron Builder verifica SHA-512 do instalador segundo latest.yml antes de liberar este estado.
    setImmediate(()=>updater.quitAndInstall(false,true));
  }
  ipcMain.handle('updates:status',()=>snapshot());
  ipcMain.handle('updates:check',()=>check(true));
  ipcMain.handle('updates:download',()=>download());
  ipcMain.handle('updates:install',()=>install());
  return {start(){if(enabled)setImmediate(()=>void check(false));},status:snapshot,check,download,install};
}
module.exports={createUpdateService};
