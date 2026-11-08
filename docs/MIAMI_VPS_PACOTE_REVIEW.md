# Revisão do pacote preparado na VPS — 8 de novembro de 2026

O ZIP enviado foi inspecionado e testado isoladamente. Não houve nova conexão à VPS, reinício ou mensagem real nesta revisão. O estado do servidor descrito no relatório é evidência fornecida pelo pacote; não foi observado novamente por este ambiente.

**O candidato fornecido ainda precisa de correções antes da implantação.** A janela segura continua pendente. Os testes enviados passam, mas não cobrem os quatro comportamentos incorretos reproduzidos abaixo.

## Integridade e validação reproduzidas

| Item | Resultado local |
| --- | --- |
| Candidato enviado | SHA-256 `6990ee51348b4a0ff8cdb4b8a53df0fc8c03e6bc3e144d9533a4dc2a6c706d22` confirmado |
| Original reconstruído revertendo o patch | SHA-256 `6a7d841c5d5e50cad1a8f03e8bdaa2bdf685e5fbe21df3bddac394a1449ebd12`, 63.428 bytes |
| Reaplicação do patch | Reconstrói o candidato byte por byte |
| Apuração e bloco HTTP | Idênticos entre original reconstruído e candidato |
| Testes fornecidos | 15 do agente e 5 do coletor aprovados |
| Aceitação adicional contra o candidato | 4 testes executados, 4 falhas, sem cancelamentos ou testes pulados |
| Código de referência corrigido neste ramo | 20 testes do agente e 5 do coletor aprovados; `npm test`: 77 aprovados |

Os testes desta revisão usaram Node `v24.22.1`, com transporte simulado. O pacote relata Node `v20.20.2` na VPS; a validação no runtime de produção ainda deve ser repetida antes da troca. Nenhum desses testes mede a latência real do Telegram.

## Achados que afetam o disparo

1. **Abertura dispara com qualquer update da conta.** No candidato, o callback de `run()` chama `fire()` sem provar que o grupo alvo abriu. Um simples `updateUserStatus` provocou uma chamada simulada de envio. Isso já existia no original da VPS. A referência do repositório filtra permissões e mensagem nova de membro comum no grupo correto.

2. **Sondas de envio e duas conexões continuam habilitadas.** `PROBE_MS = 20` agenda tentativas, limitadas pela chamada em andamento. `Account.connect()` cria `main` e `alt` e importa a mesma sessão nas duas. Essas áreas não foram criadas pela adaptação, mas preservá-las conserva os caminhos associados a FLOOD_WAIT e AUTH_KEY_DUPLICATED nas regras de arquitetura. Não foi observado um desses erros no recorte fornecido; isso não comprova que as sondas sejam úteis ou que duas conexões sejam necessárias. A adaptação deve usar um cliente por conta, sinal de abertura e reconciliação de leitura, sem testar escrita com envios repetidos.

3. **O fallback administrativo foi desacelerado.** O original da VPS usa 300 ms; o patch troca para 1.000 ms. Essa mudança é real, embora o relatório não a destaque. Quando o update em tempo real não chega, a espera até a próxima leitura pode aumentar. Preservar 300 ms nessa adaptação evita introduzir essa mudança sem evidência; não aumentar a frequência de consultas nem fazer envios de prova. O repositório de referência já usava 1 segundo antes, portanto seu arquivo inteiro não deve substituir o da VPS.

## Quatro falhas reproduzidas e correções de referência

Além do primeiro caso acima:

- Um admin escrevendo em um chat comum com ID numérico 123 provoca envio para um canal de ID 123. O filtro de gatilho comparava apenas o número; o teste de confirmação existente verificava o tipo somente na confirmação. `matchesPeer()` agora distingue os tipos no gatilho e na confirmação.
- Depois da confirmação pela própria mensagem, uma rejeição tardia da RPC publica um evento de erro contraditório. A referência agora ignora sucesso ou erro retornado após o job ter sido confirmado ou cancelado.
- Cancelar enquanto `loadAdmins()` está pendente não impede o registro posterior de callback e timers. A referência verifica o cancelamento depois da preparação e da leitura de administradores e limpa timers independentemente de `jobPing`.

Os três últimos problemas também atingiam trechos compartilhados da revisão anterior do repositório. Foram corrigidos neste ramo, com sete novos testes de regressão. A correção inclui a separação dos tipos no aviso de permissões e o descarte de FLOOD_WAIT tardio após cancelamento.

Os testes de referência estão em [job-lifecycle.test.mjs](../miami-agent/src/job-lifecycle.test.mjs). Para reproduzir somente os quatro casos contra uma extração inspecionada do ZIP enviado:

```sh
MIAMI_REVIEW_ROOT=/caminho/da/extracao node --test \
  --test-name-pattern='opening ignores|an admin message|an RPC error|cancellation while loading' \
  miami-agent/src/job-lifecycle.test.mjs
```

São testes de aceitação: devem falhar no candidato enviado e passar após a correção. Não inicie o `server.mjs` para executá-los. O fixture executa apenas a classe e helpers em uma VM, com transporte substituído. Inspecione qualquer nova versão de fixture antes de executá-la.

## O job antigo e a janela de troca

`/health` retorna as chaves do Map `jobs`, incluindo jobs encerrados. `finish()` chama `stop()` antes de publicar sucesso/done e da apuração posterior produzir `patch`. Os eventos HTTP têm retenção limitada. Portanto, um último evento `patch` antigo pode ter sobrevivido ao `done`; isso não prova monitoramento ativo, mas também não permite presumir que o mesmo ID não foi reutilizado.

O pacote não contém a sequência completa de criação e encerramento que permita resolver essa ambiguidade. Para confirmar a janela, o Lovable precisa de evidência do ciclo atual: último início daquele job e término posterior, sem novo início, além dos demais monitoramentos. Se a retenção dos logs não permite isso, o estado permanece desconhecido. Não apagar jobs, ativar inspector, anexar debugger ou reiniciar para descobrir.

## Medição e entrega

O diagnóstico fornecido não tem amostras de latência. A telemetria adicionada cobre `fire()`, mas o caminho `probe()` pode terminar sem `tl` e sem amostra equivalente. Isso limita comparações até a remoção das sondas. Os comentários que descrevem duplicidade como sucesso e o relógio como 50 ms também precisam acompanhar o comportamento real.

Não há evidência de melhora de posição nem medição que explique as senhas 20–30. A investigação da apuração por minuto e da exclusão de administradores permanece separada. Confirmação antecipada, chegada ao Telegram e posição são medidas diferentes.

O pacote `releases/miami-confirmacao-review-v2.zip` contém a referência atualizada do repositório, testes, coletor, patch e este parecer. **Não é um substituto pronto do arquivo personalizado da VPS.** O próximo passo está em [PROMPT_MIAMI_REVISAO_V2.txt](../releases/PROMPT_MIAMI_REVISAO_V2.txt): adaptar os trechos, repetir os testes, comprovar inatividade e só então trocar com backup e rollback.
