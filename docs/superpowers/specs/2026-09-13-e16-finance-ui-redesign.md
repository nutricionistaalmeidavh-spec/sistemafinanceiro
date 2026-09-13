# E16 — Finance UI Redesign

## Objetivo

Elevar a percepção visual e a usabilidade do ArtiSys Financeiro sem alterar regras financeiras, persistência, contratos IPC ou comportamento de negócio. A mudança deve permanecer local-first, compatível com Electron/Windows e preservar os fluxos já homologados em E01–E15.

## Referências internas

A implementação deve reutilizar padrões já catalogados em `nutricionistaalmeidavh-spec/frontEnds`, especialmente:

- `library/clinic-ui-kit`: hierarquia de botões, `MetricCard`, `StatusBadge`, `TableToolbar`, `EmptyState`, ações de linha e tokens de spacing/radius;
- `layouts/fluxo-dre`: densidade de telas financeiras;
- `layouts/clinicas-medicas`: shell, workspace e toolbar operacional;
- `layouts/pdv-nexus`: clareza de fluxo e ações frequentes.

O código final continua pertencendo ao `sistemafinanceiro`; o repositório `frontEnds` é referência visual, não dependência de runtime.

## Escopo

### 1. Finance UI Kit interno

Criar componentes reutilizáveis em `src/ui/finance/` com API simples e sem dependência de backend:

- `FinanceButton`
- `FinanceMetricCard`
- `FinanceStatusBadge`
- `FinanceTableToolbar`
- `FinanceEmptyState`
- `FinanceDrawer`
- `FinanceSectionHeader`

Estados semânticos:

- success: pago/recebido/positivo
- warning: parcial/atenção
- danger: vencido/erro real
- info: informativo
- neutral: estado comum

### 2. Shell principal

Reorganizar a navegação lateral sem alterar os `data-testid` atuais usados pelo QA.

Grupos visuais:

- Visão geral: Dashboard, Alertas
- Financeiro: Fluxo de Caixa, Pagar / Receber, DRE, Relatórios, Recorrências
- Dados: Cadastros
- Administração: Acessos, Sistema

Desktop:

- sidebar aberta: 248 px
- sidebar recolhida: 72 px
- conteúdo fluido até 1600 px

Mobile:

- sidebar vira drawer de navegação
- não usar barra horizontal longa
- CTA principal permanece acessível

### 3. Dashboard

Reordenar o conteúdo por prioridade operacional.

Primeira linha:

- Saldo disponível
- A receber
- A pagar
- Resultado do mês

Faixa de atenção:

- vencidas
- vencendo hoje
- contas abaixo de limite

Área principal:

- fluxo de caixa mensal com maior peso visual
- saldo por conta em painel lateral

Área inferior:

- próximos vencimentos
- maiores despesas
- DRE resumida

Não criar métricas novas no backend. Tudo deve derivar dos dados já retornados pelas APIs atuais.

### 4. Pagar / Receber

Remover o formulário permanente da área principal.

A barra superior deve conter:

- busca à esquerda
- filtros compactos
- botão principal `Novo lançamento`

`Novo lançamento` abre `FinanceDrawer` à direita com os mesmos campos e a mesma chamada de API existente.

A tabela deve continuar suportando:

- baixa parcial/total
- cancelamento
- estorno quando aplicável
- recibo
- filtros atuais

Quando houver mais de duas ações de linha, usar menu contextual visual sem remover os handlers existentes.

### 5. Fluxo de Caixa, DRE e Relatórios

Aplicar o mesmo sistema visual:

- `FinanceSectionHeader`
- `FinanceMetricCard`
- `FinanceTableToolbar`
- tabelas com densidade moderada
- estados vazios explícitos
- filtros agrupados

Gráficos permanecem com a implementação atual nesta entrega; E16 não adiciona nova biblioteca de gráficos.

### 6. Cadastros, Recorrências, Alertas, Acessos e Sistema

Padronizar cabeçalhos, toolbars, cards, badges, estados vazios e responsividade.

Não alterar regras de acesso, backup, LAN, recorrência ou alertas.

### 7. Visual

Direção:

- fundo cinza muito claro
- cards brancos
- borda discreta
- sombra mínima
- roxo reservado para CTA, item ativo e gráfico principal
- verde/amarelo/vermelho apenas para semântica de estado
- sem glassmorphism
- sem gradientes decorativos
- sem animações contínuas

Motion permitido apenas para:

- abertura/fechamento de drawer
- troca de tabs
- feedback de salvar
- mudanças de contexto

### 8. Compatibilidade e acessibilidade

Preservar:

- todos os `data-testid` usados pelo QA final
- `aria-current` da navegação
- focus-visible
- navegação por teclado
- responsividade a partir de 320 px

Botões destrutivos devem permanecer semanticamente distintos.

## Arquivos esperados

Criar:

- `src/ui/finance/FinanceButton.tsx`
- `src/ui/finance/FinanceMetricCard.tsx`
- `src/ui/finance/FinanceStatusBadge.tsx`
- `src/ui/finance/FinanceTableToolbar.tsx`
- `src/ui/finance/FinanceEmptyState.tsx`
- `src/ui/finance/FinanceDrawer.tsx`
- `src/ui/finance/FinanceSectionHeader.tsx`
- `src/ui/finance/index.ts`
- `src/finance-ui.css`
- `tests/e16-finance-ui.test.mjs`

Modificar:

- `src/App.tsx`
- `src/main.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/CashFlowPage.tsx`
- `src/pages/DrePage.tsx`
- `src/pages/ReportsPage.tsx`
- `src/pages/RecurringPage.tsx`
- `src/pages/RegistryPage.tsx`
- `src/pages/AlertsPage.tsx`
- `src/pages/UsersPage.tsx`
- `src/pages/SystemPage.tsx`
- `qa/flows/final-screens.json` apenas se seletores visuais precisarem de espera adicional, nunca para reduzir cobertura

## Não escopo

- mudanças de banco de dados
- migrations
- mudanças de serviços Electron
- mudanças em regras financeiras
- integração bancária
- emissão fiscal
- nova biblioteca de gráficos
- alterações em backup/LAN/RBAC
- dependência runtime do repositório `frontEnds`

## Estratégia de testes

1. Teste de contrato E16 deve falhar antes da implementação e verificar a presença dos componentes compartilhados, agrupamento da sidebar, drawer de lançamento e preservação dos test IDs.
2. Rodar `npm test`.
3. Rodar `npm run build`.
4. Rodar `npm run security` e `npm run release:check`.
5. Rodar o fluxo real de screenshots Electron no Windows.
6. Comparar visualmente Dashboard, Pagar/Receber, Fluxo de Caixa, DRE, Relatórios e mobile shell.
7. Somente após todos os gates verdes, mergear em `main`.

## Critérios de aceite

E16 está concluída quando:

- nenhum teste financeiro existente regride;
- nenhum contrato IPC é alterado;
- o formulário de novo lançamento abre em drawer;
- a navegação lateral está agrupada e responsiva;
- as telas usam componentes visuais compartilhados;
- os 10 fluxos de QA final continuam navegáveis pelos mesmos test IDs;
- build, security e release gates passam;
- screenshots reais do app empacotado confirmam a nova UI;
- `main` recebe apenas o resultado já homologado.
