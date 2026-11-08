# Senha Baixa — revisão compacta V4

Esta revisão substitui a composição vertical dos banners descrita na V3.

- Banners mantêm texto à esquerda e personagem à direita nas duas orientações. Indicadores e ações usam uma faixa própria, sem a área de ilustração empilhada abaixo no celular.
- Cabeçalhos de modais e ajuda do cadastro seguem a composição compacta.
- Linhas da lista de clientes, fixação e ações de texto têm fundo transparente explícito. Filtros e menus abertos usam cinzas escuros, inclusive sob um reset claro do host.
- Pesquisa e filtros têm uma organização mais compacta no celular. As linhas de clientes conservam a mesma altura em retrato e paisagem.
- A reconexão usa `public/art/cat-reconnect-servers.png`: olhos amendoados no estilo da coleção e dois servidores ligados a cabos separados. Essa arte local tem prioridade sobre os assets antigos do Lovable.

O prompt de integração está em [PROMPT_LOVABLE_COMPACTO_V4.txt](../releases/PROMPT_LOVABLE_COMPACTO_V4.txt) e o pacote completo em `releases/senhabaixa-compacto-v4.zip`. O arquivo `.sha256` permite conferir o pacote. O ZIP exclui dependências, builds, segredos, histórico Git e releases anteriores, e inclui o prompt na raiz.

## Validação

```sh
bun run typecheck
bun run test
bun run build
SMOKE_COMPACT_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v4-compact bun run test:ui
SMOKE_BANNERS_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v4-banners bun run test:ui
```

Os testes de navegador usam o servidor de fixtures documentado em `VALIDATION.md`. A suíte compacta simula um reset de botões brancos, verifica cores escuras, abre o dropdown, expande clientes, compara as alturas das linhas nas duas orientações e verifica os banners horizontais. A suíte de banners verifica a separação geométrica de texto, faixa de apoio e arte em oito páginas e cinco larguras.

Não há mudança no motor da VPS, em autenticação ou na apuração da senha. As verificações visuais usam dados fictícios e transportes interceptados, sem envios reais.
