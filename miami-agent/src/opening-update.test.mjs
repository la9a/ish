import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Exercise the actual callback without connecting accounts or starting HTTP.
const source = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
const start = source.indexOf("    this.rawHandler = (info) => {");
const end = source.indexOf("    this.acc.main.onRawUpdate.add(this.rawHandler);", start);
assert.ok(start >= 0 && end > start);
const callback = source.slice(start, end);

function fixture() {
  const sent = [];
  const confirmed = [];
  const job = {
    acc: { sentMessageId: () => null },
    payload: { randomId: "test-only" },
    cfg: { message: "hello" },
    baselineId: 100,
    startedAt: Date.now() - 1000,
    admins: new Set([42]),
    fire: (reason) => sent.push(reason),
    finish: (ms, id) => confirmed.push({ ms, id }),
    reconcileOnce: () => {},
  };
  const context = vm.createContext({
    job, Date, performance, chatId: 123, selfId: 7,
    samePeer: (peer) => peer?.channelId === 123,
    numericMessageId: (id) => Number.isSafeInteger(id) && id > 0 ? id : null,
    channelWriteState: (chat) => chat?.open ? "open" : "closed",
  });
  vm.runInContext(`(function () { ${callback} }).call(job)`, context);
  return { job, sent, confirmed };
}

test("a permission opening update immediately reaches the send trigger", () => {
  const { job, sent } = fixture();
  job.rawHandler({ update: { _: "updateChannel", channelId: 123 }, peers: { chats: new Map([[123, { open: true }]]) } });
  assert.deepEqual(sent, ["permissoes"]);
});

test("a new non-admin member message reaches the opening trigger", () => {
  const { job, sent } = fixture();
  job.rawHandler({ _: "updateNewChannelMessage", message: { _: "message", id: 101, date: Math.floor(Date.now() / 1000), peerId: { channelId: 123 }, fromId: { _: "peerUser", userId: 8 } } });
  assert.deepEqual(sent, ["mensagem-membro"]);
});

test("own message confirms its concrete id even during an in-flight send", () => {
  const { job, sent, confirmed } = fixture();
  job.firing = true;
  job.lastSendAt = Date.now() - 20;
  job.rawHandler({ update: { _: "updateNewChannelMessage", message: { _: "message", id: 102, out: true, peerId: { channelId: 123 }, message: "hello" } } });
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].id, 102);
  assert.deepEqual(sent, []);
});