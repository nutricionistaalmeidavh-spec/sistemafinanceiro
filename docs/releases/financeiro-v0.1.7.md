# ArtiSys Financeiro v0.1.7 — SQLite escalável e CRM sem cotas artificiais

Atualização oficial do instalador único do **ArtiSys Financeiro** para Windows, compatível com usuários que já têm o sistema instalado e ativado.

## Banco e desempenho
- Migração aditiva SQLite 013: índices compostos para consultas do Financeiro, CRM e Cadastros.
- Paginação por cursor: carregamento em lotes de até 100 registros por padrão, sem restringir o número total de cadastros.
- Busca e filtros executados pelo SQLite, incluindo leads, oportunidades, tarefas, clientes, credores e lançamentos.
- Totais do funil calculados por consultas agregadas canônicas; saldos e status dos lançamentos respeitam baixas e datas históricas.
- Otimização de consultas por status e preservação dos dados existentes.

## CRM e importação
- Sem limite artificial de quantidade de leads salvos.
- Importação de CSV processada progressivamente em lotes de 500 linhas, sem teto de 2 MB ou 5.000 linhas.
- Busca de contatos e oportunidades cadastradas anteriormente, independentemente de quantas páginas existam.
- Propostas e oportunidades preservadas, com recebíveis gerados **somente mediante confirmação explícita** do usuário.

## Compatibilidade e segurança
- Mesmo aplicativo, identidade de instalação e **códigos de ativação existentes**.
- O instalador novo atualiza por cima da versão anterior, sem criar edição ou canal paralelo.
- O banco mantém backup pré-migração, integridade referencial e motor financeiro canônico.
- Ao abrir o sistema instalado, o aplicativo pode oferecer a atualização; o download e a instalação dependem da escolha do usuário.
- Banco local e ferramentas open source, sem serviço pago obrigatório.

## Instalação
Baixe o arquivo **ArtiSys-Financeiro-Setup-0.1.7.exe** desta release ou aceite a atualização sugerida dentro do aplicativo.

Antes de atualizar uma instalação com informações reais, mantenha um backup local recente. Em especial, não exclua a pasta de dados do usuário durante a instalação.
