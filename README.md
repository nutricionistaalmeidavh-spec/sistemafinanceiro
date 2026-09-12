# ArtiSys Sistema Financeiro

Aplicativo desktop **local-first** para gestão financeira. O núcleo funciona no computador do cliente, com SQLite local, sem SaaS, cloud ou serviço pago obrigatório.

## Estado do roadmap

### 01 — Base do produto ✅

- Electron + React + Vite;
- SQLite local com migrations versionadas;
- renderer isolado (`contextIsolation`, sem Node direto);
- preload com API mínima;
- estrutura preparada para instalador NSIS Windows.

### 02 — Utilidades ArtiSys ✅

O repositório `utilidades` entra como submódulo em `vendor/utilidades`, fixado no commit `1c8d00810dcaa9010330ce7adc2877c90484d17d`.

Integrados nesta fase:

- `artisys-desktop-shell`;
- `artisys-eventbus`;
- `artisys-dashboard`;
- `artisys-pdf`;
- `artisys-qa`;
- `artisys-security`;
- `artisys-release`.

QA, segurança e release são **gates explícitos**. Eles não executam automaticamente em cada commit e não consomem CI sem solicitação.

## Primeiro uso no desenvolvimento

```bash
git clone --recurse-submodules https://github.com/nutricionistaalmeidavh-spec/sistemafinanceiro.git
cd sistemafinanceiro
git submodule update --init --recursive
npm install
npm run electron:dev
```

Se o repositório já tiver sido clonado sem os submódulos:

```bash
git submodule update --init --recursive
```

## Comandos

```bash
npm test                 # testes unitários locais
npm run build            # TypeScript + Vite
npm run check            # testes + build
npm run qa:validate      # valida configuração do QA; opt-in
npm run security         # security gate; opt-in
npm run release:check    # gates completos; opt-in
npm run dist             # instalador Windows NSIS
```

O `artisys-security` usa somente ferramentas open source. O modo Docker/native é de desenvolvimento e não é dependência de runtime do produto.

## Arquitetura inicial

```text
React renderer
      ↓
preload IPC restrito
      ↓
Electron main
      ↓
DatabaseService
      ↓
SQLite local

vendor/utilidades
      ↓
Desktop Shell / EventBus / Dashboard / PDF
QA / Security / Release (opt-in)
```

Dados de usuário nunca devem ser versionados. O banco comercial será armazenado na pasta de dados do aplicativo definida pelo Electron.

## Próxima etapa

**03 — Autenticação:** adaptar usuários, sessão, perfis e permissões do módulo já usado no Almoxarifado.
