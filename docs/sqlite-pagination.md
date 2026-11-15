# SQLite: paginação sem cotas de registros

## Princípios

Esta mudança não impõe limite de quantidade de leads, oportunidades, clientes, credores, tarefas ou lançamentos.
O limite padrão de 100 registros e máximo de 200 por resposta IPC controla somente o tamanho de cada página.
O cursor seguinte permite recuperar registros adicionais sem carregar o banco completo na interface.
Regras de integridade, tamanhos de campos e permissões continuam aplicáveis.

## Tabelas e índices

A migração database/migrations/013_unbounded_paging_indexes.sql adiciona índices compostos de ordenação, filtros, lançamentos e baixas.
É uma migração aditiva: nenhuma tabela canônica é substituída, apagada ou recriada.
DatabaseService mantém SQLite WAL, foreign_keys e busy_timeout, realiza backup pré-migração e atualiza estatísticas com PRAGMA optimize.

## Como consultar

| Área | Ordenação estável | API |
| --- | --- | --- |
| Leads | updated_at DESC, id DESC | crm:leads:page |
| Oportunidades | updated_at DESC, id DESC | crm:opportunities:page |
| Tarefas | vencimento, criação e id | crm:tasks:page |
| Lançamentos | due_at, id | finance:entries:page |
| Clientes e credores | nome NOCASE, id | registry:*:page |

O cursor é vinculado aos filtros atuais. Alterar filtros reinicia a paginação.
Se outro usuário alterar registros durante a navegação, uma nova pesquisa atualiza a lista; o cursor não mantém transação de leitura aberta.
Os totais do funil vêm de SUM e COUNT no SQLite, não da lista parcial renderizada.
Os status financeiros são derivados das baixas no instante as-of, inclusive em páginas com filtro de status.

## CSV grande

O arquivo é processado progressivamente com PapaParse e lotes de 500 registros.
Não há limite de 2 MB ou 5.000 linhas para importação, mas ainda valem as validações e a deduplicação de contatos.
Cada lote confirmado é transacionado e auditado; se uma etapa futura falhar, os lotes anteriores permanecem salvos e o progresso é exibido.

## Performance e limites técnicos reais

Não há serviço pago. Banco e importação utilizam componentes locais/open source.
A paginação evita consumo de memória linear na quantidade total de registros exibidos.
Buscas por trecho de texto com INSTR e LOWER ainda podem fazer varredura de candidatos em datasets gigantes; caso as métricas indiquem gargalo, avaliar FTS5 do próprio SQLite em uma migração separada, mantendo a tabela original como única fonte canônica.
Limites físicos permanecem: espaço em disco, memória disponível e limites do SQLite. Nenhum sistema oferece armazenamento literalmente infinito.

## QA

Validar npm test, npm run build, QA Windows Electron com 12 capturas e matriz sintética de 100, 1.000 e 10.000 lançamentos.
Há testes com mais de 5.000 leads, navegação sem perdas, centenas de clientes e tarefas e estados financeiros históricos.
