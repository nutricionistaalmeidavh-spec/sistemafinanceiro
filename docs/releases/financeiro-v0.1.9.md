# ArtiSys Financeiro v0.1.9 — Instalador otimizado

Atualização do instalador único Windows, sem custo de infraestrutura obrigatório.

## Redução mensurada no GitHub Actions
- Instalador NSIS: de 160,35 MiB para **141,41 MiB** no ensaio de otimização (−18,94 MiB, −11,8%).
- `app.asar`: de 253,62 MiB para 159,02 MiB (−94,60 MiB).
- Aplicativo descompactado: de 643,99 MiB para 549,39 MiB.
- Removidas apenas as cópias de bibliotecas de interface já incorporadas ao bundle Vite: React, React DOM, Lucide, ECharts, ZRender e Scheduler.
- Removida a segunda cópia do modelo OCR português: `por.traineddata.gz` segue disponível offline em `resources/ocr-data`.
- Preservados PDF.js, Tesseract Core, Canvas, ExcelJS, DOCX, PDF-lib e fontes necessárias ao processo principal.

## Integridade e compatibilidade
- Identidade de aplicativo, nome, fluxo de ativação e licenças existentes **não alterados**.
- Banco SQLite, migrações, CRM, documentos, importações e atualização opcional preservados.
- QA Windows, documentos, finanças canônicas e carga sintética aprovados no código da otimização.
- Relatório detalhado e verificações contra exclusões indevidas integrados ao GitHub Actions.

## Instalação
Instale o `ArtiSys-Financeiro-Setup-0.1.9.exe` por cima ou aceite a atualização opcional dentro do sistema. Faça um backup local recente antes de atualizar dados reais.
