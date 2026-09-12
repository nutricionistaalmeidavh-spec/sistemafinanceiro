# ArtiSys Sistema Financeiro

Aplicativo desktop **local-first** para gestão financeira. O núcleo funciona no computador do cliente, com SQLite local, sem SaaS, cloud ou serviço pago obrigatório.

## Estado do roadmap

### 01 — Base do produto ✅
Electron + React + Vite, SQLite com migrations versionadas, preload restrito e preparação para NSIS Windows.

### 02 — Utilidades ArtiSys ✅
`utilidades` entra como submódulo fixado em commit conhecido. Integrados: Desktop Shell, EventBus, Dashboard, PDF, QA, Security e Release. QA/segurança/release permanecem **opt-in**.

### 03 — Autenticação e permissões ✅
Administrador local, `scrypt` + salt, sessões locais, perfis `ADMIN`, `FINANCE`, `MANAGER`, `READONLY`, RBAC no processo principal e auditoria.

### 04 — Núcleo financeiro ✅
Contas financeiras, pagar/receber, baixas parciais/totais, estorno, cancelamento sem apagar histórico, vencidos e resumos.

### 05 — Cadastros ✅
Clientes, credores/fornecedores, categorias de receita/despesa e grupos DRE.

### 06 — Fluxo de caixa ✅
- movimentos manuais de abertura, entrada, saída e ajuste;
- transferências atômicas entre contas;
- baixas financeiras integradas ao fluxo sem duplicar lançamentos;
- saldo por conta;
- saldo inicial, entradas, saídas, resultado líquido e saldo final do período;
- estornos deixam de compor o fluxo automaticamente.

### 07 — DRE e indicadores ✅
- DRE realizada por data de baixa;
- DRE por competência usando vencimento;
- agregação por grupo DRE;
- receitas, despesas, resultado, valores em aberto e vencidos;
- saldo bancário e saldo total derivados do livro-caixa.

### 08 — Dashboard ✅
- contas a pagar/receber em aberto;
- entradas e saídas realizadas;
- saldo por conta/banco;
- fluxo mensal;
- 5 maiores despesas;
- resumo da DRE;
- seleção de ano;
- cálculos feitos no backend local, não no renderer.

### 09 — Recorrências ✅
- regras mensais para pagar/receber;
- dia de vencimento configurável;
- data inicial/final e limite opcional de ocorrências;
- pausa/reativação;
- geração idempotente por `recurrence_key`;
- lançamentos gerados preservam vínculo com a regra de origem.

## Primeiro uso no desenvolvimento

```bash
git clone --recurse-submodules https://github.com/nutricionistaalmeidavh-spec/sistemafinanceiro.git
cd sistemafinanceiro
git submodule update --init --recursive
npm install
npm run electron:dev
```

No primeiro acesso ao aplicativo desktop, defina a senha do administrador local. O login inicial é `admin`.

## Comandos

```bash
npm test                 # testes unitários locais
npm run build            # TypeScript + Vite
npm run check            # testes + build
npm run qa:validate      # QA opt-in
npm run security         # security gate opt-in
npm run release:check    # gates de release opt-in
npm run dist             # instalador Windows NSIS
```

## Arquitetura atual

```text
React renderer
      ↓
preload IPC restrito
      ↓
IPC handlers + RBAC
      ↓
Auth / Finance / Registry
Cashflow / Analytics / Recurrence
      ↓
DatabaseService
      ↓
SQLite local

vendor/utilidades
      ↓
Desktop Shell / EventBus / Dashboard / PDF
QA / Security / Release (opt-in)
```

O renderer não recebe acesso a Node, filesystem ou SQLite. Valores monetários permanecem em centavos inteiros. Mutações financeiras e de cadastro são autorizadas no processo principal e auditadas.

## Dados locais

O banco `sistema-financeiro.sqlite` fica em `app.getPath('userData')`. Dados do usuário não são versionados no Git.

## Próxima etapa

**10 — Alertas:** vencimentos, atrasos, saldo baixo e avisos internos.
