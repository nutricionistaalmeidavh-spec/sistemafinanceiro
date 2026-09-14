# Financeiro — Entregas 18 a 24

## Objetivo
Evoluir o sistema financeiro local-first com centros de custo/rateio, orçamentos/metas, previsto x realizado/cenários, anexos/OCR, aprovações, operações em lote e projeções, sem serviço pago obrigatório.

## Princípios
- Core R$ 0, self-hosted/local-first, sem dependência silenciosa de SaaS.
- Valores monetários em centavos inteiros.
- Sem apagar histórico financeiro; alterações sensíveis auditadas.
- Reaproveitar utilidades existentes quando aplicável.
- Novos recursos ficam isolados do núcleo atual para reduzir regressões.

## 18 — Centros de custo, tags e rateio
Criar centros de custo hierárquicos e tags. Um lançamento pode ter vários rateios. A soma dos rateios deve ser exatamente igual ao valor absoluto do lançamento; percentuais são apenas forma de entrada e são convertidos para centavos, com ajuste determinístico do resíduo no último item.

## 19 — Orçamentos e metas
Criar orçamento mensal/anual por categoria e/ou centro de custo. Metas podem ser de receita, despesa, saldo ou resultado. Orçamentos são versionáveis por cenário.

## 20 — Previsto x realizado e cenários
Comparar orçamento com realizado e compromissos em aberto. Cenários: base, otimista e pessimista; usuário também pode criar cenários próprios. Nenhuma projeção altera lançamentos reais.

## 21 — Anexos e OCR
Vincular arquivos a lançamentos e contas a pagar/receber usando o Workspace local. OCR é opcional/local; texto extraído serve como sugestão e nunca altera valores automaticamente sem confirmação.

## 22 — Aprovações
Contas/lotes podem exigir aprovação por regra de valor. Consumir o contrato do `artisys-approvals` quando disponível; persistência e políticas permanecem no produto. Pagamento/baixa continua explícito mesmo depois da aprovação.

## 23 — Operações em lote
Permitir classificar, aplicar tags, centro de custo/rateio simples, aprovar e marcar seleção de lançamentos. A operação valida todos os itens antes do commit e roda em transação atômica.

## 24 — Projeções e what-if
Motor local de projeção de caixa baseado em saldo atual, recorrências, contas abertas e ajustes de cenário. What-if aceita impactos adicionais pontuais ou recorrentes sem persistir lançamentos reais.

## UI
Adicionar área `Planejamento` com abas: Centros de custo, Orçamentos, Cenários, Aprovações e Projeções. Financeiro e Relatórios recebem filtros e atalhos para tags, rateios e anexos.

## Persistência
Uma migration nova cria tabelas de centros de custo, rateios, tags, vínculos, orçamentos, metas, cenários, anexos e aprovações. Operações em lote reutilizam as entidades existentes e não duplicam lançamentos.

## Segurança e auditoria
Somente perfis autorizados podem alterar orçamento, aprovar ou executar ações em lote. Toda mutação relevante gera evento de auditoria com actor, entidade e metadados mínimos.

## Testes
Adicionar testes de schema e serviço para fechamento de rateio, orçamento x realizado, cenários, aprovação, lote atômico e projeção determinística. Build TypeScript e sintaxe Node permanecem gates obrigatórios.