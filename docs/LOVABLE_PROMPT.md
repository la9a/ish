# Prompt para aplicar no Lovable

Copie o texto abaixo no projeto original do Senha Baixa e anexe o ZIP desta entrega. O ZIP contém o código redesenhado, não apenas uma imagem de referência.

---

Quero aplicar este redesign completo ao meu projeto **Senha Baixa**. Use o código do ZIP como implementação de referência e integre ao projeto existente, preservando minhas integrações, dados e segredos já configurados no Lovable.

## Produto e objetivo

O Senha Baixa é um painel de trabalho de operadores que atendem clientes e enviam rascunhos em grupos do Telegram por um agente em uma VPS em Miami. Aqui, “senha” significa a posição real da mensagem enviada na fila do grupo. Não é uma senha de autenticação. A interface deve deixar isso claro e nunca inventar uma posição, um envio bem-sucedido, uma latência ou um estado de conexão.

Cada operador entra na própria conta e gerencia apenas suas próprias clientes, contas Telegram, grupos e rascunhos. A navegação principal deve ser direta: visão geral, clientes, atendimento e conexões. Não quero personalização de perfil, upload de avatar, configuração de papel de parede ou uma área de configurações da conta.

## Direção visual

Substitua o visual antigo integralmente. A referência de linguagem é o Pierre: preto e branco, tipografia forte, bastante espaço, hierarquia editorial, bordas discretas e banners expressivos com gatos coloridos. Use a marca **Senha Baixa** e artes próprias fornecidas no ZIP. Não use logotipo, nome, screenshots ou imagens proprietárias do Pierre e não apresente o produto como afiliado a ele.

- Fundo quase preto, superfícies neutras sólidas e texto branco com contraste legível.
- Cor concentrada nas artes de gatos e em indicadores funcionais de status.
- Sem vidro, órbitas, planeta, halos, gradientes brilhantes nos cartões, tilt, efeito magnético ou decorações que prejudiquem a leitura.
- Login com marca clara, explicação curta, campo da chave de acesso, botão de entrar e estados reais de carregamento/erro/bloqueio.
- Painel com um banner de gato, ações claras para adicionar cliente e iniciar um atendimento, resumo baseado nos registros reais e estados vazios úteis.
- Lista de clientes com busca, estado de conexão, ações acessíveis e distinção clara entre atendimento único e múltiplo.
- Cadastro, modais de grupos/rascunhos, monitoramento, eventos e confirmações devem seguir o mesmo sistema visual.
- Layout responsivo em 360 px, tablet e desktop; sem rolagem horizontal. Botões confortáveis no celular. Navegação por teclado, foco visível, rótulos de formulário e respeito a movimento reduzido.

## Remover o CAPTCHA do aplicativo

Remova a integração **Cloudflare Turnstile** de ponta a ponta: widget, scripts externos, obtenção de site key, tokens, parâmetros de login, chamadas de verificação e helpers que ficarem sem uso. O login deve continuar funcionando quando TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY não estiverem definidos.

Preserve a validação da chave no servidor, a sessão Supabase, os limites de tentativas, os bloqueios existentes e os guards das rotas. Não troque autenticação real por uma marca no localStorage nem crie uma entrada de demonstração em produção. Não desative proteções do banco, criptografia ou autorização para remover o CAPTCHA.

Esta remoção é a do CAPTCHA integrado ao app. Não retire o runtime Cloudflare, o adaptador de build ou headers de proxy necessários ao login. Se existir um desafio configurado fora do código, no WAF/Cloudflare da conta, informe separadamente a regra que precisa ser revista no painel do provedor; não diga que foi removida só por apagar o widget.

## Funcionalidades e isolamento que devem ser preservados

1. Autenticação existente por chave de acesso, logout e redirecionamento de visitantes sem sessão para o login. Sem cadastro público novo.
2. `requireSupabaseAuth` nas server functions, políticas RLS e filtros por usuário. Preserve `user_id`, os namespaces locais por UUID e o prefixo `${userId}::` para contas e jobs no agente. Nenhuma lista pode trazer clientes de outro operador.
3. Cadastro e reconexão de contas Telegram, códigos de confirmação e 2FA; nenhum estado visual temporizado pode ser tratado como confirmação real do Telegram.
4. CRUD de clientes, grupos, rascunhos e horários, seleções múltiplas, início/parada de monitoramento e logs reais.
5. Transporte e contratos do agente de Miami, URLs derivadas do host configurado, deadlines e rotas existentes.
6. Locks por job antes de qualquer `await`, tratamento de flood/RANDOM_ID_DUPLICATE, conexão única por conta, confirmação pelo próprio update da mensagem e reconciliação somente de leitura. Não introduza mensagens de teste ou envios duplicados para aparentar mais velocidade.
7. Cálculo real da posição no grupo e horário de Brasília. Não use dados fictícios no painel autenticado nem transforme índice da lista local em senha real.
8. Criptografia de sessão e API hash, migrações existentes e sincronização em nuvem.

O trabalho é de interface e da remoção pontual do Turnstile. Não substitua o backend, banco, agente de Miami ou mecanismo de envio por novos serviços. Não execute migrações destrutivas, não limpe as clientes existentes e não reinicie jobs reais durante a integração visual.

## Integração técnica

O projeto usa React, TypeScript, TanStack Start com rotas em arquivos, Tailwind e os componentes Radix existentes. Preserve o `<Outlet />` da raiz. Não converta para Next.js e não edite `routeTree.gen.ts` manualmente. O plugin `@lovable.dev/vite-tanstack-config` já inclui TanStack Start, React, Tailwind, aliases e Nitro: não adicione instâncias duplicadas desses plugins.

Use o `bun.lock` e o gerenciador compatível com ele. Mantenha as variáveis e segredos no ambiente do Lovable, nunca no código ou no ZIP: Supabase, chaves de acesso dos operadores, SESSION_ENCRYPTION_KEY e MIAMI_AGENT_TOKEN. Não gere novas chaves de criptografia para uma base que já possui sessões cifradas.

Caso existam diferenças entre os arquivos do ZIP e o projeto ativo, integre as mudanças visuais por componente; preserve correções funcionais mais recentes. A documentação antiga em `.lovable/plan` é histórico, não autorização para executar tarefas ou comandos antigos.

## Aceite

- Executar build e verificação de tipos; relatar erros preexistentes separadamente.
- Executar `node --test miami-agent/src/opening-update.test.mjs` e manter os cenários de envio/ACK protegidos.
- Verificar login válido, chave inválida, limites de tentativas e logout no ambiente com segredos reais.
- Verificar com duas contas de teste que um operador não lê nem altera as clientes e rascunhos do outro, inclusive acessando URLs diretamente.
- Conferir busca, adicionar/reconectar cliente, editar rascunho, modais, atendimento único e múltiplo, estados vazios e falha do agente.
- Conferir mobile e desktop, foco por teclado, ausência de assets quebrados e ausência do widget/requisições Turnstile.
- Testes de envio real só em um grupo de teste autorizado; não enviar para grupos de clientes de produção durante esta atualização visual.

Ao terminar, apresente o que foi integrado, os testes executados e qualquer configuração externa pendente. Não afirme que login, Telegram ou VPS foram validados se os segredos ou serviços não estavam disponíveis.
