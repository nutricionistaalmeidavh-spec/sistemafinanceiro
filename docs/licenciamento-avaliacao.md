# ArtiSys Financeiro — licença e instalador únicos

## Distribuição

Há somente um instalador Windows NSIS: `ArtiSys-Financeiro-Setup-<versao>.exe` e uma release estável `financeiro-v<versao>`.
O `appId` interno é `br.com.artisys.sistemafinanceiro.trial`, preservado da edição de avaliação original **exclusivamente** para que o Windows/NSIS reconheça a instalação existente como o mesmo produto. Isso não cria edição separada: a identidade visível permanece **ArtiSys Financeiro**, e todas as licenças usam o mesmo aplicativo. O `appId`/GUID não deve ser alterado em novas versões.
A publicação exige autorização explícita na `main` pelo workflow `.github/workflows/financeiro-release.yml` (comando manual ou commit de publicação marcado), após testes, build e QA real. Um código é obrigatório para **qualquer usuário**.

## Geração de códigos sem recompilar

O emissor usa Node.js 22+, Ed25519, scrypt e AES-256-GCM. A chave privada deve estar fora do repositório e corresponder à chave pública instalada em `electron/services/license-public.pem`.

```bash
node scripts/issue-license.mjs \
  --private-key /seguro/issuer-private.pem \
  --customer "Cliente" \
  --type TRIAL \
  --days 14 \
  --out-code /seguro/codigo-do-cliente.txt
```

Tipos: `TRIAL` por 1 a 14 dias, `TERM` por N dias (por exemplo `--days 365`) e `PERPETUAL` sem vencimento. Todos usam o mesmo instalador.

O emissor cria um código `XXXX-XXXX-XXXX-XXXX` fora do repositório e acrescenta um registro criptografado, indexado pelo SHA-256 do código, ao arquivo `licenses/catalog.json`. O catálogo não contém códigos nem nomes de clientes em claro.

**Depois de emitir, publique a atualização de `licenses/catalog.json` na branch `main`.** Não é necessário publicar uma nova release ou recompilar o instalador para cada cliente.

A primeira ativação requer internet para consultar o catálogo HTTPS público e decifrar o entitlement com o código informado. A assinatura Ed25519 é verificada localmente. A partir daí, a licença é persistida no diretório privado `userData`, e o financeiro funciona sem internet.

Não copie a chave privada ao GitHub, ao instalador nem ao catálogo. Se a chave privada correspondente à chave pública existente tiver sido perdida, planeje a rotação da chave pública antes de emitir licenças novas.

## Rotação de chave de emissão (v0.1.5)

Uma chave privada antiga não recuperada foi substituída por um novo par Ed25519. O app confia na **chave pública primária nova** para códigos emitidos daqui em diante e na **chave pública anterior** apenas para preservar licenças já instaladas e assinadas. A versão v0.1.4 e anteriores não conseguem ativar códigos emitidos com a chave nova; precisam atualizar primeiro para v0.1.5. A validade original das licenças anteriores não é alterada.

A chave privada nova é material confidencial **externo ao GitHub**; deve ser guardada com backup seguro pelo titular. Nunca publique a chave privada no repositório, no catálogo nem em Actions/artifacts públicos. As atualizações de catálogo mantêm apenas dados cifrados por código.

## Atualização

O aplicativo instalado consulta `latest.yml` das GitHub Releases estáveis ao iniciar. Havendo uma versão superior, mostra **Baixar atualização** e **Agora não**. O usuário pode baixar, validar o pacote pelo SHA-512 e escolher **Instalar e reiniciar**. Nenhuma instalação silenciosa é feita. O núcleo não usa serviços pagos ou SaaS.

A versão 0.1.3 é a primeira com verificador de atualizações. Instalações anteriores precisam atualizar manualmente uma única vez.

## Preservação de dados

O banco SQLite, as configurações, o Workspace e a licença residem em `userData`, não na pasta de instalação NSIS. Ao atualizar, permanecem no mesmo local.

Na v0.1.4 o instalador mantém o GUID NSIS da avaliação v0.1.0. Feche o aplicativo antigo e execute o novo instalador diretamente, sem desinstalar primeiro. O Windows deve reconhecer o mesmo produto e substituí-lo. A troca do nome visível altera o perfil `userData`; se o banco unificado ainda não existe, no primeiro início o aplicativo copia banco SQLite, arquivos, backups e licença do diretório `ArtiSys Financeiro - Avaliacao`, sem apagar a origem. A licença temporária já ativada mantém a data de expiração original.

Instalações da v0.1.3 (que usavam outro `appId`) podem manter o registro antigo de instalação no Windows; os dados têm o mesmo perfil canônico `ArtiSys Financeiro`, mas o NSIS não reconhece o outro GUID como o mesmo instalador. Se o banco unificado já existe, ele nunca é sobrescrito automaticamente; faça migração manual caso tenha dados em ambas as edições.

Códigos legados já ativados podem continuar válidos pela licença assinada migrada. Códigos curtos antigos ainda não ativados, criados para instaladores personalizados, talvez precisem ser reemitidos.

## Limites de segurança

Códigos podem ser compartilhados; a validação offline não impõe vínculo rígido a dispositivo ou revogação imediata. Um executável desktop pode sofrer engenharia reversa. Proteção avançada requer assinatura de código e política de distribuição apropriada.

Core local e open source, com custo obrigatório de software de **R$ 0**.
