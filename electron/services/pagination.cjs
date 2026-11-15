'use strict';

// The limit bounds ONE IPC response, never the number of records a user may save.
const DEFAULT_PAGE_SIZE=100;
const MAX_PAGE_SIZE=200;

function pageSize(value,defaultValue=DEFAULT_PAGE_SIZE) {
  const n=value===undefined||value===null?defaultValue:Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>MAX_PAGE_SIZE)
    throw new Error('Tamanho de página inválido (1 a '+MAX_PAGE_SIZE+')');
  return n;
}
function encodeCursor(parts,scope) {
  return Buffer.from(JSON.stringify({version:1,parts,scope}),'utf8').toString('base64url');
}
function decodeCursor(cursor,scope,length=2) {
  if(!cursor)return null;
  try{
    if(typeof cursor!=='string'||cursor.length>4096||!/^[a-zA-Z0-9_-]+$/.test(cursor))
      throw new Error('format');
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(value.version!==1||value.scope!==scope||!Array.isArray(value.parts)||value.parts.length!==length||
      value.parts.some(v=>typeof v!=='string'||v.length>500))throw new Error('shape');
    return value.parts;
  }catch{throw new Error('Cursor de paginação inválido ou incompatível com os filtros');}
}
function searchTerm(value){return String(value||'').trim().toLowerCase();}
function likeTerm(value){return '%'+searchTerm(value).replace(/[\\%_]/g,'\\$&')+'%';}
module.exports={pageSize,encodeCursor,decodeCursor,searchTerm,likeTerm,MAX_PAGE_SIZE};
