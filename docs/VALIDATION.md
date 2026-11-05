# Validação da entrega

Verificações locais realizadas em 4 de novembro de 2026, com Node 24.22.1 e Bun 1.3.13.

| Verificação                                    | Resultado                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalação `bun install --frozen-lockfile`     | Passou. URLs do cache privado do Lovable foram substituídas pelo registro público npm; versões e checksums preservados.                                                                                                                                                                                   |
| `bun run build`                                | Passou, com bundle cliente e servidor Cloudflare. Há avisos de APIs antigas e tamanho de bundle herdados.                                                                                                                                                                                                 |
| `tsc --noEmit`                                 | Passou.                                                                                                                                                                                                                                                                                                   |
| `node docs/auth-login.test.mjs`                | 9 testes passaram: login sem CAPTCHA, bloqueios, limites, falhas e logout. Dependências externas simuladas.                                                                                                                                                                                               |
| `node tests/cache-isolation.test.mjs`          | 10 testes passaram: respostas atrasadas, migração, callbacks e escritas de outra conta não contaminam a conta atual.                                                                                                                                                                                      |
| `node tests/wizard-recovery.test.mjs`          | 10 testes passaram: recuperação do cadastro, ID explícito, credenciais compatíveis, persistência e replay dos efeitos de inicialização.                                                                                                                                                                   |
| `node miami-agent/src/opening-update.test.mjs` | 3 testes existentes passaram: sinal de abertura, mensagem de membro e confirmação da própria mensagem.                                                                                                                                                                                                    |
| Chromium desktop 1440 px e celular 390/360 px  | Passou: home, filtro Radix por clique/teclado, busca, conexões, cadastro inicial/países/autorização/credenciais/recuperação/2FA, modal de rascunho, opções, seleção múltipla e monitoramento único/múltiplo. Sem erro JavaScript não tratado. As telas móveis verificadas não tiveram rolagem horizontal. |
| CSS do badge e guarda de rota                  | Passou: visitante sem sessão redirecionado ao login; mostrar/ocultar chave funcional; elemento `#lovable-badge` injetado pelo teste ficou com `display: none`.                                                                                                                                            |
| Verificação ESLint focada na nova UI           | Nos banners, selects, conexões, cards/logs e rotas de monitoramento: sem erros; três avisos herdados de Fast Refresh. Cadastro e modais ainda têm apontamentos legados no lint geral.                                                                                                                     |
| `bun run lint`                                 | Ainda falha em código legado. O ZIP original tinha 2.198 erros e 7 avisos; a revisão reduziu esses problemas. Não é um resultado de lint limpo.                                                                                                                                                           |

São **32 testes locais de comportamento aprovados** em `npm run test`, além do smoke test de navegador.

A revisão inclui banners novos por área, componentes de monitoramento reescritos, conexões, cadastro, menus customizados e modais. O cadastro agora preserva a identidade pendente e aguarda a restauração antes de gravar o rascunho. Cadastros antigos sem ID explícito pedem nova conexão em vez de assumir outra cliente. O seletor de grupos remonta por cliente e consulta o cache explícito daquela conta.

As capturas em [preview](preview/) usam somente uma conta e clientes fictícias, com chamadas do Supabase e do transporte Telegram/agente interceptadas no navegador. Não há modo demo nem atalho de autenticação no aplicativo entregue. O estado “conectada” nessas capturas é um fixture visual, não prova de conexão real ao Telegram.

## Repetir a verificação visual

O script `scripts/visual-smoke.mjs` exige Chromium e Playwright, mantidos fora das dependências de produção. Ele substitui módulos de transporte apenas no contexto de teste do navegador e bloqueia destinos externos. Não valida autenticação nem envios de produção.

No ambiente desta entrega:

```sh
# Terminal 1, somente para o teste visual; estes valores são fixtures, não credenciais.
VITE_SUPABASE_URL=https://visual-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_visual_test_only npm run dev -- --host 0.0.0.0 --port 3001

# Terminal 2
PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-screens npm run test:ui
```

Fora deste ambiente, instale Playwright separadamente e ajuste `PLAYWRIGHT_MODULE` e `CHROMIUM_PATH`. Não salve os valores fictícios acima na configuração de produção do Lovable.

## O que precisa ser conferido no Lovable

Não estavam disponíveis as credenciais do Supabase nem do agente Miami. Não foram realizados login de produção, RLS no banco implantado, conexão a contas Telegram, edição de dados reais ou envio de mensagens. As verificações locais não afirmam que esses serviços estão operacionais.

Ao integrar, reutilize os segredos e a chave de criptografia existentes. Valide login e isolamento com duas contas de homologação e uma conta Telegram/grupo de teste autorizado. O motor do agente não foi substituído.

O CAPTCHA Turnstile foi retirado do código cliente e servidor e das permissões específicas da CSP. Desafios configurados externamente no WAF/Cloudflare não podem ser removidos por esta alteração e precisam ser conferidos na conta do provedor, se existirem.

A referência do Instagram retornou HTTP 403. O visual foi criado a partir da direção descrita pelo usuário, com marca e ilustrações SVG originais; não é uma cópia verificada do Pierre.

## Distribuição

O código-fonte está na raiz do repositório. O prompt de integração está em [LOVABLE_PROMPT.md](LOVABLE_PROMPT.md). O pacote completo fica em `releases/senhabaixa-redesign.zip` e pode ser regenerado com `python3 scripts/package.py` a partir dos arquivos versionados. O ZIP exclui dependências, segredos, builds e histórico antigo de planos do Lovable.
