# ArtiSys Financeiro — licença de avaliação com código curto

## Fluxo para o cliente

1. Baixe o instalador `ArtiSys-Financeiro-Avaliacao-Setup-0.1.0.exe` da pré-release.
2. Instale e abra o aplicativo.
3. Digite o código de **12 caracteres** no formato `XXXX-XXXX-XXXX`.
4. Cadastre o administrador local.

Ativação, uso e validação de prazo funcionam **sem internet**. Não há dependência obrigatória de serviço pago ou hospedagem.

## Arquitetura e segurança

- Emissão local: Node.js `node:crypto` (Ed25519, scrypt, AES-256-GCM).
- A chave privada do emissor fica exclusivamente com a ArtiSys, fora do repositório.
- O emissor assina o entitlement com Ed25519.
- Um código aleatório de 12 caracteres é gerado por CSPRNG.
- O entitlement assinado é criptografado com AES-256-GCM e uma chave derivada do código via scrypt.
- **Somente o pacote criptografado** `electron/services/trial-activation.bundle.json` é embutido no instalador. Não armazene o código curto nem a chave privada no GitHub.
- Ao ativar, o aplicativo decifra o pacote e verifica a assinatura Ed25519; persiste a licença assinada no diretório privado `userData`.
- O prazo de até 14 dias conta **a partir da emissão**. A UI, os IPCs e as rotas LAN bloqueiam operações após expiração, preservando dados SQLite.

## Emitir uma nova licença e build personalizada

Na máquina segura que guarda `issuer-private.pem`:

```bash
node scripts/issue-trial-license.mjs \
  --private-key /seguro/issuer-private.pem \
  --customer "Nome do cliente" \
  --days 14 \
  --out-code /seguro/codigo-do-cliente.txt \
  --out-bundle electron/services/trial-activation.bundle.json
```

O arquivo `/seguro/codigo-do-cliente.txt` contém somente o código curto. **Nunca envie o PEM nem o entitlement completo ao cliente.** O comando atualiza o pacote criptografado específico do cliente; execute o workflow Windows para gerar novo instalador.

O instalador de cada cliente precisa conter seu próprio pacote. Não reutilize o mesmo instalador para emitir códigos diferentes; para emissão centralizada de licenças reutilizando uma build, seria necessário um servidor de ativações, que não faz parte do core offline.

## Distribuição

- appId: `br.com.artisys.sistemafinanceiro.trial`
- productName: `ArtiSys Financeiro - Avaliacao`
- Artefato: `ArtiSys-Financeiro-Avaliacao-Setup-0.1.0.exe`
- GitHub Actions executa `npm test`, `npm run build`, empacotamento Windows NSIS, SHA-256 e publica a pré-release.
- **Não substituir** o instalador comercial que já está no Google Drive.

## Limites conhecidos

- O código pode ser compartilhado com quem tiver **esse instalador**. O acesso não é vinculado a um único dispositivo; não há revogação remota.
- A lógica de proteção em aplicativos desktop é vulnerável a engenharia reversa por usuários com controle do executável.
- A prevenção de retrocesso do relógio é local e não é infalível.
- A data de validade não se estende se o cliente instalar mais tarde. Para outra data, emita e compile novo pacote.

Tudo é open source e funciona localmente, com custo de software `R$ 0`.
