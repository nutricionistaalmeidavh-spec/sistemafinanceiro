# Sistema Financeiro — E01/E02 Design

## Objetivo

Criar a base local-first do novo Sistema Financeiro e integrar a infraestrutura reutilizável já existente no repositório `utilidades`, sem depender de SaaS ou serviço pago para funcionar.

## Arquitetura

O produto será um aplicativo desktop Windows com Electron, React, Vite e SQLite. O renderer não acessa Node.js, filesystem ou SQLite diretamente; toda operação nativa passa por um preload restrito. O banco local usa `better-sqlite3`, migrations versionadas e WAL.

O repositório `nutricionistaalmeidavh-spec/utilidades` será consumido como submódulo Git em `vendor/utilidades`, fixado no commit `1c8d00810dcaa9010330ce7adc2877c90484d17d`. Os módulos usados nesta fase são:

- `artisys-desktop-shell`;
- `artisys-eventbus`;
- `artisys-dashboard`;
- `artisys-pdf`;
- `artisys-qa`;
- `artisys-security`;
- `artisys-release`.

Dependências JavaScript reutilizáveis serão referenciadas via `file:vendor/utilidades/modules/...`; segurança continuará como gate explícito em Python, sem virar dependência de runtime.

## Estrutura inicial

```text
sistemafinanceiro/
  database/migrations/
  electron/services/
  src/components/
  src/platform/
  tests/
  vendor/utilidades/        # git submodule
  docs/superpowers/
```

## E01 — Base do produto

- Electron + React + Vite;
- SQLite local com migrations;
- preload com API mínima e isolamento de contexto;
- tela inicial de bootstrap mostrando que o runtime está pronto;
- scripts `dev`, `electron:dev`, `build`, `test`, `check` e `dist`;
- instalador NSIS preparado, sem gerar release nesta entrega.

## E02 — Utilidades ArtiSys

- submódulo `vendor/utilidades` pinado;
- integração de Desktop Shell, EventBus, Dashboard e PDF por imports locais;
- QA, Security e Release expostos como comandos explícitos;
- nenhum gate pesado deve rodar automaticamente em cada alteração;
- nenhuma dependência paga, cloud ou always-on.

## Testes

Os testes unitários devem validar a criação/migração do banco local e o contrato de integração dos módulos ArtiSys. Build TypeScript/Vite deve passar localmente antes de considerar E01/E02 concluídas.

## Fora de escopo

Não entram ainda regras de contas a pagar/receber, clientes, credores, fluxo de caixa, DRE, autenticação, alertas ou relatórios. Esses itens começam nas próximas etapas do roadmap.