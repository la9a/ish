# Validação da entrega

Verificações locais realizadas em 4 de novembro de 2026, com Node 24.22.1 e Bun 1.3.13.

| Verificação                                    | Resultado                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalação `bun install --frozen-lockfile`     | Passou. URLs do cache privado do Lovable foram substituídas pelo registro público npm; versões e checksums preservados.                            |
| `bun run build`                                | Passou, com bundle cliente e servidor Cloudflare. Há avisos de APIs antigas e tamanho de bundle herdados.                                          |
| `tsc --noEmit`                                 | Passou.                                                                                                                                            |
| `node docs/auth-login.test.mjs`                | 9 testes passaram: login sem CAPTCHA, bloqueios, limites, falhas e logout. Dependências externas simuladas.                                        |
| `node tests/cache-isolation.test.mjs`          | 10 testes passaram: respostas atrasadas, migração, callbacks e escritas de outra conta não contaminam a conta atual.                               |
| `node miami-agent/src/opening-update.test.mjs` | 3 testes existentes passaram: sinal de abertura, mensagem de membro e confirmação da própria mensagem.                                             |
| Chromium desktop 1440 px e celular 390 px      | Login, dashboard e lista renderizaram sem erro JavaScript não tratado e sem rolagem horizontal. Busca, filtro de conexão e menu móvel verificados. |
| `bun run lint`                                 | Ainda falha em código legado. O ZIP original tinha 2.198 erros e 7 avisos; a revisão reduziu esses problemas. Não é um resultado de lint limpo.    |

As capturas em [preview](preview/) usam somente uma conta e clientes fictícias, com chamadas do Supabase interceptadas no navegador. Não há modo demo nem atalho de autenticação no aplicativo entregue. O estado “conectada” nessas capturas é um fixture visual, não prova de conexão real ao Telegram.

## O que precisa ser conferido no Lovable

Não estavam disponíveis as credenciais do Supabase nem do agente Miami. Não foram realizados login de produção, RLS no banco implantado, conexão a contas Telegram, edição de dados reais ou envio de mensagens. As verificações locais não afirmam que esses serviços estão operacionais.

Ao integrar, reutilize os segredos e a chave de criptografia existentes. Valide login e isolamento com duas contas de homologação e uma conta Telegram/grupo de teste autorizado. O motor do agente não foi substituído.

O CAPTCHA Turnstile foi retirado do código cliente e servidor e das permissões específicas da CSP. Desafios configurados externamente no WAF/Cloudflare não podem ser removidos por esta alteração e precisam ser conferidos na conta do provedor, se existirem.

A referência do Instagram retornou HTTP 403. O visual foi criado a partir da direção descrita pelo usuário, com marca e ilustrações SVG originais; não é uma cópia verificada do Pierre.

## Distribuição

O código-fonte está na raiz do repositório. O prompt de integração está em [LOVABLE_PROMPT.md](LOVABLE_PROMPT.md). O pacote completo fica em `releases/senhabaixa-redesign.zip` e pode ser regenerado com `python3 scripts/package.py` a partir dos arquivos versionados. O ZIP exclui dependências, segredos, builds e histórico antigo de planos do Lovable.
