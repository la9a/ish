# Robô de Miami (agente de envio)

Roda num servidor em Miami, mantém as contas conectadas 24h e dispara a mensagem
de lá. A distância até o Telegram cai de ~200ms para ~5-15ms.

## O que contratar

Qualquer VPS pequeno **em Miami**: Vultr, DigitalOcean, Hetzner (Ashburn não serve
tão bem), Contabo Miami. 1 vCPU / 1 GB já basta — cerca de US$ 5-6 por mês.
Sistema: Ubuntu 24.04.

## Instalação

```bash
apt update && apt install -y nodejs npm git
git clone <este-repo> app && cd app/miami-agent
npm install
export AGENT_TOKEN="uma-senha-longa-e-aleatoria"
node src/server.mjs
```

Para deixar rodando sempre:

```bash
npm i -g pm2
AGENT_TOKEN="uma-senha-longa-e-aleatoria" pm2 start src/server.mjs --name miami
pm2 save && pm2 startup
```

Coloque um domínio/HTTPS na frente (Caddy resolve em uma linha):

```
agente.seudominio.com {
  reverse_proxy localhost:8787
}
```

## Ligar no site

No site, salve dois segredos: `MIAMI_AGENT_URL` (ex.: `https://agente.seudominio.com`)
e `MIAMI_AGENT_TOKEN` (o mesmo `AGENT_TOKEN`).

## Rotas

| Rota | Uso |
| --- | --- |
| `GET /health` | estado e latência de cada conta |
| `POST /accounts` | registra conta: `{clientId, apiId, apiHash, session}` |
| `POST /jobs` | inicia monitoramento: `{jobId, clientId, group, message, targetMs?}` |
| `DELETE /jobs?jobId=` | para o monitoramento |
| `GET /events?since=` | logs para o painel |

Todas exigem `Authorization: Bearer <AGENT_TOKEN>`, menos `/health`.
