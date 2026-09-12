# E06–E09 Finance & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar fluxo de caixa, DRE/indicadores, dashboard e recorrências no Sistema Financeiro local-first.

**Architecture:** O processo Electron continua autoritativo. `cashflow-service` agrega movimentos por conta e transferências; `analytics-service` calcula DRE/KPIs/snapshot do dashboard; `recurrence-service` gera contas recorrentes idempotentemente. O renderer apenas exibe resultados via preload/IPC.

**Tech Stack:** Electron, React 19, TypeScript, SQLite/better-sqlite3, Node 22+, módulos ArtiSys locais.

**Spec:** `docs/superpowers/specs/2026-09-12-e06-e09-finance-analytics-design.md`

## Global Constraints
- Core obrigatório R$ 0, local-first, sem SaaS/serviço pago obrigatório.
- Valores monetários em centavos inteiros.
- Mutações protegidas por RBAC e audit log.
- Não executar GitHub Actions nesta entrega.
- Operações multi-registro usam transação SQLite.

---

### Task 1: Schema E06–E09

**Files:**
- Create: `database/migrations/003_cashflow_analytics_recurrence.sql`
- Test: `tests/e06-e09-schema.test.mjs`

**Interfaces:**
- Produces: `cash_movements`, `recurring_rules`, colunas de recorrência em `financial_entries` e índices necessários.

- [ ] Escrever teste que exige `user_version=3`, tabelas e índices novos.
- [ ] Rodar teste e confirmar falha antes da migration.
- [ ] Implementar migration 003 com FKs, CHECKs e índices.
- [ ] Rodar teste e confirmar aprovação.

### Task 2: Fluxo de caixa

**Files:**
- Create: `electron/services/cashflow-service.cjs`
- Modify: `electron/services/finance-service.cjs`
- Test: `tests/cashflow.test.mjs`

**Interfaces:**
- Produces: `createManualMovement`, `transfer`, `listMovements`, `getAccountBalances`, `getCashflowSummary`.
- Finance settlements expose account and feed analytics without duplicating ledger rows.

- [ ] Escrever testes para abertura/aporte/retirada, transferência atômica e saldo com liquidações/estornos.
- [ ] Rodar testes e confirmar falha por serviço ausente.
- [ ] Implementar serviço e ajuste mínimo em finance.
- [ ] Rodar testes e confirmar aprovação.

### Task 3: DRE e dashboard snapshot

**Files:**
- Create: `electron/services/analytics-service.cjs`
- Test: `tests/analytics.test.mjs`

**Interfaces:**
- Produces: `getDre`, `getIndicators`, `getDashboardSnapshot`.

- [ ] Escrever testes com receitas/despesas, grupos DRE, série mensal e top despesas.
- [ ] Rodar testes e confirmar falha.
- [ ] Implementar consultas agregadas no backend.
- [ ] Rodar testes e confirmar aprovação.

### Task 4: Recorrências

**Files:**
- Create: `electron/services/recurrence-service.cjs`
- Test: `tests/recurrence.test.mjs`

**Interfaces:**
- Produces: `createRule`, `listRules`, `setRuleActive`, `generateDue`.

- [ ] Escrever testes para mensalidade, limite de ocorrências, pausa e idempotência.
- [ ] Rodar testes e confirmar falha.
- [ ] Implementar geração mensal chamando `finance.createEntry` dentro do contrato existente.
- [ ] Rodar testes e confirmar aprovação.

### Task 5: IPC, preload e UI

**Files:**
- Modify: `electron/main.cjs`, `electron/ipc-handlers.cjs`, `electron/preload.cjs`, `src/vite-env.d.ts`, `src/App.tsx`, `src/styles.css`
- Create: `src/pages/DashboardPage.tsx`, `src/pages/CashflowPage.tsx`, `src/pages/RecurringPage.tsx`
- Test: `tests/ipc-e06-e09.test.mjs`

**Interfaces:**
- IPC namespaces: `cashflow:*`, `analytics:*`, `recurrence:*`.

- [ ] Escrever teste de registro/guards IPC.
- [ ] Implementar composição dos serviços no main e bridge preload.
- [ ] Implementar dashboard/cards/gráficos CSS simples sem cálculo financeiro no renderer.
- [ ] Implementar telas Fluxo de Caixa e Recorrências.
- [ ] Atualizar tipos TypeScript e navegação.
- [ ] Rodar testes, `node --check` e `tsc --noEmit`.

### Task 6: Docs e merge

**Files:**
- Modify: `README.md`

- [ ] Atualizar roadmap 6–9 como entregues e documentar comandos locais.
- [ ] Comparar branch com `main` e revisar escopo.
- [ ] Rodar suíte local completa sem GitHub Actions.
- [ ] Fast-forward `main` somente após gates locais verdes.
