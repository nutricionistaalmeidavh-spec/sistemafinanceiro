# E06–E09 Finance & Analytics Design

## Objetivo
Entregar fluxo de caixa, DRE/indicadores, dashboard financeiro e recorrências sem alterar a arquitetura local-first atual nem introduzir serviço externo obrigatório.

## E06 — Fluxo de caixa
- Cada baixa financeira aceita/resolve uma `account_id` e alimenta o livro-caixa por conta.
- Movimentos manuais são permitidos para abertura, aporte, retirada, transferência e ajuste, com auditoria.
- Saldo por conta = saldo de abertura + movimentos manuais + liquidações de recebíveis - liquidações de pagáveis, considerando estornos.
- Transferências são atômicas e geram duas pernas com o mesmo `transfer_id`.

## E07 — DRE e indicadores
- Competência principal: `due_at` para aberto e `occurred_at` para realizado.
- Categorias financeiras já carregam `nature` e `dre_group`.
- DRE mensal agrega receitas, despesas e resultado por grupo.
- Indicadores: recebido, pago, aberto a receber, aberto a pagar, atrasado, saldo bancário e resultado do período.

## E08 — Dashboard
- Um serviço único retorna cards, saldos por conta, série mensal de entradas/saídas e maiores despesas.
- UI React consome esse snapshot sem fazer cálculo financeiro no renderer.
- Dashboard permanece responsivo e sem dependência de SaaS.

## E09 — Recorrências
- Modelo `recurring_rules` com frequência mensal, data de início, fim opcional, dia de vencimento e template financeiro.
- `generateDue(asOf)` gera lançamentos até a data de referência de forma idempotente usando `recurrence_key` única.
- Regra pode ser pausada sem apagar lançamentos já gerados.
- Parcelamentos simples são representados por número máximo de ocorrências.

## Segurança e consistência
- Todas as mutações passam por RBAC e audit log existentes.
- Nenhum cálculo financeiro crítico fica no renderer.
- Operações multi-registro usam `BEGIN IMMEDIATE`.
- Valores monetários permanecem em centavos inteiros.

## Infraestrutura
Core obrigatório: R$ 0, local, SQLite, Electron/React e módulos open source já presentes. Nenhum serviço pago é dependência de runtime.
