'use strict';
const crypto = require('node:crypto');

function normalizeSourceType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!['CSV','OFX','PDF','MANUAL'].includes(type)) throw new TypeError('unsupported sourceType');
  return type;
}
function parseDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let m = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  throw new TypeError(`invalid date: ${raw}`);
}
function parseAmount(value) {
  if (Number.isInteger(value)) return { amountCents: Math.abs(value), negative: value < 0 };
  let raw = String(value ?? '').trim().replace(/\s/g,'');
  const negative = raw.startsWith('-') || /D$/i.test(raw);
  raw = raw.replace(/[A-Za-zR$+\-]/g,'');
  if (raw.includes(',') && raw.includes('.')) raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g,'').replace(',','.') : raw.replace(/,/g,'');
  else if (raw.includes(',')) raw = raw.replace(/\./g,'').replace(',','.');
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new TypeError(`invalid amount: ${value}`);
  return { amountCents: Math.round(Math.abs(number) * 100), negative };
}
function parseDelimited(content, delimiter) {
  const rows=[]; let row=[]; let field=''; let quoted=false;
  const text=String(content||'').replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"') { if(quoted && text[i+1]==='"'){field+='"';i++;} else quoted=!quoted; continue; }
    if(ch===delimiter && !quoted){row.push(field);field='';continue;}
    if((ch==='\n'||ch==='\r')&&!quoted){ if(ch==='\r'&&text[i+1]==='\n')i++; row.push(field);field=''; if(row.some(v=>v!==''))rows.push(row); row=[]; continue; }
    field+=ch;
  }
  row.push(field); if(row.some(v=>v!==''))rows.push(row); return rows;
}
function headerKey(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function pickColumn(headers, aliases){const keys=headers.map(headerKey); for(const alias of aliases){const idx=keys.indexOf(alias); if(idx>=0)return idx;} return -1;}
function parseCsv(content) {
  const first=String(content||'').split(/\r?\n/,1)[0]||'';
  const delimiter=(first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length ? ';' : ',';
  const rows=parseDelimited(content,delimiter); if(rows.length<2)return [];
  const headers=rows[0];
  const dateI=pickColumn(headers,['DATA','DATE','DTPOSTED']);
  const descI=pickColumn(headers,['DESCRICAO','DESCRICAOOPERACAO','HISTORICO','MEMO','DESCRIPTION','NAME']);
  const amountI=pickColumn(headers,['VALOR','AMOUNT','TRNAMT']);
  const debitI=pickColumn(headers,['DEBITO','DEBIT']);
  const creditI=pickColumn(headers,['CREDITO','CREDIT']);
  const typeI=pickColumn(headers,['TIPO','NATUREZA','DIRECAO','DIRECTION']);
  if(dateI<0||descI<0||(amountI<0&&debitI<0&&creditI<0)) throw new TypeError('CSV requires date, description and amount/debit/credit columns');
  return rows.slice(1).map((r,index)=>{
    if(amountI>=0)return {date:r[dateI],description:r[descI],amount:r[amountI],direction:r[typeI],externalId:`row-${index+1}`};
    if(String(r[debitI]||'').trim())return {date:r[dateI],description:r[descI],amount:`-${r[debitI]}`,direction:'debit',externalId:`row-${index+1}`};
    return {date:r[dateI],description:r[descI],amount:r[creditI],direction:'credit',externalId:`row-${index+1}`};
  });
}
function tag(block,name){const m=String(block).match(new RegExp(`<${name}>([^<\\r\\n]+)`,'i')); return m?.[1]?.trim()||'';}
function parseOfx(content) {
  const blocks=String(content||'').match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi)||[];
  return blocks.map((block,index)=>({date:tag(block,'DTPOSTED'),description:tag(block,'NAME')||tag(block,'MEMO')||'Transação OFX',amount:tag(block,'TRNAMT'),direction:tag(block,'TRNTYPE'),externalId:tag(block,'FITID')||`row-${index+1}`}));
}
function parsePdfText(text) {
  return String(text||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean).map((line,index)=>{
    const m=line.match(/^(\d{2}[\/-]\d{2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+(-?[\d.]+,\d{2}|-?\d+(?:\.\d{2}))\s*$/);
    if(!m)return null; return {date:m[1],description:m[2],amount:m[3],externalId:`line-${index+1}`};
  }).filter(Boolean);
}
function directionOf(row, parsedAmount) {
  const raw=String(row.direction||'').trim().toUpperCase();
  if(['CREDIT','CREDITO','C','IN','ENTRADA'].includes(raw))return 'credit';
  if(['DEBIT','DEBITO','D','OUT','SAIDA','CHECK','ATM'].includes(raw))return 'debit';
  return parsedAmount.negative ? 'debit' : 'credit';
}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function documentIdentity(input, sourceType, now) {
  if(sourceType!=='MANUAL'){
    if(input.dataBase64)return `${sourceType.toLowerCase()}:sha256:${sha256(Buffer.from(String(input.dataBase64),'base64'))}`;
    const raw=input.content ?? input.text;
    if(raw!=null)return `${sourceType.toLowerCase()}:sha256:${sha256(String(raw))}`;
  }
  return String(input.documentId||input.filename||`${sourceType.toLowerCase()}-${now()}`).trim();
}
async function defaultPdfTextLoader(dataBase64) {
  const [{ loadPdfDocument }, pdfjs] = await Promise.all([import('@artisys/pdf'), import('pdfjs-dist/legacy/build/pdf.mjs')]);
  const bytes = Uint8Array.from(Buffer.from(String(dataBase64 || ''), 'base64'));
  if (!bytes.length) throw new TypeError('PDF data is required');
  const doc = await loadPdfDocument({ data: bytes }, { pdfjs });
  const pages=[];
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
    const page=await doc.getPage(pageNo); const content=await page.getTextContent(); let text='';
    for(const item of content.items){ text += `${String(item.str||'')}${item.hasEOL?'\n':' '}`; }
    pages.push(text.trim());
  }
  return pages.join('\n');
}
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error){ try{db.exec('ROLLBACK');}catch{} throw error; }
}
function rowTotal(db,sql,...args){return Number(db.prepare(sql).get(...args)?.total||0);}

