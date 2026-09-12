'use strict';

function resolveQaCredential(password) {
  const value = String(password || process.env.ARTISYS_QA_PASSWORD || '');
  if (value.length < 10) throw new Error('ARTISYS_QA_PASSWORD must be provided for QA fixture mode');
  return value;
}

function dateOffset(base, days) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function seedQaFixture({ db, auth, now = () => new Date().toISOString(), password } = {}) {
  if (!db || !auth) throw new TypeError('db and auth are required');
  const credential = resolveQaCredential(password);
  const timestamp = String(now());
  const today = timestamp.slice(0, 10);

  if (auth.needsBootstrap()) auth.bootstrapAdmin({ password: credential, name: 'Administrador QA' });
  const marker = db.prepare("SELECT value FROM app_meta WHERE key='qa_fixture'").get();
  if (marker?.value === 'e14-e15-v1') return { seeded: false, login: 'admin', password: credential };

  withTransaction(db, () => {
    const account = db.prepare('INSERT OR IGNORE INTO financial_accounts(id,name,type,active,created_at,updated_at) VALUES (?,?,?,?,?,?)');
    account.run('qa-bank-main','Banco Principal','BANK',1,timestamp,timestamp);
    account.run('qa-bank-reserve','Reserva Operacional','BANK',1,timestamp,timestamp);
    account.run('qa-cash','Caixa','CASH',1,timestamp,timestamp);
    account.run('qa-card','Cartão Corporativo','CARD',1,timestamp,timestamp);

    const customer = db.prepare('INSERT OR IGNORE INTO customers(id,name,document,phone,email,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    customer.run('qa-customer-alpha','Construtora Alpha','12.345.678/0001-90','(16) 3333-1000','financeiro@alpha.example','Cliente recorrente',1,timestamp,timestamp);
    customer.run('qa-customer-beta','Grupo Beta','98.765.432/0001-10','(16) 3333-2000','contato@beta.example','Projeto em andamento',1,timestamp,timestamp);

    const creditor = db.prepare('INSERT OR IGNORE INTO creditors(id,name,document,phone,email,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    creditor.run('qa-creditor-rent','Imobiliária Centro',null,'(16) 4000-1000','cobranca@imobiliaria.example',null,1,timestamp,timestamp);
    creditor.run('qa-creditor-tools','Cloud Tools Brasil',null,null,'billing@cloudtools.example',null,1,timestamp,timestamp);
    creditor.run('qa-creditor-energy','Energia Regional',null,'0800 000 000',null,null,1,timestamp,timestamp);
    creditor.run('qa-creditor-service','Serviços Delta',null,'(16) 99999-1200','financeiro@delta.example',null,1,timestamp,timestamp);

    const category = db.prepare('INSERT OR IGNORE INTO financial_categories(id,name,nature,dre_group,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
    category.run('qa-cat-sales','Receita de serviços','REVENUE','RECEITA_OPERACIONAL',1,timestamp,timestamp);
    category.run('qa-cat-rent','Aluguel','EXPENSE','DESPESAS_FIXAS',1,timestamp,timestamp);
    category.run('qa-cat-energy','Energia','EXPENSE','DESPESAS_FIXAS',1,timestamp,timestamp);
    category.run('qa-cat-tools','Software e ferramentas','EXPENSE','DESPESAS_OPERACIONAIS',1,timestamp,timestamp);
    category.run('qa-cat-services','Serviços terceirizados','EXPENSE','DESPESAS_OPERACIONAIS',1,timestamp,timestamp);

    const entry = db.prepare(`INSERT OR IGNORE INTO financial_entries
      (id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,issue_at,due_at,status,source_type,source_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    entry.run('qa-rec-open','RECEIVABLE','Mensalidade Cliente Alpha','qa-cat-sales','qa-bank-main','qa-customer-alpha',null,650000,dateOffset(timestamp,-2),dateOffset(timestamp,5),'OPEN','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-rec-overdue','RECEIVABLE','Projeto Beta — parcela 2','qa-cat-sales','qa-bank-main','qa-customer-beta',null,420000,dateOffset(timestamp,-20),dateOffset(timestamp,-6),'OPEN','qa-fixture','e14-e15','Aguardando confirmação',timestamp,timestamp);
    entry.run('qa-rec-today','RECEIVABLE','Reembolso de despesas','qa-cat-sales','qa-bank-main','qa-customer-alpha',null,98500,dateOffset(timestamp,-3),today,'OPEN','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-rec-settled','RECEIVABLE','Consultoria concluída','qa-cat-sales','qa-bank-main','qa-customer-alpha',null,280000,dateOffset(timestamp,-15),dateOffset(timestamp,-10),'SETTLED','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-pay-rent','PAYABLE','Aluguel escritório','qa-cat-rent','qa-bank-main',null,'qa-creditor-rent',350000,dateOffset(timestamp,-12),dateOffset(timestamp,3),'OPEN','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-pay-energy','PAYABLE','Energia elétrica','qa-cat-energy','qa-bank-main',null,'qa-creditor-energy',74230,dateOffset(timestamp,-18),dateOffset(timestamp,-4),'OPEN','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-pay-partial','PAYABLE','Serviços terceirizados','qa-cat-services','qa-bank-main',null,'qa-creditor-service',180000,dateOffset(timestamp,-8),dateOffset(timestamp,2),'PARTIAL','qa-fixture','e14-e15',null,timestamp,timestamp);
    entry.run('qa-pay-tools','PAYABLE','Software e ferramentas','qa-cat-tools','qa-bank-main',null,'qa-creditor-tools',89900,dateOffset(timestamp,-12),dateOffset(timestamp,-7),'SETTLED','qa-fixture','e14-e15',null,timestamp,timestamp);

    const settlement = db.prepare('INSERT OR IGNORE INTO financial_settlements(id,entry_id,amount_cents,method,note,occurred_at,created_at,reversed_at,account_id) VALUES (?,?,?,?,?,?,?,?,?)');
    settlement.run('qa-set-rec','qa-rec-settled',280000,'PIX','Recebimento integral',dateOffset(timestamp,-8),timestamp,null,'qa-bank-main');
    settlement.run('qa-set-partial','qa-pay-partial',60000,'PIX','Primeira parcela',dateOffset(timestamp,-3),timestamp,null,'qa-bank-main');
    settlement.run('qa-set-tools','qa-pay-tools',89900,'CARTAO','Pagamento mensal',dateOffset(timestamp,-6),timestamp,null,'qa-bank-main');

    const movement = db.prepare('INSERT OR IGNORE INTO cash_movements(id,account_id,direction,type,amount_cents,occurred_at,note,transfer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    movement.run('qa-open-bank','qa-bank-main','IN','OPENING',1200000,dateOffset(timestamp,-40),'Saldo inicial',null,timestamp);
    movement.run('qa-open-reserve','qa-bank-reserve','IN','OPENING',350000,dateOffset(timestamp,-40),'Reserva inicial',null,timestamp);
    movement.run('qa-open-cash','qa-cash','IN','OPENING',80000,dateOffset(timestamp,-40),'Caixa inicial',null,timestamp);
    movement.run('qa-deposit-bank','qa-bank-main','IN','DEPOSIT',150000,dateOffset(timestamp,-2),'Aporte operacional',null,timestamp);
    movement.run('qa-withdraw-cash','qa-cash','OUT','WITHDRAWAL',12500,dateOffset(timestamp,-1),'Despesas rápidas',null,timestamp);

    const recurring = db.prepare(`INSERT OR IGNORE INTO recurring_rules
      (id,kind,description,category_id,account_id,customer_id,creditor_id,amount_cents,start_date,end_date,due_day,interval_months,max_occurrences,generated_count,next_due_at,notes,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    recurring.run('qa-rule-rent','PAYABLE','Aluguel mensal','qa-cat-rent','qa-bank-main',null,'qa-creditor-rent',350000,dateOffset(timestamp,-60),null,10,1,null,2,dateOffset(timestamp,28),'Contrato do escritório',1,timestamp,timestamp);
    recurring.run('qa-rule-tools','PAYABLE','Licenças e ferramentas','qa-cat-tools','qa-bank-main',null,'qa-creditor-tools',89900,dateOffset(timestamp,-60),null,5,1,12,2,dateOffset(timestamp,23),null,1,timestamp,timestamp);
    recurring.run('qa-rule-alpha','RECEIVABLE','Mensalidade Cliente Alpha','qa-cat-sales','qa-bank-main','qa-customer-alpha',null,650000,dateOffset(timestamp,-60),null,15,1,null,2,dateOffset(timestamp,33),null,1,timestamp,timestamp);

    db.prepare(`INSERT OR REPLACE INTO account_alert_settings(account_id,low_balance_cents,enabled,updated_at) VALUES (?,?,1,?)`).run('qa-bank-reserve',500000,timestamp);
    db.prepare(`INSERT OR IGNORE INTO internal_alerts(id,title,body,severity,starts_at,ends_at,active,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('qa-alert-close','Fechamento mensal se aproxima','Revise contas pendentes e conciliação antes do fechamento.','INFO',today,dateOffset(timestamp,5),1,'local-admin',timestamp,timestamp);
  });

  const login = auth.authenticate('admin', credential);
  const existing = new Set(auth.listUsers(login.token).map((user) => user.login));
  if (!existing.has('finance.qa')) auth.createUser(login.token,{ name:'Financeiro QA', login:'finance.qa', password:credential, role:'FINANCE' });
  if (!existing.has('gestor.qa')) auth.createUser(login.token,{ name:'Gestor QA', login:'gestor.qa', password:credential, role:'MANAGER' });
  auth.logout(login.token);

  db.prepare(`INSERT INTO app_meta(key,value,updated_at) VALUES ('qa_fixture','e14-e15-v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(timestamp);
  return { seeded: true, login: 'admin', password: credential };
}

module.exports = { seedQaFixture, dateOffset, resolveQaCredential };
