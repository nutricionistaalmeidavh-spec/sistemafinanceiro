# ArtiSys Sistema Financeiro

Aplicativo desktop **local-first** para gestão financeira. O núcleo funciona no computador do cliente, com SQLite local, sem SaaS, cloud ou serviço pago obrigatório.

## Estado do roadmap

### 01 — Base do produto ✅
Electron + React + Vite, SQLite com migrations versionadas, preload restrito e preparação para NSIS Windows.

### 02 — Utilidades ArtiSys ✅
`utilidades` entra como submódulo fixado em commit conhecido. Integrados: Desktop Shell, EventBus, Dashboard, PDF, Printing, Finance Domain, QA, Security e Release. QA/segurança/release permanecem **opt-in**.

### 03 — Autenticação e permissões ✅
Administrador local, `scrypt` + salt, sessões locais, perfis `ADMIN`, `FINANCE`, `MANAGER`, `READONLY`, RBAC no processo principal e auditoria.

### 04 — Núcleo financeiro ✅
Contas financeiras, pagar/receber, baixas parciais/totais, estorno, cancelamento sem apagar histórico, vencidos e resumos.

### 05 — Cadastros ✅
Clientes, credores/fornecedores, categorias de receita/despesa e grupos DRE.

### 06 — Fluxo de caixa ✅
Movimentos manuais, transferências atômicas, baixas integradas, saldo por conta e saldo inicial/final do período.

### 07 — DRE e indicadores ✅
DRE realizada/competência, grupos DRE, receitas, despesas, resultado, abertos, vencidos e saldos bancários.

### 08 — Dashboard ✅
Pagar/receber, entradas/saídas, saldo por banco, fluxo mensal, maiores despesas, DRE e seleção de ano.

### 09 — Recorrências ✅
Regras mensais, vencimento configurável, limite/data final, pausa, geração idempotente e vínculo com a origem.

### 10 — Alertas ✅
- contas vencendo hoje e atrasadas;
- alerta de saldo baixo configurável por conta;
- avisos internos com severidade e janela de validade;
- estado lido/oculto por usuário;
- alertas derivados do financeiro, sem duplicar a verdade contábil.

### 11 — Recibos e relatórios ✅
- recibo/comprovante por baixa financeira;
- impressão e PDF locais via Electron;
- relatórios com filtros por período, tipo e status;
- exportação CSV UTF-8 e XLSX real, sem depender do Microsoft Office;
- integração com `artisys-printing` para o contrato de recibos.

### 12 — Backup e recuperação ✅
- backup manual;
- backup automático diário com retenção local;
- SHA-256 e `PRAGMA integrity_check` antes de restaurar;
- cópia automática antes de migrations;
- backup de segurança antes de restore;
- restore substitui o banco somente após validação e reinicia o aplicativo.

Os backups ficam em `app.getPath('userData')/backups` por padrão. Nenhuma nuvem é necessária.

### 13 — LAN opcional ✅
- servidor HTTP local usando apenas `node:http`;
- **desativado por padrão**;
- opção para liberar acesso a celular/tablet na mesma rede;
- código de pareamento de 6 dígitos, temporário e de uso único;
- token local armazenado apenas como hash, com expiração;
- interface mobile-first para dashboard, alertas, contas e pagar/receber;
- acesso LAN inicial é predominantemente de leitura, preservando a autoridade do PC principal.

Para acesso pelo celular/tablet, o administrador deve abrir **Sistema → Rede local**, ativar a LAN com escuta `0.0.0.0`, aplicar e gerar um código de pareamento. Use somente em rede local confiável.

### 14 — Polimento final de UI ✅
- navegação acessível e identificadores estáveis para QA;
- foco visível por teclado, estados desabilitados e ações mais consistentes;
- busca em lançamentos, cadastros, recorrências e usuários;
- filtro de status no financeiro e severidade nos alertas;
- cabeçalhos de tabela fixos e rolagem horizontal segura;
- refinamento responsivo para desktop, tablet e celular sem alterar regras financeiras.