function createStatementImportService({ db=null, now=()=>new Date().toISOString(), idFactory=(prefix)=>`${prefix}-${crypto.randomUUID()}`, domainLoader=()=>import('@artisys/finance-domain'), pdfTextLoader=defaultPdfTextLoader }={}) {
  async function parseInput(input, sourceType) {
    if(sourceType==='CSV')return parseCsv(input.content);
    if(sourceType==='OFX')return parseOfx(input.content);
    if(sourceType==='PDF'){
      const text=input.text || (input.dataBase64 ? await pdfTextLoader(input.dataBase64) : input.content);
      return parsePdfText(text);
    }
    return Array.isArray(input.rows)?input.rows:[];
  }
  function ensureAccount(accountId){
    if(!db)return;
    const row=db.prepare('SELECT id FROM financial_accounts WHERE id=? AND active=1').get(accountId);
    if(!row)throw new Error('financial account not found or inactive');
  }
  async function preview(input={}) {
    const sourceType=normalizeSourceType(input.sourceType); const accountId=String(input.accountId||'').trim(); if(!accountId)throw new TypeError('accountId is required');
    ensureAccount(accountId);
    const documentId=documentIdentity(input,sourceType,now);
    const rows=await parseInput(input,sourceType);
    const domain=await domainLoader(); const rules=Array.isArray(input.rules)?input.rules:domain.BASIC_PT_BR_FINANCE_RULES;
    const transactions=rows.map((row,index)=>{
      const parsed=row.amountCents!=null?{amountCents:Math.abs(Number(row.amountCents)),negative:Number(row.amountCents)<0}:parseAmount(row.amount);
      if(!Number.isInteger(parsed.amountCents)||parsed.amountCents<=0)throw new TypeError('transaction amount must be greater than zero');
      const tx={ id:`preview-${index+1}`, accountId, date:parseDate(row.date), description:String(row.description||'').trim(), amountCents:parsed.amountCents, direction:directionOf(row,parsed), counterparty:String(row.counterparty||row.description||'').trim() };
      if(!tx.description)throw new TypeError('transaction description is required');
      tx.normalized=domain.normalizeText(tx.description);
      const decision=domain.applyDeterministicRules(tx,rules);
      if(decision.matched)Object.assign(tx,decision.assignments);
      tx.classification=decision;
      tx.sourceFingerprint=domain.sourceFingerprint(tx,{source:sourceType.toLowerCase(),documentId,externalId:row.externalId||'',rowIndex:index});
      tx.businessFingerprint=domain.businessFingerprint(tx);
      return tx;
    });
    let existing=[];
    if(db)existing=db.prepare('SELECT source_fingerprint AS sourceFingerprint FROM bank_transactions').all();
    const deduped=domain.dedupeBySourceFingerprint(existing,transactions);
    return {sourceType,documentId,transactions:deduped.accepted,duplicates:deduped.duplicates,summary:{parsed:transactions.length,accepted:deduped.accepted.length,duplicates:deduped.duplicates.length,classified:deduped.accepted.filter(t=>t.classification?.matched).length,needsReview:deduped.accepted.filter(t=>!t.classification?.matched).length}};
  }
  async function commit(input={}, actor=null) {
    if(!db)throw new Error('database is required to commit imports');
    const result=await preview(input); const createdAt=now(); const batchId=idFactory('bank-batch');
    return withTransaction(db,()=>{
      db.prepare('INSERT INTO bank_import_batches(id,source_type,document_id,filename,account_id,parsed_count,accepted_count,duplicate_count,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(batchId,result.sourceType,result.documentId,input.filename||null,input.accountId,result.summary.parsed,result.summary.accepted,result.summary.duplicates,actor?.id||null,createdAt);
      const insert=db.prepare('INSERT OR IGNORE INTO bank_transactions(id,batch_id,account_id,occurred_at,description,normalized_description,counterparty,amount_cents,direction,category_label,source_fingerprint,business_fingerprint,rule_id,rule_reason,rule_confidence,review_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      let inserted=0;
      for(const tx of result.transactions){const info=insert.run(idFactory('bank-tx'),batchId,tx.accountId,tx.date,tx.description,tx.normalized,tx.counterparty||null,tx.amountCents,tx.direction,tx.category||null,tx.sourceFingerprint,tx.businessFingerprint,tx.classification?.ruleId||null,tx.classification?.reason||null,Number(tx.classification?.confidence||0),tx.classification?.matched?'AUTO_CLASSIFIED':'PENDING',createdAt); inserted+=Number(info.changes||0);}
      db.prepare('INSERT INTO audit_log(action,entity,entity_id,actor_id,actor_role,context_json,created_at) VALUES (?,?,?,?,?,?,?)').run('bank_statement_import','bank_import_batch',batchId,actor?.id||null,actor?.role||null,JSON.stringify({sourceType:result.sourceType,documentId:result.documentId,inserted,duplicates:result.summary.duplicates}),createdAt);
      return {batchId,inserted,duplicates:result.summary.duplicates,summary:result.summary};
    });
  }
  function listTransactions(filters={}) {
    if(!db)throw new Error('database is required');
    const where=[]; const args=[];
    if(filters.accountId){where.push('t.account_id=?');args.push(filters.accountId);}
    if(filters.from){where.push('t.occurred_at>=?');args.push(filters.from);}
    if(filters.to){where.push('t.occurred_at<=?');args.push(filters.to);}
    if(filters.reviewStatus){where.push('t.review_status=?');args.push(filters.reviewStatus);}
    return db.prepare(`SELECT t.*,a.name AS account_name FROM bank_transactions t JOIN financial_accounts a ON a.id=t.account_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY t.occurred_at DESC,t.created_at DESC`).all(...args);
  }
  async function suggestTransfers(filters={}) {
    if(!db)throw new Error('database is required');
    const domain=await domainLoader();
    const transactions=listTransactions(filters).map(row=>({id:row.id,accountId:row.account_id,date:row.occurred_at,amountCents:row.amount_cents,direction:row.direction,description:row.description}));
    const accounts=db.prepare("SELECT id,LOWER(COALESCE(ownership,'BUSINESS')) AS ownership FROM financial_accounts WHERE active=1").all();
    return domain.reconcileAccountTransfers(transactions,accounts,{maxDays:Number(filters.maxDays??1),amountToleranceCents:Number(filters.amountToleranceCents??0)});
  }
  async function suggestEntries(filters={}) {
    if(!db)throw new Error('database is required');
    const domain=await domainLoader();
    const transactions=listTransactions(filters).filter(row=>row.direction==='debit').map(row=>({id:row.id,date:row.occurred_at,description:row.description,amountCents:row.amount_cents,direction:row.direction,category:row.category_label||null}));
    const obligations=db.prepare(`SELECT e.id,
      MAX(0,e.amount_cents-COALESCE(SUM(CASE WHEN s.reversed_at IS NULL THEN s.amount_cents ELSE 0 END),0)) AS amountCents,
      e.due_at AS dueDate,c.name AS category,COALESCE(cr.name,e.description) AS beneficiaryName
      FROM financial_entries e
      LEFT JOIN financial_settlements s ON s.entry_id=e.id
      LEFT JOIN creditors cr ON cr.id=e.creditor_id
      LEFT JOIN financial_categories c ON c.id=e.category_id
      WHERE e.kind='PAYABLE' AND e.status IN ('OPEN','PARTIAL')
      GROUP BY e.id,e.amount_cents,e.due_at,c.name,cr.name,e.description`).all().filter(item=>Number(item.amountCents)>0);
    const links=db.prepare("SELECT transaction_id AS transactionId,entry_id AS obligationId,amount_cents AS amountCents FROM bank_reconciliation_links WHERE decision IN ('accepted','manual')").all();
    const confirmedMap=new Map(); for(const link of links){if(!confirmedMap.has(link.transactionId))confirmedMap.set(link.transactionId,[]);confirmedMap.get(link.transactionId).push({obligationId:link.obligationId,amountCents:link.amountCents});}
    const confirmedMatches=[...confirmedMap].map(([transactionId,allocations])=>({transactionId,allocations}));
    const feedback=db.prepare('SELECT transaction_id,entry_id,accepted,rejected,manual FROM bank_reconciliation_feedback').all(); const pairStats={}; for(const row of feedback)pairStats[`${row.transaction_id}|${row.entry_id}`]={accepted:row.accepted,rejected:row.rejected,manual:row.manual};
    return domain.suggestReconciliation(transactions,obligations,confirmedMatches,{minConfidence:Number(filters.minConfidence??0.65),pairStats});
  }
  async function recordDecision({transactionId,entryId,decision,amountCents},actor=null) {
    if(!db)throw new Error('database is required');
    const domain=await domainLoader(); if(!['accepted','rejected','manual'].includes(decision))throw new TypeError('invalid decision');
    const tx=db.prepare('SELECT id,amount_cents FROM bank_transactions WHERE id=?').get(transactionId);
    const entry=db.prepare('SELECT id,amount_cents FROM financial_entries WHERE id=?').get(entryId);
    if(!tx||!entry)throw new Error('transaction or entry not found');
    const current=db.prepare('SELECT accepted,rejected,manual FROM bank_reconciliation_feedback WHERE transaction_id=? AND entry_id=?').get(transactionId,entryId)||{accepted:0,rejected:0,manual:0};
    const next=domain.updatePairStats(current,decision); const createdAt=now();
    return withTransaction(db,()=>{
      db.prepare('INSERT INTO bank_reconciliation_feedback(transaction_id,entry_id,accepted,rejected,manual,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(transaction_id,entry_id) DO UPDATE SET accepted=excluded.accepted,rejected=excluded.rejected,manual=excluded.manual,updated_at=excluded.updated_at').run(transactionId,entryId,next.accepted,next.rejected,next.manual,createdAt);
      if(decision==='rejected')db.prepare('DELETE FROM bank_reconciliation_links WHERE transaction_id=? AND entry_id=?').run(transactionId,entryId);
      else {
        const txUsed=rowTotal(db,'SELECT COALESCE(SUM(amount_cents),0) total FROM bank_reconciliation_links WHERE transaction_id=? AND entry_id<>?',transactionId,entryId);
        const entryUsed=rowTotal(db,'SELECT COALESCE(SUM(amount_cents),0) total FROM bank_reconciliation_links WHERE entry_id=? AND transaction_id<>?',entryId,transactionId);
        const settled=rowTotal(db,'SELECT COALESCE(SUM(amount_cents),0) total FROM financial_settlements WHERE entry_id=? AND reversed_at IS NULL',entryId);
        const txAvailable=Math.max(0,Number(tx.amount_cents)-txUsed);
        const entryAvailable=Math.max(0,Number(entry.amount_cents)-settled-entryUsed);
        const requested=Number(amountCents||tx.amount_cents);
        const allocated=Math.min(requested,txAvailable,entryAvailable);
        if(!Number.isSafeInteger(allocated)||allocated<=0)throw new Error('no remaining amount available for reconciliation');
        db.prepare('INSERT INTO bank_reconciliation_links(id,transaction_id,entry_id,amount_cents,decision,created_by,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(transaction_id,entry_id) DO UPDATE SET amount_cents=excluded.amount_cents,decision=excluded.decision,created_by=excluded.created_by,created_at=excluded.created_at').run(idFactory('bank-link'),transactionId,entryId,allocated,decision,actor?.id||null,createdAt);
      }
      const hasLinks=rowTotal(db,'SELECT COUNT(*) total FROM bank_reconciliation_links WHERE transaction_id=?',transactionId)>0;
      db.prepare('UPDATE bank_transactions SET review_status=? WHERE id=?').run(hasLinks?'MATCHED':'REVIEWED',transactionId);
      db.prepare('INSERT INTO audit_log(action,entity,entity_id,actor_id,actor_role,context_json,created_at) VALUES (?,?,?,?,?,?,?)').run('bank_reconciliation_decision','bank_transaction',transactionId,actor?.id||null,actor?.role||null,JSON.stringify({entryId,decision,stats:next}),createdAt);
      return {transactionId,entryId,decision,stats:next};
    });
  }
  return {preview,commit,listTransactions,suggestTransfers,suggestEntries,recordDecision};
}
module.exports={createStatementImportService,parseCsv,parseOfx,parsePdfText,parseDate,parseAmount,defaultPdfTextLoader,documentIdentity};
