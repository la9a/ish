# Senha Baixa — banners e preparação do atendimento

Esta revisão usa `senhabaixa-site-v2.zip` como base do painel.

## Alterações

- Banners com texto e personagens em colunas separadas no desktop e em linhas separadas no celular. A altura acompanha o conteúdo; títulos, descrições, botões e informações não ficam sobre os gatos.
- O mesmo cuidado de leitura foi aplicado aos cabeçalhos dos modais, estados de autorização e ajuda do cadastro.
- Gato de reconexão com dois cabos distintos: um ligado ao celular e outro ao servidor, com conectores separados. O gato de Minhas clientes recebeu barriga clara, marcas de pelagem e volume suave.
- Banners com resumos reais do cadastro e orientações específicas de cada área.
- Visão geral com pendências por cliente e atalhos para reconectar ou preparar os grupos.
- Minhas clientes e Atendimento único com filtro de preparação, botão Revisar pendências e checklist individual dentro dos detalhes.
- Guia expansível com os passos de preparação e links para as respectivas páginas.
- Conexões com atalho para filtrar contas sem sessão.
- Atendimento multi com Selecionar preparadas e Limpar seleção. Selecionar não inicia monitoramento nem envia mensagens; o limite de 20 contas continua respeitado.
- Artes incluídas no ZIP servem de alternativa local quando o endpoint de assets do Lovable não está disponível. As duas artes corrigidas são locais.

## O que significa “preparada”

É uma verificação do cadastro salvo: há sessão vinculada, pelo menos um grupo ativo e todos os grupos ativos têm rascunho preenchido. Grupos desativados não contam para essa verificação. Isso não comprova conexão ativa, validade da sessão, permissões no Telegram ou envio. Consulte o estado real em Conexões antes de iniciar.

A senha continua vindo da apuração existente. Esta revisão não altera o motor de envio, a detecção de abertura ou o cálculo da posição.

## Desenvolvimento e validação

Use Node 24 e Bun 1.3.13. No checkout existente:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

O comando de testes inclui 60 testes: autenticação, isolamento de cache, relógio, apresentação da posição, recuperação do cadastro, edição de clientes, ordenação de conexões, preparação e callbacks do agente.

Para o navegador, siga os fixtures e a instalação separada de Playwright/Chromium descritos em `VALIDATION.md`. A nova suíte é:

```sh
SMOKE_BANNERS_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v3-banners bun run test:ui
```

Ela cobre oito páginas em cinco larguras (360, 390, 768, 1024 e 1440 px), verifica geometricamente a separação de texto e arte e exercita os novos filtros, o guia e a seleção em lote. As demais suítes visuais também verificam a separação dos banners a cada captura.

As verificações de interface usam dados fictícios e transportes interceptados. Não comprovam funcionamento das integrações de produção. Nada precisa ser aplicado à VPS para usar esta revisão visual. Reutilize os segredos existentes do projeto, principalmente a chave de criptografia de sessões.
