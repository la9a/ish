# Senha Baixa — enquadramento V5

Esta revisão substitui as regras de moldura da V4, seguindo as referências de visão geral e monitoramento originais.

- A arte se ancora à moldura inteira e ultrapassa o rodapé em 14px, ocultando a linha do corte do torso. O trio recebe compensação para sua margem transparente.
- Banner e faixa de informações são elementos irmãos. Resumos, ações adicionais e observações permanecem disponíveis abaixo da moldura, sem aumentar sua altura.
- Alturas responsivas baseadas nas proporções aproximadas de 2,48:1 e 1,71:1: seções de 154 a 300px e visão geral de 210 a 360px. Em 390px, a referência fica em 154px e 210px, respectivamente.
- `cat-multi-editorial.png` e `cat-connect-editorial.png` são novas artes locais com traço plano, textura leve e olhos no estilo da coleção. O monitoramento múltiplo utiliza o gato de fones; o trio fica na seleção.
- Cabeçalhos dos modais e ajuda do cadastro também escondem o corte inferior. A ilustração de falha sem gato é preservada inteira.

O pacote completo está em `releases/senhabaixa-banners-v5.zip`, com checksum em `.sha256`. O prompt está em [PROMPT_LOVABLE_BANNERS_V5.txt](../releases/PROMPT_LOVABLE_BANNERS_V5.txt).

[Prévias dos cards renderizados](preview-v5/README.md), com viewport de 390px: visão geral de 354 × 210px e banners de seção de 354 × 154px.

## Validação

```sh
bun run typecheck
bun run test
bun run build
SMOKE_BANNERS_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v5-banners bun run test:ui
SMOKE_COMPACT_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v5-compact bun run test:ui
SMOKE_REFINEMENTS_ONLY=1 PLAYWRIGHT_MODULE=/workspace/.tools/node_modules/playwright/index.mjs SCREENSHOT_DIR=/tmp/ish-v5-refinements bun run test:ui
```

Use os fixtures e o servidor documentados em `VALIDATION.md`. As verificações geométricas cobrem texto, botões, a borda inferior e, nas duas imagens novas, o rodapé transparente real calculado pelo canal alpha. Há verificações de menus escuros e comparação de alturas nas duas orientações.

Passaram build, TypeScript, os 60 testes de comportamento, a suíte geral de navegador, as verificações de refinamentos e os testes de banners em cinco larguras. O lint focado em PageBanner e BannerArtwork também passou.

O motor de envio, a autenticação e os dados de produção não foram alterados. As verificações visuais usam dados fictícios e transportes interceptados.
