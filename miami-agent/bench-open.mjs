// Teste: Kontra fecha/abre um grupo de teste e mede quanto a Ana (via robô) demora.
import fs from "node:fs";
import path from "node:path";
import { TelegramClient, Long } from "@mtcute/node";

const DATA = "/root/miami-agent/data";
const TOKEN = process.env.AGENT_TOKEN;
const U = "ff9d5264-f758-49a0-a205-3846c075babc";
const KONTRA = `${U}::c_mLnxLtjxcAqATbv6`;
const ANA = `${U}::c_WixLHmULaFyKxVqU`;
const ROUNDS = Number(process.env.ROUNDS || 20);
const GAP_MS = Number(process.env.GAP_MS || 20000);
const reg = JSON.parse(fs.readFileSync(path.join(DATA, "accounts.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copySession(id, tag) {
  const dir = "/tmp/bench";
  fs.mkdirSync(dir, { recursive: true });
  for (const ext of ["", "-wal", "-shm"]) {
    const src = path.join(DATA, `${id}.session${ext}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `${tag}.session${ext}`));
  }
  return path.join(dir, `${tag}.session`);
}
async function client(id, tag, updates) {
  const r = reg.find((x) => x.clientId === id);
  const c = new TelegramClient({ apiId: r.apiId, apiHash: r.apiHash, storage: copySession(id, tag), disableUpdates: !updates,
    initConnectionOptions: { deviceModel: "PC 64Bit", systemVersion: "Windows 11", appVersion: "1.0" } });
  await c.connect();
  if (updates) await c.startUpdatesLoop?.();
  return c;
}
async function agent(method, p, body) {
  const r = await fetch(`http://127.0.0.1:8787${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

const k = await client(KONTRA, "k", true);
const kMe = await k.getMe();
let channel = null;
const groupArg = process.env.GROUP_ID;
let inputCh, peer;
if (groupArg) {
  peer = await k.resolvePeer(Number(groupArg));
} else {
  const res = await k.call({ _: "channels.createChannel", megagroup: true, title: "SB teste abertura", about: "teste" });
  channel = res.chats[0];
  peer = await k.resolvePeer(channel);
  const inv = await k.call({ _: "messages.exportChatInvite", peer });
  const hash = inv.link.split("/").pop().replace(/^\+/, "");
  // Cópia da sessão da Ana só para entrar no grupo e fechar logo em seguida.
  const a = await client(ANA, "a", false);
  await a.call({ _: "messages.importChatInvite", hash });
  await a.close?.().catch(() => {});
  console.log("grupo criado", channel.id);
}
const chId = Number(peer.channelId);
const groupId = `-100${chId}`;
const closeRights = { _: "chatBannedRights", untilDate: 0, sendMessages: true, sendPlain: true, sendMedia: true };
const openRights = { _: "chatBannedRights", untilDate: 0 };
const setRights = (r) => k.call({ _: "messages.editChatDefaultBannedRights", peer, bannedRights: r });
await setRights(closeRights).catch((e) => console.log("close", String(e)));

let arrived = null;
k.onRawUpdate.add((raw) => {
  const list = raw?.updates ?? (raw?.update ? [raw.update] : [raw]);
  for (const u of list) {
    const m = u?.message;
    if ((u?._ === "updateNewChannelMessage") && Number(m?.peerId?.channelId) === chId && Number(m?.fromId?.userId) !== Number(kMe.id)) {
      if (!arrived) arrived = { t: Date.now(), id: m.id };
    }
  }
});

const results = [];
for (let i = 0; i < ROUNDS; i++) {
  arrived = null;
  const jobId = `bench-open-${Date.now()}-${i}`;
  await agent("POST", "/jobs", { jobId, clientId: ANA, group: groupId, message: "hello", method: "abertura" });
  await sleep(5000);
  const tOpen = Date.now();
  await setRights(openRights);
  const tOpenAck = Date.now();
  // Visível de verdade: o Kontra lê o histórico a cada 25 ms (até 2 s).
  let visto = null;
  const vEnd = Date.now() + 2000;
  while (!visto && Date.now() < vEnd) {
    const h = await k.call({ _: "messages.getHistory", peer, offsetId: 0, offsetDate: 0, addOffset: 0, limit: 1, maxId: 0, minId: 0, hash: Long.ZERO }).catch(() => null);
    const m = h?.messages?.[0];
    if (m?._ === "message" && Number(m.fromId?.userId) !== Number(kMe.id)) visto = Date.now();
    else await sleep(25);
  }
  const deadline = Date.now() + 3000;
  while (!arrived && Date.now() < deadline) await sleep(2);
  let srv = null;
  const ev = await agent("GET", `/events?since=${tOpen - 1000}`);
  const se = (ev.events || []).find((e) => e.jobId === jobId && e.level === "success");
  srv = se?.text ?? null;
  // A abertura acontece entre tOpen e tOpenAck: os dois limites são mostrados.
  const row = { i, openRtt: tOpenAck - tOpen, desdeAbrir: se ? se.t - tOpen : null, desdeAckAbrir: se ? se.t - tOpenAck : null, chegouNoKontra: arrived ? arrived.t - tOpen : null, visivel: visto ? visto - tOpen : null, servidor: srv };
  results.push(row);
  console.log(JSON.stringify(row));
  await agent("DELETE", `/jobs?jobId=${encodeURIComponent(jobId)}`);
  await setRights(closeRights);
  if (arrived) await k.call({ _: "channels.deleteMessages", channel: { _: "inputChannel", channelId: peer.channelId, accessHash: peer.accessHash }, id: [arrived.id] }).catch(() => {});
  await sleep(GAP_MS);
}
const vis = results.map((r) => r.visivel).filter((x) => x != null).sort((x, y) => x - y);
console.log("VISIVEL", { n: vis.length, min: vis[0], mediana: vis[Math.floor(vis.length / 2)], max: vis.at(-1) });
const v = results.map((r) => r.desdeAbrir).filter((x) => x != null).sort((x, y) => x - y);
console.log("RESUMO", { n: v.length, min: v[0], mediana: v[Math.floor(v.length / 2)], max: v.at(-1), falhas: results.length - v.length });
console.log("GROUP_ID", groupId);
if (channel && process.env.KEEP_GROUP !== "1") await k.call({ _: "channels.deleteChannel", channel: { _: "inputChannel", channelId: peer.channelId, accessHash: peer.accessHash } }).catch(() => {});
await k.close?.().catch(()=>{});
fs.rmSync("/tmp/bench", { recursive: true, force: true });
process.exit(0);
