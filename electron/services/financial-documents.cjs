'use strict';

const Docx = require('docx');
const { createCanvas } = require('@napi-rs/canvas');
const MAX_ROWS = 5000;
const COLOR = '#44359A';
const fmt = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money = value => {
  if (!Number.isSafeInteger(value)) throw new TypeError('amountCents deve ser inteiro seguro');
  return fmt.format(value / 100);
};
const safe = value => String(value ?? '').slice(0,2000);
const escapeHtml = value => safe(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const cell = value => new Docx.TableCell({children:[new Docx.Paragraph({text:safe(value)})]});
const table = (headers, rows) => new Docx.Table({rows:[headers,...rows].map(row=>new Docx.TableRow({children:row.map(cell)}))});
function graphPng(values) {
  if (!Array.isArray(values)||values.length>30||!values.length)throw new RangeError('gráfico exige entre 1 e 30 pontos');
  const canvas = createCanvas(920,360),ctx = canvas.getContext('2d');
  ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,920,360);
  ctx.fillStyle='#1F2937';ctx.font='bold 19px Arial';ctx.fillText('Comparativo financeiro',35,36);
  const bounds=values.map(v=>Math.abs(v.cents));
  if(bounds.some(x=>!Number.isSafeInteger(x)))throw new TypeError('valor gráfico inválido');
  const max=Math.max(1,...bounds);
  const baseline=282;
  const left=50,available=830;
  const width=Math.min(94,(available/values.length)*0.59);
  ctx.strokeStyle='#D1D5DB';ctx.beginPath();ctx.moveTo(40,baseline);ctx.lineTo(900,baseline);ctx.stroke();
  for(let i=0;i<values.length;i++){
    const point=values[i];
    const x=left+(available/values.length)*i+((available/values.length)-width)/2;
    const h=Math.min(206, (Math.abs(point.cents)/max)*206);
    ctx.fillStyle=point.cents<0?'#CE7957':COLOR;
    ctx.fillRect(x,baseline-h,width,h);
    ctx.fillStyle='#374151';ctx.font='13px Arial';
    ctx.fillText(safe(point.label).slice(0,14),x,310,Math.max(76,width));
    ctx.font='11px Arial';ctx.fillText(money(point.cents),x,baseline-h-7,Math.max(85,width+15));
  }
  return canvas.toBuffer('image/png');
}
const paragraph = text => new Docx.Paragraph({text});
function makeWord(title,info,headers,rows,chart) {
  if(rows.length>MAX_ROWS)throw new RangeError('DOCX limitado a 5 mil linhas');
  const children=[
    new Docx.Paragraph({text:'ArtiSys Financeiro',heading:Docx.HeadingLevel.TITLE}),
    new Docx.Paragraph({text:title,heading:Docx.HeadingLevel.HEADING_1}),
    ...info.map(paragraph),
    new Docx.Paragraph({children:[new Docx.ImageRun({data:chart,type:'png',transformation:{width:620,height:243}})]}),
    table(headers,rows),
  ];
  return Docx.Packer.toBuffer(new Docx.Document({sections:[{children}]}));
}
function html(title,info,headers,rows,png){
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>'+
    '@page{size:A4;margin:15mm}body{font:12px Arial,sans-serif;color:#242236}h1{color:#44359A}'+
    'table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}'+
    'th{background:#eee}tr{break-inside:avoid}img{width:100%;max-height:260px;object-fit:contain}'+
    '</style></head><body><h1>'+escapeHtml(title)+'</h1>'+
    info.map(v=>'<p>'+escapeHtml(v)+'</p>').join('')+
    '<img alt="Gráfico financeiro" src="data:image/png;base64,'+png.toString('base64')+'">'+
    '<table><thead><tr>'+headers.map(v=>'<th>'+escapeHtml(v)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(v=>'<td>'+escapeHtml(v)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></body></html>';
}
function dreData(dre){
  if(!dre || !Array.isArray(dre.groups) || !dre.totals)throw new TypeError('DRE canônica obrigatória');
  if(dre.groups.length>MAX_ROWS)throw new RangeError('DRE excede limite');
  const headers=['Grupo','Receitas','Despesas','Resultado'];
  const rows=dre.groups.map(row=>[row.group,money(row.revenueCents),money(row.expenseCents),money(row.resultCents)]);
  rows.push(['TOTAL',money(dre.totals.revenueCents),money(dre.totals.expenseCents),money(dre.totals.resultCents)]);
  const info=['Período: '+safe(dre.from)+' até '+safe(dre.to),
    'Regime: '+(dre.basis==='realized'?'Realizado':'Competência'),
    'Receitas '+money(dre.totals.revenueCents)+' | Despesas '+money(dre.totals.expenseCents)+' | Resultado '+money(dre.totals.resultCents)];
  const chart=graphPng([
    {label:'Receitas',cents:dre.totals.revenueCents},
    {label:'Despesas',cents:-dre.totals.expenseCents},
    {label:'Resultado',cents:dre.totals.resultCents},
  ]);
  return {title:'Demonstração do Resultado (DRE)',headers,rows,info,chart};
}
function cashflowData(input){
  if(!input || !input.summary || !Array.isArray(input.movements))throw new TypeError('Fluxo de caixa canônico obrigatório');
  if(input.movements.length>MAX_ROWS)throw new RangeError('Fluxo de caixa excede limite');
  const s=input.summary;
  const headers=['Data','Direção','Tipo','Valor','Observação'];
  const rows=input.movements.map(m=>[m.occurredAt,m.direction,m.type || '',money(m.amountCents),m.note || '']);
  const info=['Saldo inicial: '+money(s.openingBalanceCents),
    'Entradas: '+money(s.inCents)+' | Saídas: '+money(s.outCents),
    'Resultado: '+money(s.netCents)+' | Saldo final: '+money(s.closingBalanceCents)];
  const chart=graphPng([{label:'Entradas',cents:s.inCents},{label:'Saídas',cents:-s.outCents},{label:'Saldo final',cents:s.closingBalanceCents}]);
  return {title:'Fluxo de caixa',headers,rows,info,chart};
}
const dreHtml = input => { const d=dreData(input);return html(d.title,d.info,d.headers,d.rows,d.chart);};
const cashflowHtml = input => { const d=cashflowData(input);return html(d.title,d.info,d.headers,d.rows,d.chart);};
const toDreDocxBuffer = input => {const d=dreData(input);return makeWord(d.title,d.info,d.headers,d.rows,d.chart);};
const toCashflowDocxBuffer = input => {const d=cashflowData(input);return makeWord(d.title,d.info,d.headers,d.rows,d.chart);};
module.exports={dreHtml,cashflowHtml,toDreDocxBuffer,toCashflowDocxBuffer,graphPng};
