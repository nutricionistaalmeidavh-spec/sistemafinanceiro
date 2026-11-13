'use strict';
const { zipSync, unzipSync, strToU8 } = require('fflate');
const { XMLParser } = require('fast-xml-parser');
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 50000;
const MAX_COLS = 80;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const arr = value => value == null ? [] : Array.isArray(value) ? value : [value];
const decodeXml = value => String(value||'').replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
function cellXml(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return '<table:table-cell office:value-type="float" office:value="'+value+'"><text:p>'+esc(value)+'</text:p></table:table-cell>';
  }
  return '<table:table-cell office:value-type="string"><text:p>'+esc(value)+'</text:p></table:table-cell>';
}
function rowXml(row) { return '<table:table-row>'+row.map(cellXml).join('')+'</table:table-row>'; }
function toOdsBuffer({headers,rows,sheetName='Extrato'}={}){
  if(!Array.isArray(headers)||headers.length<2||headers.length>MAX_COLS||
    !Array.isArray(rows)||rows.length>MAX_ROWS||rows.some(row=>!Array.isArray(row)||row.length>MAX_COLS))throw new TypeError('tabela ODS inválida');
  const table='<table:table table:name="'+esc(sheetName)+'">'+rowXml(headers)+rows.map(rowXml).join('')+'</table:table>';
  const xml='<?xml version="1.0" encoding="UTF-8"?>'+
   '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'+
   ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'+
   ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">'+
   '<office:body><office:spreadsheet>'+table+'</office:spreadsheet></office:body></office:document-content>';
  const manifest='<?xml version="1.0" encoding="UTF-8"?>'+
   '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'+
   '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'+
   '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
   '</manifest:manifest>';
  return Buffer.from(zipSync({
    mimetype:[strToU8('application/vnd.oasis.opendocument.spreadsheet'),{level:0}],
    'content.xml':strToU8(xml),
    'META-INF/manifest.xml':strToU8(manifest),
  }));
}
function parseOdsCells(base64) {
  const raw=Buffer.from(String(base64||''),'base64');
  if(!raw.length||raw.length>MAX_BYTES||raw.subarray(0,2).toString()!=='PK')throw new TypeError('arquivo ODS inválido ou maior que 12MB');
  const files=unzipSync(new Uint8Array(raw),{filter:file=>file.name==='content.xml' && file.originalSize<=30*1024*1024});
  if(!files['content.xml'])throw new TypeError('ODS sem content.xml ou com conteúdo muito grande');
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,parseAttributeValue:false,processEntities:false});
  const content=parser.parse(Buffer.from(files['content.xml']).toString('utf8'));
  const tables=arr(content['office:document-content']?.['office:body']?.['office:spreadsheet']?.['table:table']);
  const first=tables[0]; if(!first)throw new TypeError('ODS não contém planilha');
  const rawRows=arr(first['table:table-row']);
  if(rawRows.length<2||rawRows.length>MAX_ROWS+1)throw new RangeError('ODS precisa de 1–50 mil linhas');
  const rows=rawRows.map(rawRow=>{
    const fields=arr(rawRow['table:table-cell']);
    const values=[];
    for(const field of fields){
      if(field['@_table:formula'])throw new TypeError('ODS contém fórmulas; importe apenas valores');
      let text;
      if(field['@_office:value-type']==='float')text=String(field['@_office:value']??'');
      else {
        const p=arr(field['text:p']);
        text=p.map(v=>decodeXml(typeof v==='string'?v:typeof v==='number'?String(v):typeof v==='object'?String(v['#text']||''):'')).join(' ');
      }
      const repeats=Number(field['@_table:number-columns-repeated']||1);
      if(!Number.isSafeInteger(repeats)||repeats<1||values.length+repeats>MAX_COLS)throw new RangeError('ODS excede 80 colunas');
      for(let i=0;i<repeats;i++)values.push(text);
    }
    const repeatRows=Number(rawRow['@_table:number-rows-repeated']||1);
    if(repeatRows!==1)throw new TypeError('ODS com linhas repetidas não é suportado para importação financeira');
    return values;
  });
  return {headers:rows[0].map(String),rows:rows.slice(1)};
}
function normalizeHeader(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function find(headers,mapping,key,aliases){
  const own=mapping?.[key];
  if(own){const index=headers.indexOf(own);if(index<0)throw new TypeError('coluna ODS não encontrada: '+own);return index;}
  return headers.findIndex(value=>aliases.includes(normalizeHeader(value)));
}
function parseStatementOds(dataBase64,mapping={}){
  const {headers,rows}=parseOdsCells(dataBase64);
  const date=find(headers,mapping,'date',['DATA','DATE','VENCIMENTO']);
  const description=find(headers,mapping,'description',['DESCRICAO','HISTORICO','DESCRIPTION','NAME']);
  const amount=find(headers,mapping,'amount',['VALOR','AMOUNT']);
  const debit=find(headers,mapping,'debit',['DEBITO','DEBIT']);
  const credit=find(headers,mapping,'credit',['CREDITO','CREDIT']);
  const direction=find(headers,mapping,'direction',['TIPO','DIRECAO','DIRECTION']);
  if(date<0||description<0||(amount<0&&debit<0&&credit<0))throw new TypeError('ODS exige Data, Descrição e Valor ou Débito/Crédito');
  return rows.filter(row=>row.some(v=>String(v).trim())).map((row,index)=>{
    const deb=debit>=0?row[debit]:'',cred=credit>=0?row[credit]:'';
    return {date:row[date],description:row[description],amount:amount>=0?row[amount]:deb?'-'+deb:cred,
      direction:amount>=0 && direction>=0?row[direction]:deb?'debit':'credit',externalId:'row-'+(index+1)};
  });
}
function inspectStatementOds(dataBase64){
  const {headers,rows}=parseOdsCells(dataBase64);
  return {headers,rowCount:rows.length,previewRows:rows.slice(0,5)};
}
function normalizeQifDate(value,order='AUTO'){
  const raw=String(value||'').trim();
  const parts=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if(!parts)throw new TypeError('data QIF inválida: '+raw);
  const a=Number(parts[1]),b=Number(parts[2]);
  const year=parts[3].length===2?(Number(parts[3])<70?2000+Number(parts[3]):1900+Number(parts[3])):Number(parts[3]);
  if(!['AUTO','DMY','MDY'].includes(order))throw new TypeError('formato QIF inválido');
  const resolved=order==='AUTO'?(a>12?'DMY':b>12?'MDY':'MDY'):order;
  const month=resolved==='MDY'?a:b,day=resolved==='MDY'?b:a;
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<1900||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new TypeError('data QIF inválida: '+raw);
  return [year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
}
function parseQif(content, {dateOrder='AUTO'}={}) {
  const raw=String(content||'').replace(/^\uFEFF/,'');
  if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new RangeError('QIF maior que 12MB');
  const lines=raw.split(/\r?\n/);
  if(lines.length>300000)throw new RangeError('QIF contém linhas demais');
  const rows=[];let current={};let type='';let seq=0;
  for(const line of lines){
    const trimmed=line.trim();
    if(!trimmed)continue;
    if(trimmed.startsWith('!Type:')){type=trimmed.slice(6);if(!['Bank','Cash','CCard'].includes(type))throw new TypeError('tipo de QIF não bancário: '+type);continue;}
    if(!type)throw new TypeError('QIF sem declaração !Type:Bank');
    if(trimmed==='^'){
      if(!current.date||!current.amount)throw new TypeError('transação QIF incompleta');
      rows.push({date:normalizeQifDate(current.date,dateOrder),description:current.description||current.memo||'Transação QIF',
        amount:current.amount,externalId:current.id||'qif-'+(++seq)});
      current={};if(rows.length>MAX_ROWS)throw new RangeError('QIF excede 50 mil transações');continue;
    }
    const flag=trimmed[0],v=trimmed.slice(1).trim();
    if(flag==='D')current.date=v;
    if(flag==='T')current.amount=v;
    if(flag==='P')current.description=v;
    if(flag==='M')current.memo=v;
    if(flag==='N')current.id=v;
  }
  if(Object.keys(current).length)throw new TypeError('QIF sem finalizador ^');
  return rows;
}
function inspectCnab(content){
  const raw=String(content||'').replace(/^\uFEFF/,'');
  if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new RangeError('CNAB maior que 12 MB');
  const lines=raw.split(/\r?\n/).filter(Boolean);
  if(lines.length<2||lines.length>MAX_ROWS)throw new TypeError('CNAB inválido: registros insuficientes');
  const length=lines[0].length;
  if(![240,400].includes(length)||lines.some(line=>line.length!==length))throw new TypeError('CNAB exige registros fixos de 240 ou 400 posições');
  if(!/^\d{3}$/.test(lines[0].slice(0,3)))throw new TypeError('CNAB código do banco inválido');
  if(length===240 && (lines[0][7]!=='0'||lines[lines.length-1][7]!=='9'))throw new TypeError('CNAB 240 sem header/trailer válido');
  if(length===400 && (lines[0][0]!=='0'||lines[lines.length-1][0]!=='9'))throw new TypeError('CNAB 400 sem header/trailer válido');
  return {layout:length,bankCode:lines[0].slice(0,3),records:lines.length,transactionImportSupported:false,
    note:'CNAB de cobrança/remessa/retorno exige homologação por banco e convênio; não é extrato bancário nem gera lançamentos automaticamente.'};
}
module.exports={toOdsBuffer,parseStatementOds,inspectStatementOds,parseQif,inspectCnab,normalizeQifDate};
