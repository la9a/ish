# Login sem CAPTCHA

O login continua usando a chave de acesso da conta. A interface chama
`appAuth.loginWithKey(key)`; a server function recebe somente `{ key }`.
O widget, o carregamento do script e a validação do token Cloudflare Turnstile
foram removidos. `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` deixam de ser
requisitos desta aplicação. Isso não altera configurações externas da zona
Cloudflare ou de um WAF.

Foram preservados os limites de tentativas global, por IP e para IP ausente,
o bloqueio temporário por chave inválida, a verificação de rede, a comparação
da chave no servidor e a emissão da sessão pelo Supabase. As chaves
`ACCESS_KEY_RONEI` e `ACCESS_KEY_PEDRO` continuam exclusivamente no servidor e
associadas às contas existentes; sem chaves configuradas, o login é recusado.
Não colocar valores reais em arquivos, ZIPs, prompts ou no GitHub.

O acesso às clientes continua protegido pelas políticas de RLS no banco,
pelo filtro `user_id`, pelo middleware de autenticação das server functions e
pelo cache local separado por UUID. O código de login não muda essas políticas.
As migrations presentes no repositório descrevem as políticas; confirmar sua
aplicação no projeto Supabase existente durante a integração no Lovable.

## Validação local

Com Node.js 24 (ou versão compatível com `node:module.stripTypeScriptTypes`):

```sh
cd /workspace/ish
node docs/auth-login.test.mjs
```

São nove testes de comportamento do handler real, com dependências de banco,
rede e segredos substituídas por dados fictícios. Cobrem as duas contas sem
token CAPTCHA, chave inválida, ausência de chaves, limites global e por IP,
bloqueio de IP, verificação de VPN indisponível, IP ausente e falhas na emissão
da sessão, além da limpeza imediata da conta e da seleção de cliente ao sair. Nenhuma conexão ao Supabase ou tentativa de acesso real é feita.
Esses testes não substituem a validação de login e isolamento com duas contas
reais em um ambiente de homologação conectado ao Supabase.