### 15 — Gates finais e QA real ✅
- fixture determinística e isolada, ativa apenas com `ARTISYS_QA=1`;
- fluxo Playwright sobre o **Electron real**, não mockups;
- 11 capturas finais nomeadas das telas principais;
- gate local fail-closed para testes, sintaxe Node, TypeScript/Vite, segurança e release;
- empacotamento Windows NSIS executado localmente;
- nenhum GitHub Actions é necessário para o fechamento.

### 16 — Extratos e conciliação determinística ✅
- `artisys-finance-domain` consumido diretamente do submódulo `utilidades`, sem copiar o motor para o produto;
- CSV, OFX, PDF com texto extraível e entrada manual convergem para a mesma transação canônica;
- valores normalizados em centavos, direção `credit/debit`, descrição normalizada e conta de origem;
- `sourceFingerprint` impede reimportar a mesma linha do mesmo documento;
- `businessFingerprint` sinaliza similaridade sem apagar pagamentos legítimos repetidos;
- regras determinísticas classificam transações e informam o motivo da decisão;
- prévia obrigatória antes do commit da importação;
- sugestões de transferência entre contas e conciliação com contas a pagar;
- feedback `accepted/rejected/manual` melhora o score determinístico sem IA externa;
- aceitar uma sugestão cria vínculo de conciliação, mas **não gera baixa financeira silenciosa**;
- toda importação e decisão de conciliação é auditada.

A tela **Extratos** permite selecionar conta, fonte, analisar o arquivo, revisar classificação/duplicidades e somente então confirmar a importação. PDF escaneado continua fora do núcleo: OCR será um adapter local opcional, sem virar dependência obrigatória.

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
npm run qa:validate      # valida contrato/configuração QA
npm run qa:final         # abre Electron real e captura telas finais
npm run security         # security gate local
npm run release:check    # gates de release locais
npm run final:prepare    # testes + sintaxe + build + segurança + release
npm run dist:package     # gera NSIS sem repetir o build
npm run final:release    # fechamento completo local
npm run dist             # build + instalador Windows NSIS
```

A execução QA final usa um diretório temporário próprio (`artisys-financeiro-qa`) e uma credencial **exclusivamente de fixture**, sem tocar nos dados reais do usuário. O diretório é apagado somente quando `ARTISYS_QA_RESET=1`.

## Arquitetura atual

```text
CSV / OFX / PDF texto / Manual
            ↓
     Statement Import Service
            ↓
   artisys-finance-domain
 normalização / fingerprint
 regras / conciliação / score
            ↓
     revisão do usuário
            ↓
     SQLite local auditado

Desktop React renderer                   Celular/tablet (opcional)
          ↓                                      ↓
preload IPC restrito                    HTTP LAN pareado
          ↓                                      ↓
IPC + RBAC                          API local read-first
          └──────────────┬───────────────────────┘
                         ↓
Auth / Finance / Registry / Alerts
Cashflow / Analytics / Recurrence / Reports
Statements / Backup / LAN
                         ↓
                  DatabaseService
                         ↓
                    SQLite local

vendor/utilidades
      ↓
Desktop Shell / EventBus / Dashboard / PDF / Printing
Finance Domain / QA / Security / Release (opt-in quando aplicável)
```

O renderer desktop não recebe acesso direto a Node, filesystem ou SQLite. Valores monetários permanecem em centavos inteiros. Mutações financeiras e administrativas são autorizadas no processo principal e auditadas.

## Dados locais

O banco `sistema-financeiro.sqlite` fica em `app.getPath('userData')`. Dados do usuário não são versionados no Git.

## Release final

O release só deve ser considerado homologado depois de `npm run final:release` finalizar com sucesso no Windows e o fluxo `final-screens` gerar as onze evidências PNG do Electron real.
