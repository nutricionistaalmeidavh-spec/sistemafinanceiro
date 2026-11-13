# Suite open source de documentos e interoperabilidade — execução P0–P3

Estado: **parcialmente implementado**. Não marcar itens como concluídos sem testes e evidências.

## Regras arquiteturais obrigatórias
- Core R$ 0, offline, sem SaaS, API paga ou suíte Office instalada.
- SQLite é a única fonte canônica; arquivos são projeções/exportações.
- Importação somente via prévia, validação, autorização RBAC, transação e auditoria.
- Dinheiro em centavos inteiros até a fronteira de formatação.
- Não introduzir renderizações reativas ou mutações financeiras por exportação.
- Dependências com licenças open source verificadas e versões fixadas no lockfile.
- Não acessar filesystem diretamente do renderer; usar IPC validado.

## P0 — ExcelJS e Papa Parse
- [ ] Integrar ExcelJS para XLSX formatado, várias abas, datas e moeda BRL.
- [ ] Validar fórmulas/valores de planilhas e impedir formula injection.
- [ ] Integrar Papa Parse em CSV com BOM, aspas, CRLF, delimitadores e arquivos grandes.
- [x] Neutralizar fórmulas na exportação CSV existente, com teste de regressão.
- [ ] Verificar compatibilidade dos arquivos gerados com LibreOffice.
- [ ] Cobrir valores negativos, zero, arredondamento, acentos e 50 mil linhas.

## P1 — docx, Apache ECharts e PDF profissional
- [ ] Gerar DOCX editável de DRE, fluxo de caixa, contas a pagar/receber.
- [ ] Usar Apache ECharts em gráficos, sem criar dados financeiros duplicados.
- [ ] Exportar gráficos e totais usando o mesmo snapshot canônico.
- [ ] Reutilizar Electron.printToPDF; criar templates paginados, sem PDF engine duplicado.
- [ ] Garantir mesma seleção de filtros em PDF, DOCX, XLSX, CSV e interface.

## P2 — Tesseract e pdf-lib
- [ ] Integrar Tesseract OCR local com empacotamento offline e idiomas configuráveis.
- [ ] Converter PDF escaneado em imagens localmente antes de OCR, com limites de páginas/tamanho.
- [ ] Mostrar texto extraído, confiança e correção manual antes de qualquer lançamento.
- [ ] Usar pdf-lib para preencher, unir e anotar modelos PDF existentes.
- [ ] Importar XLSX com mapeamento de colunas, preview, idempotência e auditoria.

## P3 — interoperabilidade e planilhas controladas
- [ ] Grade editável de planejamento isolada dos lançamentos canônicos.
- [ ] Templates reutilizáveis de orçamento, previsão, DRE e conciliação.
- [ ] Exportar JSON versionado com schema e metadados.
- [ ] Exportar pacote ZIP com manifesto SHA-256 e validação.
- [ ] Avaliar ODS, QIF e CNAB por necessidade real, com fixtures específicas.
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
