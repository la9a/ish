import test from "node:test";
import assert from "node:assert/strict";
import { createJobFixture, messageUpdate } from "../test/job-fixture.mjs";

test("admin trigger dispatches immediately and own update confirms before delayed ACK", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.traces.length = 0;
  f.emit({ update: messageUpdate({ text: "liberado" }) });
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].priorTraces, 0, "No log I/O ahead of dispatch");
  assert.equal(f.job.tl.sinal, "mensagem-admin");
  assert.equal(f.job.tl.motivo, "mensagem-admin");
  assert.equal(typeof f.job.tl.recebido, "number");
  f.emit({ updates: [messageUpdate({ id: 102, sender: 7, out: true })] });
  assert.equal(f.positions.length, 1, "Confirmation does not wait for the RPC");
  assert.equal(f.positions[0].sentId, 102);
  assert.equal(f.job.tl.confirmacaoVia, "propria-mensagem");
  f.resolveRpc({ _: "updateShortSentMessage", id: 102 });
  await f.flushSends();
  assert.equal(f.events.filter((event) => event.level === "success").length, 1);
  assert.equal(f.dispatched.length, 1);
});

test("correlated random id confirms while the admin send is in flight", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate());
  f.sentIds.set(f.job.payload.randomId, 102);
  f.emit({ _: "updateMessageID", id: 102, randomId: f.job.payload.randomId });
  assert.equal(f.positions[0].sentId, 102);
  assert.equal(f.job.tl.confirmacaoVia, "random-id");
});

test("unrelated messages, old-id admin replay and own messages cannot trigger an admin send", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.traces.length = 0;
  for (const update of [
    messageUpdate({ peer: 456 }),
    messageUpdate({ sender: 8 }),
    messageUpdate({ id: 100 }),
    messageUpdate({ sender: 7, out: true }),
  ])
    f.emit(update);
  assert.equal(f.dispatched.length, 0);
  assert.equal(f.traces.length, 0);
});

test("other peer, incoming text, old id and different text cannot confirm our send", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate());
  for (const update of [
    messageUpdate({ id: 102, peer: 456, out: true }),
    messageUpdate({ id: 102, sender: 8 }),
    messageUpdate({ id: 100, out: true }),
    messageUpdate({ id: 102, text: "other", out: true }),
  ])
    f.emit(update);
  assert.equal(f.positions.length, 0);
  assert.equal(f.dispatched.length, 1);
  f.job.lastSendAt = Date.now() - 10_001;
  f.emit(messageUpdate({ id: 102, out: true }));
  assert.equal(f.positions.length, 0, "Expired text match is not proof");
});

test("simultaneous admin updates reserve one send before awaiting the ACK", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate({ id: 101 }));
  f.emit(messageUpdate({ id: 102 }));
  f.emit(messageUpdate({ id: 103 }));
  assert.equal(f.dispatched.length, 1);
});

test("a history reply after raw dispatch cannot move the confirmation baseline", async (t) => {
  let releaseHistory;
  const history = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  const f = createJobFixture("mensagem", { readCall: () => history });
  t.after(() => f.close());
  await f.ready;
  const poll = f.timers.get(f.job.msgPoll).fn();
  f.emit(messageUpdate({ id: 101 }));
  releaseHistory({ messages: [messageUpdate({ id: 200, sender: 8 }).message] });
  await poll;
  assert.equal(f.job.baselineId, 100);
  f.emit(messageUpdate({ id: 102, out: true }));
  assert.equal(f.positions[0].sentId, 102);
});

test("polling keeps its own cursor and marks fallback sends distinctly", async (t) => {
  let latest = messageUpdate({ id: 101, sender: 8 }).message;
  const f = createJobFixture("mensagem", { readCall: async () => ({ messages: [latest] }) });
  t.after(() => f.close());
  await f.ready;
  const poll = f.timers.get(f.job.msgPoll).fn;
  await poll();
  assert.equal(f.job.baselineId, 100);
  assert.equal(f.dispatched.length, 0);
  latest = messageUpdate({ id: 102 }).message;
  await poll();
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.job.tl.sinal, "historico-admin");
  assert.equal(f.job.tl.motivo, "historico-admin");
});

test("a duplicate reply remains unconfirmed until a concrete message id arrives", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate());
  f.resolveRpc({ __duplicate: true });
  await f.flushSends();
  assert.equal(f.job.sent, false);
  assert.equal(f.positions.length, 0);
  assert.equal(f.events.filter((event) => event.level === "success").length, 0);
  f.sentIds.set(f.job.payload.randomId, 102);
  f.timers.get(f.job.dupTimer).fn();
  assert.equal(f.positions[0].sentId, 102);
  assert.equal(f.dispatched.length, 1);
});

test("FLOOD_WAIT still blocks another dispatch until the Telegram deadline", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  const before = Date.now();
  f.emit(messageUpdate());
  f.rejectRpc(new Error("FLOOD_WAIT_2"));
  await f.flushSends();
  assert.ok(f.job.nextAllowedAt >= before + 2000);
  f.emit(messageUpdate({ id: 102 }));
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.positions.length, 0);
});

test("basic-chat confirmation keeps channel ids with the same number separate", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  f.job.payload.peer = { _: "inputPeerChat", chatId: 123 };
  await f.ready;
  const trigger = messageUpdate();
  trigger._ = "updateNewMessage";
  trigger.message.peerId = { _: "peerChat", chatId: 123 };
  f.emit(trigger);
  assert.equal(f.dispatched.length, 1);
  f.emit(messageUpdate({ id: 102, out: true }));
  assert.equal(f.positions.length, 0, "A channel with the same numeric id is a different peer");
  const own = messageUpdate({ id: 102, out: true });
  own._ = "updateNewMessage";
  own.message.peerId = { _: "peerChat", chatId: 123 };
  f.emit(own);
  assert.equal(f.positions[0].sentId, 102);
});
