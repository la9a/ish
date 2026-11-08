# Auditoria do caminho de envio — preparação local

## Estado da análise

Não houve login nem alteração na VPS. O SSH ao IP informado, na porta 22, retornou `Connection refused` tanto no isolamento padrão quanto no executor externo. O canal TCP gerenciado também recusou conexão; a tentativa HTTP de leitura foi bloqueada com `403 Domain forbidden`. Esses resultados não identificam a causa no servidor e não testam a senha. Não há capturas de diagnóstico de rede retidas no ambiente.

Os achados abaixo são do código do repositório, cuja base é o commit `9b4a03c149b31ec94c4aae621e4d083fa49ae609`. O `server.mjs` dessa base tem SHA-256 `31ec42a98f38b931aabc2b71c349430a7d1ac5b9b35e050b03fbfa13331cb5ec`. A versão instalada na VPS permanece desconhecida e precisa ser comparada antes de aplicar a correção.

## Correções preparadas

- O modo por mensagem de administrador retornava do callback durante `firing`, ignorando a própria mensagem enquanto aguardava o ACK. Agora os dois modos compartilham a confirmação por `random_id` associado a um ID concreto ou pela própria mensagem, com peer, texto, ID acima da referência e janela de 10 segundos.
- O callback do administrador escrevia logs antes de filtrar o grupo. Esse trabalho foi removido do caminho anterior ao despacho; mensagens de outros grupos não geram esses logs.
- Uma resposta tardia do polling podia alterar o `baselineId` usado para confirmar a mensagem. O polling agora tem cursor próprio e verifica novamente o estado depois do `await`.
- Mensagens anteriores à referência inicial e mensagens de saída não acionam o modo por administrador. Os IDs de chat básico e canal permanecem separados.
- A telemetria distingue `mensagem-admin` de `historico-admin` e registra `confirmacaoVia`. A trava é reservada antes do primeiro `await`; `FLOOD_WAIT` e reconciliação de duplicidade são mantidos.

## O que os números medem

`confirmacaoMs` mede a confirmação observada pela conta. A chamada RPC e o ACK podem terminar depois de a própria mensagem já ter sido recebida. Antecipar uma confirmação válida não demonstra, por si só, melhora da posição na fila.

`sinalAteEscritaMs` conserva o nome legado, mas seu final é o início da chamada RPC. Ele não mede o momento em que bytes saíram pelo socket nem o instante de entrada no Telegram. O fallback de histórico do modo por administrador usa intervalo de 1 segundo; o caminho principal é o raw update.

O painel consulta eventos a cada 700ms, além do tempo de rede. Quando o job já está armado na VPS, essa consulta não participa do disparo. Mudar o painel para CMD não elimina automaticamente um gargalo do agente ou do Telegram.

Quantidade de membros não mede, sozinha, carga simultânea ou atraso de entrega de updates. A comparação útil usa a mesma conta, grupo, método e janela de abertura, separando recebimento do sinal, despacho, confirmação e posição efetiva.

## Pontos pendentes na versão real

- Conferir versão de Node/mtcute, flags, relógio/NTP, carga e event loop, contas/DCs e se os disparos vieram de raw update ou fallback.
- Verificar o estado real de `USE_ALT` sem criar cópias concorrentes da autorização.
- Medir o tráfego de manutenção: o código possui keepalive por conta e por job. Isso ainda não foi identificado como gargalo na VPS.
- Auditar a apuração separadamente: o código atual usa o minuto da mensagem como janela e exclui administradores de forma diferente entre métodos. A senha exibida precisa ser comparada com a ordem oficial da rodada. Essa lógica não foi alterada nesta correção.

Não há medição de ganho na VPS nem promessa de senha 1. A correção melhora o caminho local de confirmação e remove trabalho síncrono antes do despacho.

## Diagnóstico e validação

`miami-agent/scripts/diagnose.py` coleta flags não secretas, hash do código, versão do processo, recursos e métricas numéricas de um trecho de log. Ele não conecta ao Telegram, não lê sessões e não reinicia o serviço. O valor de `AGENT_TOKEN` não é exportado; há somente indicação de presença quando disponível no ambiente inicial do processo. Ausência de dados não indica saúde do serviço.

```sh
python3 miami-agent/scripts/diagnose.py --output /tmp/senhabaixa-diagnostico.json
# Para um processo/log já identificado, use --pid e --log explicitamente.
```

O comando recusa sobrescrever um arquivo existente. Os logs são limitados ao trecho final de 2MiB, sem linhas brutas, mensagens ou identificadores de clientes. O coletor foi executado localmente; não encontrou agente Miami nesta máquina de desenvolvimento, como esperado.

Passaram a verificação de sintaxe do agente, os 70 testes da aplicação (13 do agente, incluindo ACK atrasado, concorrência, cursor, peer e FLOOD_WAIT) e 5 testes do coletor para sanitização e identificação do processo.

```sh
node --check miami-agent/src/server.mjs
node --test miami-agent/src/opening-update.test.mjs miami-agent/src/admin-update.test.mjs
python3 -m unittest discover -s miami-agent/test -p 'test_*.py' -v
bun run test
```

Os testes executam a classe real com transporte controlado. Não iniciam HTTP, não conectam contas e não medem latência real do Telegram.

O pacote de revisão contém o agente, testes, coletor, patch e manifesto de hashes. O prompt em `releases/PROMPT_MIAMI_AUDITORIA.txt` orienta o Lovable a obter o diagnóstico, comparar a versão e preparar implantação com backup e rollback, preservando jobs ativos, sessões e configuração.
