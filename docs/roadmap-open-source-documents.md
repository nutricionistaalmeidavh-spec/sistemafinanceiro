# Suite open source de documentos e interoperabilidade — execução P0–P3

Estado: **integração funcional P0–P3, sujeita a homologação Windows e limitações abaixo**.

## Regras arquiteturais obrigatórias
- Core R$ 0, offline, sem SaaS, API paga ou suíte Office instalada.
- SQLite é a única fonte canônica; arquivos são projeções/exportações.
- Importação somente via prévia, validação, autorização RBAC, transação e auditoria.
- Dinheiro em centavos inteiros até a fronteira de formatação.
- Não introduzir renderizações reativas ou mutações financeiras por exportação.
- Dependências com licenças open source verificadas e versões fixadas no lockfile.
- Não acessar filesystem diretamente do renderer; usar IPC validado.

## P0 — ExcelJS e Papa Parse
- [x] Integrar ExcelJS para XLSX formatado, várias abas, datas e moeda BRL.
- [x] Validar fórmulas/valores de planilhas e impedir formula injection.
- [x] Integrar Papa Parse em CSV com BOM, aspas, CRLF, delimitadores e arquivos grandes.
- [x] Neutralizar fórmulas na exportação CSV existente, com teste de regressão.
- [ ] Verificar compatibilidade dos arquivos gerados com LibreOffice.
- [ ] Cobrir valores negativos, zero, arredondamento, acentos e 50 mil linhas.

## P1 — docx, Apache ECharts e PDF profissional
- [x] Gerar DOCX editável de relatório financeiro de contas a pagar/receber. Pendentes os modelos DOCX específicos de DRE e fluxo de caixa.
- [x] Usar Apache ECharts em gráficos, sem criar dados financeiros duplicados.
- [x] Gráficos ECharts exibem dados do mesmo snapshot filtrado e totais canônicos (inserção do gráfico como imagem em PDF/DOCX ainda pendente).
- [x] Reutilizar Electron.printToPDF; criar templates paginados, sem PDF engine duplicado.
- [x] Garantir mesma seleção de filtros em PDF, DOCX, XLSX, CSV e interface.

## P2 — Tesseract e pdf-lib
- [x] Integrar Tesseract OCR local e modelo português empacotado offline (somente idioma por nesta entrega; outros idiomas exigem assets adicionais).
- [x] Converter PDF escaneado em imagens localmente antes de OCR, com limites de páginas/tamanho.
- [x] Mostrar texto extraído e confiança no OCR, sempre pendente de revisão; correção pós-OCR no mesmo anexo ainda pendente.
- [x] Usar pdf-lib para metadados e união de PDFs; preenchimento de formulários existente ainda pendente.
- [x] Importar XLSX por aliases de colunas, preview, idempotência e auditoria; mapeamento manual ainda pendente.

## P3 — interoperabilidade e planilhas controladas
- [x] Grade editável de planejamento isolada dos lançamentos canônicos.
- [x] Templates reutilizáveis de orçamento, previsão, DRE e conciliação.
- [x] Exportar JSON versionado com schema e metadados.
- [x] Exportar pacote ZIP com manifesto SHA-256 e função de validação; não importa dados do ZIP para o banco.
- [ ] ODS, QIF e CNAB: não ativar sem casos concretos, contrato bancário e fixtures de homologação; permanecem opcionais.
- [ ] Medir uso de memória, desempenho e tamanho do instalador.

## Gates para conclusão
1. RED/GREEN dos testes unitários e integração; rodar `npm test` e `npm run build`.
2. QA Electron real/Playwright, screenshots, acessibilidade e exportações.
3. Fixture com dados fictícios, inclusive caracteres perigosos e arquivos malformados.
4. Validação de canonicidade: totais idênticos em todos os formatos, nenhum write ao exportar.
5. Security gate, licenças e instalação Windows offline.
6. PR revisada e CI verde antes de merge. Sem release sem homologação.

## Dependências alvo
- `exceljs` (MIT)
- `papaparse` (MIT)
- `docx` (MIT)
- `echarts` (Apache-2.0)
- `pdf-lib` (MIT)
- `tesseract.js` (Apache-2.0; conferir dados de idioma e assets locais)

## Entregas desta PR
- ExcelJS: lançamentos, resumo, DRE, orçamento, comparativo, projeção e modelo vazio de conciliação.
- Papa Parse: CSV multilinhas e limites de importação 12 MB/50 mil linhas.
- DOCX financeiro, ECharts na tela Relatórios, pdf-lib para PDF e união local.
- Tesseract OCR português sem serviços externos, leitura de imagem e PDF escaneado com limites.
- Importação XLSX com prévia, rejeição de fórmulas, idempotência e trilha de auditoria.
- JSON e ZIP de relatórios com manifesto e verificador SHA-256; grade de orçamentos editável.
- O enum legado de origem do banco ainda guarda XLSX como MANUAL; a prévia e a auditoria registram XLSX corretamente. Migração segura do enum requer escopo separado.

## O que não afirmar como homologado
- Compatibilidade externa LibreOffice, 50 mil linhas, métricas de memória e tamanho do instalador só após validação específica.
- Editor pós-OCR, preenchimento de formulários PDF, mapeamento XLSX manual e importação ZIP contábil não estão implementados.
