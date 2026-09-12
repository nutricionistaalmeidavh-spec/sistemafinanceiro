# ArtiSys Sistema Financeiro

Aplicativo desktop **local-first** para gestão financeira. O núcleo funciona no computador do cliente, com SQLite local, sem SaaS, cloud ou serviço pago obrigatório.

## Estado do roadmap

### 01 — Base do produto ✅
- Electron + React + Vite;
- SQLite local com migrations versionadas;
- renderer isolado (`contextIsolation`, sem Node direto);
- preload com API restrita;
- estrutura preparada para instalador NSIS Windows.

### 02 — Utilidades ArtiSys ✅
O repositório `utilidades` entra como submódulo em `vendor/utilidades`, fixado no commit `1c8d00810dcaa9010330ce7adc2877c90484d17d`.

Integrados: `artisys-desktop-shell`, `artisys-eventbus`, `artisys-dashboard`, `artisys-pdf`, `artisys-qa`, `artisys-security` e `artisys-release`. QA, segurança e release continuam **opt-in**, sem gastar CI automaticamente.

### 03 — Autenticação e permissões ✅
- primeiro acesso cria o administrador local;
- senha com `scrypt` + salt, sem senha em texto puro;
- sessões locais com expiração e bloqueio temporário após tentativas repetidas;
- perfis `ADMIN`, `FINANCE`, `MANAGER` e `READONLY`;
- autorização aplicada no processo principal Electron, não apenas na interface;
- gestão de usuários e ativação/desativação com auditoria.

### 04 — Núcleo financeiro ✅
- contas financeiras: caixa, banco, cartão e outras;
- contas a pagar e contas a receber;
- valores persistidos em centavos inteiros;
- vencimento e saldo em aberto derivados do histórico;
- baixas parciais ou totais;
- estorno de baixa;
- cancelamento sem apagar histórico;
- resumo de pagar/receber e vencidos;
- auditoria das mutações financeiras.

### 05 — Cadastros ✅
- clientes;
- credores/fornecedores;
- categorias financeiras de receita/despesa;
- grupo DRE por categoria;
- ativação/inativação sem excluir histórico;
- vínculos opcionais desses cadastros aos lançamentos financeiros.

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
AuthService / FinanceService / RegistryService
      ↓
DatabaseService
      ↓
SQLite local

vendor/utilidades
      ↓
Desktop Shell / EventBus / Dashboard / PDF
QA / Security / Release (opt-in)
```

O renderer não recebe acesso a Node, filesystem ou SQLite. As mutações de financeiro, cadastros e usuários são autorizadas no processo principal e auditadas.

## Dados locais

O banco `sistema-financeiro.sqlite` fica em `app.getPath('userData')`. Dados do usuário não são versionados no Git.

## Próxima etapa

**06 — Fluxo de caixa:** entradas, saídas, saldo inicial/final e movimentações por conta financeira.
