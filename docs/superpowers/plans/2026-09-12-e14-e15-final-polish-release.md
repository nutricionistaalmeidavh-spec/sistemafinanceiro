# E14–E15 Final Polish & Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish product polish, capture deterministic screenshots from the real Electron app, build the Windows installer, and merge only after fail-closed release gates are green.

**Architecture:** Preserve E01–E13 domain services and SQLite contracts. E14 changes renderer ergonomics only. E15 adds an opt-in QA seed service, a real-Electron screenshot flow, local release scripts and—after explicit user authorization—GitHub Actions as an execution environment for those same gates. CI is not a runtime dependency of the product.

**Tech Stack:** Electron 43, React 19, TypeScript, Vite, SQLite/better-sqlite3, Node 22, Playwright, electron-builder NSIS, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-12-e14-e15-final-polish-release-design.md`

## Global Constraints

- Core remains local-first, self-hosted and R$0.
- Production startup never seeds QA/demo data.
- Existing financial/RBAC semantics remain unchanged.
- QA credentials are injected at execution time and are never stored in source.
- Final screenshots come from the real Electron renderer.
- GitHub Actions is an optional release executor, not a product dependency.
- Merge to `main` only after all final gates are green.

---

### Task 1: E14 UI contract and polish

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Create: `src/final-polish.css`
- Modify: `src/pages/FinancePage.tsx`
- Modify: `src/pages/RegistryPage.tsx`
- Modify: `src/pages/RecurringPage.tsx`
- Modify: `src/pages/AlertsPage.tsx`
- Modify: `src/pages/UsersPage.tsx`
- Create: `tests/ui-final-polish.test.mjs`

**Interfaces:**
- Navigation exposes stable `data-testid` identifiers for final QA.
- Collection-heavy pages expose search/filter controls without changing backend APIs.

- [x] Add a source-level contract test for accessible navigation, focus-visible styles and collection search controls.
- [x] Confirm the E13 UI does not satisfy the new contract.
- [x] Add search/filter state to collection-heavy pages without changing finance rules.
- [x] Add consistent responsive/focus/table/empty-state styles.
- [x] Verify the UI contract inside the full unit suite.

### Task 2: Deterministic QA fixture

**Files:**
- Create: `electron/services/qa-fixture-service.cjs`
- Modify: `electron/main.cjs`
- Create: `tests/qa-fixture.test.mjs`

**Interfaces:**
- `seedQaFixture({ db, auth, now?, password? }) -> { seeded: boolean, login: 'admin', password: string }`.
- Credential comes from the explicit `password` argument or `ARTISYS_QA_PASSWORD`; absence fails closed.
- Production calls it only when `process.env.ARTISYS_QA === '1'`.

- [x] Add tests proving idempotent representative fixture data.
- [x] Add a guard test proving startup gates seeding on QA mode.
- [x] Implement deterministic records with fixed IDs.
- [x] Isolate QA `userData` and reset only under the explicit reset flag.
- [x] Remove stored fixture credentials; test credentials are injected at execution time.

### Task 3: Real Electron screenshot flow

**Files:**
- Modify: `artisys-qa.config.json`
- Create: `qa/flows/final-screens.json`
- Create: `scripts/ci-capture-final-screens.mjs`
- Create: `tests/qa-final-flow.test.mjs`

**Interfaces:**
- QA environment: `final`.
- QA flow: `final-screens`.
- Electron viewport: 1440×900.
- Evidence path: `qa-artifacts/final/screenshots/*.png`.

- [x] Add a contract test for Electron mode and all 10 screenshot names.
- [x] Switch QA config to Electron mode.
- [x] Add stable test IDs/accessibility labels.
- [x] Add login/navigation/screenshot flow covering all final pages.
- [x] Add a direct Playwright/Electron runner for Actions that uses the same flow and generates an ephemeral QA credential.

### Task 4: Final release gates

**Files:**
- Create: `scripts/final-gates.mjs`
- Modify: `scripts/security.mjs`
- Modify: `package.json`
- Create: `tests/final-gates.test.mjs`

**Interfaces:**
- `npm run final:prepare` runs unit tests, Electron source syntax checks, build, security and release validation.
- `npm run qa:final` remains available with the full ArtiSys QA module.
- `npm run ci:qa-final` captures the same real Electron pages in isolated CI.
- `npm run dist:package` builds the Windows NSIS artifact after renderer build.

- [x] Implement sequential fail-closed local gates.
- [x] Keep local release commands available independently of CI.
- [x] Preserve the pinned `utilidades` commit metadata.
- [x] Add a credential-free pinned CI fallback for the private reusable modules so the repository-scoped Actions token does not need cross-repository access.

### Task 5: GitHub Actions homologation

**Files:**
- Create: `.github/workflows/final-release.yml`
- Create: `scripts/ci-bootstrap.mjs`
- Create: `tests/ci-actions-fallback.test.mjs`
- Create: `ci/artisys-security/security.py`
- Create: `ci/artisys-security/config/gitleaks.toml`
- Create: `ci/artisys-security/config/semgrep.yml`

**Interfaces:**
- Ubuntu job: full-history checkout → pinned CI bootstrap → install → tests → build → QA manifest validation → security → release gate.
- Windows job: install → build → Electron native-module rebuild → NSIS → real Electron screenshots → artifact upload.

- [x] Reproduce and identify private-submodule checkout failure.
- [x] Avoid introducing a PAT or hidden secret dependency.
- [x] Add pinned, credential-free CI fallback while retaining the real private submodule for normal development.
- [x] Prove tests/build/manifest validation green before the security gate.
- [ ] Obtain green security and release gates.
- [ ] Obtain green Windows installer and screenshot job.

### Task 6: Merge and final evidence

**Files:**
- Update the optional QA-agent project registry ref to `main` after merge.

- [ ] Verify feature branch is strictly ahead of `main` and not behind.
- [ ] Confirm Actions final run passes both Ubuntu and Windows jobs.
- [ ] Download the installer and 10 screenshot artifacts.
- [ ] Fast-forward `main` to the exact verified commit.
- [ ] Compare refs and confirm identical.
- [ ] Return the real PNG screenshots and final commit to the user.
