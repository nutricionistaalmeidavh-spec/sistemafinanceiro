# Entregas 18–24 — Sistema Financeiro

Status: **implementadas** em `feature/finance-18-24`.

## 18 — Centros de custo, tags e rateios
- centros de custo hierárquicos;
- tags financeiras;
- rateio múltiplo por percentual/valor com fechamento exato em centavos;
- filtros por centro/tag em Relatórios e DRE;
- exportações exibem centros e tags.

## 19 — Orçamento e metas
- orçamento mensal por cenário, natureza, categoria e centro de custo;
- metas por receita, despesa, saldo ou resultado;
- persistência SQLite local.

## 20 — Previsto x realizado e cenários
- comparação planejado, realizado, comprometido e projetado;
- cenários Base, Otimista, Pessimista e Customizado;
- nenhuma IA ou serviço externo obrigatório.

## 21 — Anexos e OCR local opcional
- vínculo de documentos do Workspace aos lançamentos;
- texto extraído armazenado separadamente e sujeito a revisão;
- adapter `@artisys/ocr` com Tesseract local opcional;
- OCR não altera valor, data, categoria ou baixa automaticamente.

## 22 — Aprovações
- políticas por valor mínimo;
- quantidade configurável de aprovações;
- papéis autorizados;
- histórico de decisões e auditoria.

## 23 — Operações em lote
- categoria, tag, centro de custo e solicitação de aprovação;
- seleção validada antes da mutação;
- transação SQLite atômica: erro em um item impede aplicação parcial.

## 24 — Projeção e what-if
- projeção por saldo atual, contas abertas e recorrências;
- horizonte configurável;
- ajustes positivos/negativos de cenário;
- simulação não cria lançamentos reais.

## Arquitetura e custo
O núcleo permanece **R$ 0 / self-hosted / open source / local-first**. Integrações pagas não são necessárias. O OCR depende apenas de ferramenta local opcional quando ativado.

## Validação adicionada
- migrations 001→006;
- rateios e arredondamento em centavos;
- projeção what-if sem mutação;
- lote atômico;
- aprovações em múltiplas etapas;
- segurança de caminhos do OCR;
- permissões IPC;
- integração SQLite de planejamento;
- filtros por centro/tag em relatórios e DRE.

O gate de release continua sendo `npm run final:release` no Windows para homologação do instalador e capturas Electron reais.