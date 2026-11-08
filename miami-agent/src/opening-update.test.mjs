import test from "node:test";
import assert from "node:assert/strict";
import { createJobFixture, messageUpdate } from "../test/job-fixture.mjs";

test("a permission opening update immediately dispatches the send", async (t) => {
  const f = createJobFixture();
  t.after(() => f.close());
  await f.ready;
  f.emit({
    update: { _: "updateChannel", channelId: 123 },
    peers: { chats: new Map([[123, { _: "channel", defaultBannedRights: {} }]]) },
  });
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.job.tl.motivo, "permissoes");
});

test("a new non-admin member message immediately dispatches the send", async (t) => {
  const f = createJobFixture();
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate({ sender: 8 }));
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.job.tl.motivo, "mensagem-membro");
});

test("own message confirms its concrete id before the RPC settles", async (t) => {
  const f = createJobFixture();
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate({ sender: 8 }));
  assert.equal(f.job.firing, true);
  f.emit({ update: messageUpdate({ id: 102, sender: 7, out: true }) });
  assert.equal(f.positions.length, 1);
  assert.equal(f.positions[0].sentId, 102);
  assert.equal(f.job.tl.confirmacaoVia, "propria-mensagem");
  f.resolveRpc({ _: "updateShortSentMessage", id: 102 });
  await f.flushSends();
  assert.equal(f.positions.length, 1);
  assert.equal(f.events.filter((event) => event.level === "success").length, 1);
});
