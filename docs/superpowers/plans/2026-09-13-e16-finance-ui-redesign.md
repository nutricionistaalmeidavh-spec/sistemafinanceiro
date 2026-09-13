# E16 Finance UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar a percepção visual do ArtiSys Financeiro sem alterar regras de negócio, banco de dados, IPCs ou permissões existentes.

**Architecture:** Criar um pequeno `finance-ui-kit` local, reorganizar o shell em grupos visuais, tornar o dashboard mais acionável e mover o formulário principal de lançamentos para um drawer lateral. As páginas continuam consumindo exatamente as mesmas APIs `window.financeiro` e os mesmos tipos atuais.

**Tech Stack:** React 19, TypeScript, Lucide React, CSS existente, Electron/Vite, Node test runner, ArtiSys QA.

**Spec:** `docs/superpowers/specs/2026-09-13-e16-finance-ui-redesign.md`

## Global Constraints

- Não alterar schema SQLite, migrations, IPC contracts ou regras financeiras.
- Não adicionar dependência paga ou serviço externo.
- Não usar glassmorphism.
- Preservar `data-testid` e fluxos QA existentes sempre que possível.
- Manter funcionamento desktop local-first e responsividade real.
- Motion apenas para mudança de contexto e feedback; sem animação decorativa contínua.

---

### Task 1: UI contract and finance-ui-kit

**Files:**
- Create: `tests/e16-finance-ui.test.mjs`
- Create: `src/components/finance-ui.tsx`
- Create: `src/finance-ui.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `FinanceButton`, `FinanceMetricCard`, `FinanceStatusBadge`, `FinanceToolbar`, `FinanceEmptyState`, `FinanceDrawer`.

- [ ] Write a failing source-contract test requiring grouped navigation, the finance UI kit, drawer semantics, dashboard attention strip and responsive drawer CSS.
- [ ] Run the test and confirm RED against the E15 code.
- [ ] Add only the reusable visual primitives needed by E16.
- [ ] Import `finance-ui.css` in `main.tsx`.
- [ ] Run the contract test again and keep it RED until shell/dashboard/finance tasks are implemented.

### Task 2: Grouped shell and responsive navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/final-polish.css`

**Interfaces:**
- Consumes existing `Page`, permission checks and `data-testid=nav-*`.
- Produces grouped sections `Visão`, `Financeiro`, `Dados`, `Administração` while preserving the same page state and click behavior.

- [ ] Add navigation group metadata without changing authorization behavior.
- [ ] Render group labels only in expanded desktop sidebar.
- [ ] Use 248px expanded and 72px compact tablet shell.
- [ ] Convert mobile navigation to a clean drawer/top trigger pattern rather than a long horizontal strip.
- [ ] Preserve logout, current user context and all navigation test ids.

### Task 3: Action-oriented dashboard

**Files:**
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/styles.css`
- Modify: `src/finance-ui.css`

**Interfaces:**
- Consumes existing `DashboardSnapshot` only.
- Produces four primary KPIs, an attention strip derived from overdue totals, cash-flow/balance composition and compact DRE/expense sections.

- [ ] Replace four equal generic cards with finance metric primitives and semantic tone.
- [ ] Add an attention strip for overdue payables/receivables using only existing dashboard data.
- [ ] Improve chart hierarchy and account balance presentation without changing calculations.
- [ ] Keep year selection and all existing data calls unchanged.

### Task 4: Finance toolbar and new-entry drawer

**Files:**
- Modify: `src/pages/FinancePage.tsx`
- Modify: `src/finance-ui.css`

**Interfaces:**
- Consumes existing create/settle/cancel/reverse/report functions unchanged.
- Produces `data-testid="finance-new-entry"`, drawer `data-testid="finance-entry-drawer"`, and existing `finance-search`.

- [ ] Add `entryDrawerOpen` state and primary `Novo lançamento` action in the toolbar.
- [ ] Move the existing entry form into `FinanceDrawer` without changing field names or submit payload.
- [ ] Close drawer after successful create.
- [ ] Keep account creation as a secondary compact panel below/adjacent to the table context, not permanently competing with entry creation.
- [ ] Standardize status presentation via `FinanceStatusBadge` while retaining current statuses.

### Task 5: Cross-page visual consistency

**Files:**
- Modify: `src/styles.css`
- Modify: `src/final-polish.css`
- Modify only where needed: `src/pages/CashflowPage.tsx`, `src/pages/DrePage.tsx`, `src/pages/ReportsPage.tsx`, `src/pages/RecurringPage.tsx`, `src/pages/RegistryPage.tsx`, `src/pages/AlertsPage.tsx`, `src/pages/UsersPage.tsx`, `src/pages/SystemPage.tsx`

**Interfaces:**
- Preserve all existing page APIs, test ids and business behavior.

- [ ] Apply unified page headers, border radii, spacing and button hierarchy.
- [ ] Keep tables moderately dense, sticky headers and hover states.
- [ ] Ensure status colors are semantic and red is reserved for destructive/critical states.
- [ ] Verify no decorative motion or glass effects were introduced.

### Task 6: Verification, visual evidence and merge

**Files:**
- Modify: `.github/workflows/final-release.yml` only if needed to run final E16 verification.
- Modify: `qa/flows/final-screens.json` only if selectors/text changed.

**Interfaces:**
- Produces green unit/build/security/release gates and 10 real Electron screenshots.

- [ ] Run `npm test` and require all tests green.
- [ ] Run `npm run build` and require TypeScript/Vite green.
- [ ] Validate QA manifest.
- [ ] Run security and release gates.
- [ ] Build Windows NSIS and capture real Electron screenshots.
- [ ] Review visual evidence for regressions.
- [ ] Fast-forward `main` only after all gates are green.
