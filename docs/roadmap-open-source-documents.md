# ArtiSys Financeiro — Suíte documental e interoperabilidade P0–P3

## Contrato da entrega

- **Core 100% local e gratuito:** Electron, SQLite, bibliotecas open source, sem conta SaaS, licença de escritório ou API paga.
- **Fonte canônica exclusiva:** lançamentos, saldos, DRE, conciliação e orçamentos vêm do SQLite. Arquivos exportados são projeções.
- **Revisão humana antes de mutações financeiras:** arquivos bancários geram prévia, regras, duplicidade e validação; importação exige permissão, confirmação, transação e auditoria.
- **Permissões:** IPC autorizado para exportação, OCR, preenchimento de PDF e importação. Nenhum secret ou variável de produção é alterado.
- **Moeda:** centavos inteiros seguros e importação decimal exata (sem arredondar frações indevidas).

## P0 — Excel e CSV

- XLSX formatado com ExcelJS, abas Resumo/Lançamentos, cabeçalho congelado, filtros e formatação de moeda BRL.
- CSV com Papa Parse (BOM, aspas, quebra de linha, separadores), limites de 12 MB e 50 mil linhas, além de prevenção de CSV formula injection.
- Importação XLSX com leitura de cabeçalhos, mapeamento manual (data, descrição, valor, direção, débito e crédito), bloqueio de fórmulas, prévia, deduplicação e commit explícito.

## P1 — Word, PDF e gráficos

- DOCX editável para relatório de contas a pagar/receber, DRE e fluxo de caixa.
- PDFs dos mesmos relatórios usando `Electron.printToPDF`, com gráficos embutidos e dados do mesmo snapshot canônico, sem duplicar cálculos.
- Gráficos interativos Apache ECharts em Relatórios.
- Preenchimento local de formulários PDF (texto, caixas de seleção, listas e opções), com verificação de integridade do original e caracteres Unicode via fontes locais do sistema e `@pdf-lib/fontkit`.
- União de PDFs locais com `pdf-lib`.

## P2 — OCR e importação

- OCR offline de imagens e PDF escaneado: `tesseract.js` com modelo português embutido e `pdfjs-dist` + `@napi-rs/canvas`.
- Texto extraído pode ser corrigido na tela, com log auditável e hashes do antes/depois. Confirmar revisão é ação separada, nunca cria pagamento.
- Confiança e provedor de OCR persistidos no SQLite (migração 009).
- QIF de transações bancárias com prévia e deduplicação; ODS com leitura, mapeamento de colunas e exportação.
- CNAB 240/400: inspeção de tamanho/estrutura e identificação de banco sem criar lançamentos. Remessa/retorno CNAB não constitui extrato bancário genérico; importação financeira específica depende de homologação por banco e convênio.

## P3 — Planilha controlada, templates e pacotes

- Planilha de orçamento editável com salvar explícito via serviço de planejamento já auditado.
- Templates Excel para orçamento, planejado × realizado, projeção, conciliação e DRE.
- Relatórios em CSV, XLSX, ODS, DOCX, PDF, JSON versionado e ZIP com manifesto SHA-256.
- Importação de ZIP como **arquivo de referência auditável**, com prévia e validação de hashes/totalizadores; não restaura nem duplica lançamentos financeiros.
- Persistência da origem real de extratos XLSX/ODS/QIF em `bank_import_batches.original_source_type`, preservando compatibilidade com o campo legado.

## Garantias e limites operacionais

- Exportação não altera dados financeiros.
- Todas as importações de extrato exigem prévia/commit explícitos; planilhas com fórmula são rejeitadas.
- OCR local usa idioma português; múltiplos idiomas adicionais requerem novos modelos, não nuvem.
- PDF OCR limitado a 10 páginas / 15 MB / 5 milhões de pixels por página.
- DOCX por arquivo limitado a 5 mil linhas; XLSX/ODS/CSV e importação de extratos limitados a 50 mil linhas conforme módulo.
- Importação de pacotes ZIP é de **consulta/referência**, não restauração de lançamentos. A recuperação financeira canônica deve usar o mecanismo de backup SQLite verificado do sistema.
- CNAB é deliberadamente apenas inspecionado, nunca contabilizado sem contrato/layout homologado; isto evita erro financeiro.

## Validação

- Testes com fixtures fictícias: arredondamento exato, limites, DRE/caixa DOCX/PDF, formulários com acentos, QIF/ODS, CNAB, OCR corrigido, planilha mapeada e ZIP validado.
- `npm test`, `npm run build`, QA de OCR offline e PDF rasterizado no Actions.
- Gate Windows NSIS: QA Electron real, testes, build, instalador e checksum.
- Após os checks ficarem verdes e a PR ser revisada, realizar merge; publicação de release é etapa independente.
