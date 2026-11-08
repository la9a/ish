# Senha Baixa

Painel de atendimento de clientes e monitoramento de rascunhos em grupos do Telegram. A posição da mensagem no grupo determina a senha de atendimento. O painel usa React, TypeScript, TanStack Start e Tailwind; o agente de envio continua separado na VPS em Miami.

## Redesign

A revisão atual está em [Atualizações V4](docs/ATUALIZACOES_V4.md): banners compactos nas duas orientações, controles escuros e reconexão entre dois servidores. [Pacote completo](releases/senhabaixa-compacto-v4.zip) · [Prompt para o Lovable](releases/PROMPT_LOVABLE_COMPACTO_V4.txt).

A preparação dos atendimentos e os filtros de pendências estão descritos em [Atualizações V3](docs/ATUALIZACOES_V3.md).

Interface preta e branca com banners de gatos por área. Monitoramento, conexões, cadastro, etapas de autorização, seleção múltipla e modais redesenhados; menus customizados por Radix e textos objetivos. Sem personalização de perfil e sem CAPTCHA Turnstile; autenticação e limites de tentativas continuam ativos.

- [Baixar ZIP completo](releases/senhabaixa-redesign.zip)
- [Prompt para o Lovable](docs/LOVABLE_PROMPT.md)
- [Galeria de todas as telas](docs/preview/README.md)
- [Monitoramento](docs/preview/monitoramento-desktop.png) · [Conexões](docs/preview/conexoes-desktop.png) · [Cadastro](docs/preview/cadastro-desktop.png)
- [Testes e limitações](docs/VALIDATION.md)

As capturas usam dados fictícios de teste, sem acessar produção.

## Desenvolvimento

Use **Node.js 24** e **Bun 1.3.13**. O checkout da tarefa já é isolado; não crie outro worktree para configurar o ambiente.

```bash
cd /workspace/ish
bun install --frozen-lockfile
bun run dev --host 0.0.0.0 --port 3000
```

Fora do ambiente de nuvem, substitua `/workspace/ish` pelo diretório local deste repositório. O `bun.lock` e a política de versões de `bunfig.toml` devem ser preservados. As URLs do cache privado do Lovable no lockfile original foram normalizadas para `registry.npmjs.org`, mantendo versões e checksums.

```bash
bun run build
bun run typecheck
bun run test
node --test miami-agent/src/opening-update.test.mjs
```

O teste do agente exercita o callback de abertura e a confirmação da própria mensagem sem conectar ao Telegram. Ele não verifica credenciais, uma VPS real ou envios reais. Para ver os três cenários individualmente também é possível executar `node miami-agent/src/opening-update.test.mjs`. A checagem de código disponível é `bun run lint`.

## Configuração do aplicativo

Configure valores no ambiente de execução ou nos segredos do Lovable. Para desenvolvimento local, use somente arquivos ignorados pelo Git, como `.env.local`; nunca publique credenciais reais.

| Variável                               | Uso                                                            |
| -------------------------------------- | -------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                    | URL pública do projeto Supabase usada pelo navegador           |
| `VITE_SUPABASE_PUBLISHABLE_KEY`        | Chave pública do Supabase usada pelo navegador                 |
| `SUPABASE_URL`                         | URL do mesmo projeto no servidor                               |
| `SUPABASE_PUBLISHABLE_KEY`             | Chave pública usada pelo middleware do servidor                |
| `SUPABASE_SERVICE_ROLE_KEY`            | Operações administrativas de autenticação, somente no servidor |
| `ACCESS_KEY_RONEI`, `ACCESS_KEY_PEDRO` | Chaves de acesso dos operadores previstas pelo backend atual   |
| `SESSION_ENCRYPTION_KEY`               | Criptografia das sessões e credenciais Telegram                |
| `MIAMI_AGENT_URL`                      | Endereço do agente já instalado na VPS                         |
| `MIAMI_AGENT_TOKEN`                    | Token que autentica o aplicativo no agente                     |
| `PROXYCHECK_KEY`                       | Chave opcional do serviço de detecção de proxy/VPN             |

Não regenere `SESSION_ENCRYPTION_KEY` se a base já contém sessões cifradas. Não prefixe segredos de servidor com `VITE_`, pois variáveis desse prefixo entram no código do navegador.

Sem Supabase configurado o login real não funciona. Sem o agente, suas credenciais e contas Telegram autorizadas, o envio real não pode ser validado. Use as integrações já existentes no projeto original do Lovable; não há credenciais de produção neste repositório.

As migrações existentes estão em `supabase/migrations` e `drizzle/migrations`. Uma instalação nova precisa do schema do aplicativo e das tabelas/função de rate limit, além dos usuários Supabase correspondentes aos operadores. Confira o schema do ambiente atual antes de aplicar migrações; não execute alterações destrutivas sobre uma base existente durante a troca visual.

## Agente de Miami

O agente é um serviço separado; instruções e contratos estão em [miami-agent/README.md](miami-agent/README.md). O redesign do painel não requer substituir o agente em produção. Não execute `bench-open.mjs` em contas ou grupos reais para verificar o visual: esse benchmark pode enviar mensagens.

## Entrega ao Lovable

O prompt pronto para copiar está em [docs/LOVABLE_PROMPT.md](docs/LOVABLE_PROMPT.md). Ele orienta a integração do redesign e a retirada do CAPTCHA Turnstile do aplicativo, preservando autenticação, rate limits e isolamento dos dados.

O resultado das verificações e as limitações conhecidas estão em [docs/VALIDATION.md](docs/VALIDATION.md).
