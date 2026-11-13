'use strict';

// A edição antiga de avaliação tinha outro productName e diretório userData.
// Não apaga nem altera a origem; evita substituição quando o perfil unificado já tem banco.
function migrateLegacyTrialData({app,fs,path,platform=process.platform}){
  if(platform!=='win32')return {migrated:false,reason:'other-platform'};
  const target=app.getPath('userData');
  const existing=path.join(target,'sistema-financeiro.sqlite');
  if(fs.existsSync(existing))return {migrated:false,reason:'canonical-data-exists'};
  const legacy=path.join(app.getPath('appData'),'ArtiSys Financeiro - Avaliacao');
  if(legacy===target||!fs.existsSync(path.join(legacy,'sistema-financeiro.sqlite')))return {migrated:false,reason:'no-legacy-data'};
  const candidates=['sistema-financeiro.sqlite','sistema-financeiro.sqlite-wal','sistema-financeiro.sqlite-shm','workspace-meta.sqlite','workspace-meta.sqlite-wal','workspace-meta.sqlite-shm','artisys-financeiro-license.json','artisys-financeiro-license-clock.json','workspace','backups'];
  fs.mkdirSync(target,{recursive:true});
  for(const name of candidates){
    const from=path.join(legacy,name),to=path.join(target,name);
    if(fs.existsSync(from)&&!fs.existsSync(to))fs.cpSync(from,to,{recursive:true,errorOnExist:true,force:false});
  }
  return {migrated:true,reason:'copied'};
}
module.exports={migrateLegacyTrialData};
