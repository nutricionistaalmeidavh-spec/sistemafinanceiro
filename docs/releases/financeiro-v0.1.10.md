# ArtiSys Financeiro v0.1.10 — Centros de custo integrados

Atualização do instalador único Windows, com gestão de centros de custo incorporada às operações financeiras.

## O que mudou
- **Cadastros → Centros de custo:** crie, edite, organize centros hierárquicos, desative ou reative cadastros, preservando o histórico.
- **Pagar / Receber:** escolha um centro de custo no próprio lançamento ou distribua por percentuais (rateio), inclusive na edição.
- **Recorrências:** os percentuais configurados podem acompanhar as parcelas futuras, com valores conciliados em centavos.
- **Relatórios → Centros de custo:** acompanhe receitas, despesas, resultado, valores baixados e em aberto; lançamentos sem centro ficam identificados separadamente.
- **Planejamento:** orçamentos, metas, tags, anexos e aprovações permanecem disponíveis, sem um segundo formulário de manutenção de centros.

## Integridade e compatibilidade
- Os rateios usam um único normalizador canônico e gravação transacional em SQLite local.
- A migração 014 acrescenta configuração de rateio às regras recorrentes, sem apagar parcelas, lançamentos, históricos ou configurações anteriores.
- Mantidos o mesmo appId, instalador comercial único, ativação existente e fluxo de atualização opcional pelo GitHub.
- Não existe dependência obrigatória de SaaS pago: o núcleo é local-first e open source.

## Instalação
Baixe o `ArtiSys-Financeiro-Setup-0.1.10.exe` ou escolha atualizar pelo aplicativo. O instalador pode ser aplicado por cima do sistema atual. **Faça um backup local recente antes da atualização** e mantenha o aplicativo fechado durante a instalação.
