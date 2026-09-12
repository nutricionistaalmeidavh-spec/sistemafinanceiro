# E14–E15 Final Polish & Release Design

## Scope

Finalize the ArtiSys Sistema Financeiro after deliveries 01–13.

- **E14 — Product polish:** improve consistency, responsive behavior, keyboard/focus usability, search/filter ergonomics, empty/loading/error states and navigation without changing validated financial business rules.
- **E15 — Final gates:** create a deterministic QA fixture, execute the real Electron renderer with Playwright, capture the final screens, run unit/schema/security/release/build gates, build the Windows installer, and only then fast-forward `main`.

## Constraints

- Core remains local-first, self-hosted and R$0.
- Financial calculations, SQLite schema semantics and RBAC rules from E01–E13 are preserved.
- GitHub Actions is authorized for this final homologation but is not a runtime dependency of the application.
- The private `utilidades` integration remains pinned to its known commit; Actions may use an in-repository pinned fallback because repository-scoped tokens cannot read the private sibling repository.
- QA fixture is opt-in through `ARTISYS_QA=1`; production startup must never seed demo data.
- QA credentials are injected at execution time and never stored in source.
- QA uses an isolated Electron `userData` directory and deterministic records.
- Final screenshots must be captured from the real Electron application, not generated mockups.

## E14 UX design

The visual language stays close to the current product: light surfaces, restrained purple accent, clear metric cards and dense but readable financial tables. Polish is additive rather than a redesign.

Changes:

1. Add consistent focus-visible states and disabled states to interactive controls.
2. Add compact toolbar/filter patterns with search where large collections exist.
3. Improve table responsiveness with sticky headers and horizontal scrolling rather than content clipping.
4. Improve small-screen navigation and content spacing.
5. Standardize empty states, section captions, badges and action groups.
6. Preserve current desktop-first information architecture and all page names.

## E15 QA design

### Deterministic real-app fixture

`electron/services/qa-fixture-service.cjs` seeds an isolated QA database only when `ARTISYS_QA=1`. It creates:

- admin login `admin` with an execution-time injected QA credential;
- bank/cash/card accounts and realistic balances;
- customer/creditor/category records;
- open, overdue, partial and settled payable/receivable entries;
- settlements and cash movements;
- recurring rules;
- low-balance threshold and internal alert;
- representative additional users.

The fixture is idempotent and keyed by deterministic IDs. The credential is ephemeral/test-only and never reused by production startup.

### QA launch

`artisys-qa.config.json` runs in `electron` mode. Environment `final` enables QA mode and reset, while the credential is supplied externally. The Electron main process switches `userData` to a temp QA-only path before opening the database and resets that path only when explicitly requested.

### Screenshot flow

`qa/flows/final-screens.json` logs in and captures the real pages:

1. Dashboard
2. Fluxo de Caixa
3. Pagar / Receber
4. DRE
5. Recorrências
6. Cadastros
7. Alertas
8. Relatórios
9. Sistema / LAN
10. Acessos

Screenshots use the actual renderer at 1440×900.

### Release gates

The final homologation runs fail-closed:

1. Node test suite.
2. Syntax/contract checks for Electron services and final QA setup.
3. TypeScript + Vite build.
4. Security gate.
5. Release gate.
6. Windows Electron native dependency rebuild.
7. Electron Builder Windows NSIS build.
8. Real Electron final-screen capture.
9. GitHub Actions artifact upload for PNG evidence and installer.

Local scripts remain available independently of GitHub Actions.

## Success criteria

- Existing E01–E13 tests remain green.
- E14 UX contract tests are green.
- QA fixture test proves production mode does not seed data.
- Real Electron final-screen flow passes and produces 10 named PNG captures.
- TypeScript/Vite build passes.
- Security/release checks pass.
- Windows NSIS installer is produced.
- `main` is updated only after the exact tested commit has passed both verification jobs.
