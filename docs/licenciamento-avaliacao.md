# ArtiSys Financeiro — Avaliação Windows

A versão de avaliação é um aplicativo Electron separado do instalador comercial:
- appId: `br.com.artisys.sistemafinanceiro.trial`
- Nome de produto: `ArtiSys Financeiro - Avaliacao`
- Instalador: `ArtiSys-Financeiro-Avaliacao-Setup-0.1.0.exe`

## Licenças (core 100% local e sem custo)

A validação usa **Ed25519** via `node:crypto`, sem servidor, assinatura ou serviços pagos.

O pacote contém somente a chave pública `electron/services/trial-public.pem`. A chave privada de emissão **jamais deve entrar no GitHub, Actions, Drive público ou instalador**.

Para emitir nova licença no equipamento que guarda a chave privada:

```bash
node scripts/issue-trial-license.mjs --private-key /caminho/issuer-private.pem --customer "Nome do cliente" --days 14 --out /caminho/licenca-cliente.txt
```

Envie somente o **conteúdo de `licenca-cliente.txt`** ao cliente. O cliente instala a versão de avaliação, cola o código na tela de ativação e cria seu usuário administrador local.

A licença vale por até 14 dias a contar **da emissão**, não do primeiro uso. O aplicativo bloqueia a UI, IPC e rotas LAN após a expiração. Os dados SQLite permanecem preservados no `userData` da versão de avaliação.

**Limitações de modelo offline:** A mesma licença pode ser ativada em mais de um computador se for compartilhada. O estado de relógio local é uma proteção básica contra retrocesso, não uma proteção absoluta. Quem controla o executável pode modificá-lo. Vinculação forte a uma máquina, revogação e contagem de instalações exigem mecanismos adicionais (por exemplo, um serviço de licenças self-hosted opcional).

## Build

Na branch `feat/financeiro-trial-license` o workflow `ArtiSys Financeiro - Trial Windows` executa testes, TypeScript, empacotamento NSIS e SHA-256. O executável é disponibilizado nos **artifacts do GitHub Actions**, não como uma release comercial.

Não substituir o instalador comercial do Drive por este executável de teste. Não fazer merge da branch sem planejar a transição para licenciamento de produção.
