# Roadmap

- [ ] Remover o endpoint temporário `/diag/history` e os logs extras de admin da VPS (restaurar `backups/server.antes-diag-history.*.mjs`) — bloqueado: SSH (porta 22) inacessível do sandbox; robô segue no ar via HTTPS
- [x] Investigar não-envio do método Mensagem às 19h: provado que nenhum admin/dono escreveu na abertura do grupo real (só membros); detecção de admin/dono validada no lol.dev (0,06 s)
- [x] Corrigir falha local no aviso de abertura (variável usada antes da inicialização), com testes de permissões, membro e confirmação própria; manter sondagens desligadas
- [ ] Instalar correção do aviso na VPS e conferir incidente da senha 90 — depende de acesso operacional à VPS e registros do envio

- [x] Investigar posição 6/76 no Multi, corrigir concorrência de disparos em Miami e medir “hello” com Kontra/AutoWax.gb; testes finais em abertura: 0,23 s e 0,25 s, sem garantia de teto pelo Telegram
- [ ] Confirmar melhora na próxima abertura concorrida de Tremembé — depende de evento real do grupo; logs antigos não mostram a origem dos nove segundos de atraso

- [x] Restaurar a posição anterior do cadastro e unificar confirmação, envio e coleta no mesmo modelo de pop-up
- [ ] Validar cadastro completo e seleção por toque com sessão autenticada — depende do usuário entrar na prévia; emissão de sessão para a própria conta indisponível

- [x] Igualar o DDD e sua lista ao vidro, agilizar Voltar e retornar reconexões a Conexões; remover descrições solicitadas

- [x] Aplicar identificação PC 64Bit e validar os metadados enviados pela biblioteca; texto final do aviso depende do Telegram

- [x] Acesso do site ao robô de Miami (endereço com nome, sem erro 1003)
- [x] Login das contas feito no servidor de Miami (`/auth/*` no agente + ponte no site)
- [x] Monitoramento e envio rodando em Miami
- [x] Sessões persistentes no VPS e restauração automática após reinício
- [x] Bloqueio de login, monitoramento e envio silencioso pelo navegador
- [x] Publicar a normalização e o diagnóstico dos IDs no servidor de Miami
- [ ] Trocar a senha de root do servidor (foi exposta no chat) — depende do usuário
- [x] Centralizar e renomear a busca do modal compartilhado de grupos
- [x] Fixar o carregamento de fotos de grupos na conta correta e permitir nova tentativa após falhas
- [x] Unificar o modal compacto “Editar rascunho” entre os painéis Único e Multi
- [x] Acelerar a conexão com Miami e bloquear Iniciar até todas as contas estarem prontas
- [x] Detectar sessão Telegram revogada antes de iniciar, explicar o erro e desconectar a conta no site
- [x] Impedir travamento no cadastro/reenvio e tornar a coleta automática de API ID/Hash resistente às mudanças do Telegram
- [x] Retentar falhas transitórias do servidor de Miami e encerrar linhas de senha que não recebem retorno
- [x] Publicar no servidor de Miami a nova apuração de posição por ID e com mais tentativas
- [x] Corrigir PEER_ID_INVALID: seguir grupos que viraram supergrupo, recarregar a agenda da conta, nova tentativa automática e mensagem amigável
- [x] Envio instantâneo: sonda quente contínua nas duas conexões, ondas coladas, "envio repetido" tratado como sucesso e tempo real do disparo vencedor
- [x] Recuperar a latência original em supergrupos: rede configurada corretamente, conta/grupo mantidos ativos e confirmação pela aparição real no histórico
- [x] Configurações do site: seletor de wallpaper com prévia, imagem própria e aplicação global do fundo
- [x] Manter o fundo do AUTH fixo e tornar os cards transparentes com wallpaper personalizado
- [x] Aplicar o vidro desde a abertura, nas barras, eventos e modais, sem mover o wallpaper no Multi
- [x] Corrigir o blur no Chrome e remover a foto do AUTH das opções de wallpaper
- [x] Realçar textos secundários, aplicar o vidro antes da primeira pintura e compartilhar relógio/configurações entre Único e Multi
- [x] Reforçar novamente a leitura dos textos e corrigir a faixa preta do wallpaper no celular com altura dinâmica
- [x] Aplicar o blur dos cards principais do Dashboard desde o primeiro frame, sem animação do filtro
- [x] Eliminar fades e staggers compartilhados no carregamento de listas, páginas e painéis
- [x] Manter o botão Iniciar visualmente pronto enquanto a conexão é verificada em segurança
- [x] Unificar o vidro de menus, botões, relógio e cadastro e estabilizar os cards durante a edição
- [x] Fixar o wallpaper ao abrir edições, reutilizar o card de grupo no Único/Multi e impedir eventos repetidos
- [x] Cobrir o wallpaper pela maior altura estável do navegador móvel (`100lvh`) durante o gesto de scroll
- [ ] Confirmar em celular físico que a faixa preta sumiu — depende de novo teste do usuário
- [x] Fazer o Grupo aberto disparar com qualquer mensagem nova de qualquer membro do grupo
- [x] Corrigir o pedido de código pelo fallback da porta 8787 para a porta 80 e só avançar após confirmação real do Telegram
- [ ] Validar criação automática do app (sb{nome}) com um número sem app — depende do código do my.telegram.org enviado pelo usuário

- [x] AutoWax (Kontra, Grupo aberto 2): 0,26/0,26/0,21/0,22 s após o horário marcado, sem FLOOD_WAIT; contas a 7–9 ms do Telegram (Kontra 58 ms)
- [ ] Logs detalhados abertura→envio e teste com 2 contas no AutoWax — bloqueado: senha root da VPS recusada; só Kontra está no AutoWax
