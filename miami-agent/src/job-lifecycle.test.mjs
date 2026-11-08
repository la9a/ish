// Run only against an inspected, isolated copy of the supplied VPS package:
// MIAMI_REVIEW_ROOT=/tmp/miami-vps-preparada-review node --test miami-agent/src/job-lifecycle.test.mjs
// These are acceptance tests. Failures are findings, not expected-success assertions.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const fixture = process.env.MIAMI_REVIEW_ROOT
  ? pathToFileURL(path.join(path.resolve(process.env.MIAMI_REVIEW_ROOT), "test/job-fixture.mjs"))
  : new URL("../test/job-fixture.mjs", import.meta.url);
const { createJobFixture, messageUpdate } = await import(
  fixture
);

test("opening ignores updates that do not prove writing is open in the target", async (t) => {
  const f = createJobFixture("abertura");
  t.after(() => f.close());
  await f.ready;
  f.emit({ _: "updateUserStatus", userId: 999, status: { _: "userStatusOnline" } });
  assert.equal(f.dispatched.length, 0);
});

test("an admin message in a basic chat cannot trigger a channel with the same numeric id", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  const unrelated = messageUpdate();
  unrelated._ = "updateNewMessage";
  unrelated.message.peerId = { _: "peerChat", chatId: 123 };
  f.emit(unrelated);
  assert.equal(f.dispatched.length, 0);
});

test("an RPC error after own-message success cannot publish a contradictory error", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate());
  f.emit(messageUpdate({ id: 102, sender: 7, out: true }));
  assert.equal(f.positions.length, 1);
  assert.equal(f.events.filter((event) => event.level === "success").length, 1);
  f.rejectRpc(new Error("RPC_CALL_FAIL"));
  await f.flushSends();
  assert.equal(f.events.filter((event) => event.level === "error").length, 0);
});

test("cancellation while loading admins cannot register a new handler or timers", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  let releaseAdmins;
  let started;
  const loading = new Promise((resolve) => { started = resolve; });
  f.job.loadAdmins = () => {
    started();
    return new Promise((resolve) => { releaseAdmins = resolve; });
  };
  await loading;
  f.job.stop();
  releaseAdmins(new Set([42]));
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(f.job.rawHandler, null);
  assert.equal(f.timers.size, 0);
});

test("opening keeps chat and channel permission updates separate", async (t) => {
  const f = createJobFixture("abertura");
  t.after(() => f.close());
  await f.ready;
  f.emit({
    _: "updateChatDefaultBannedRights",
    peer: { _: "peerChat", chatId: 123 },
    defaultBannedRights: {},
  });
  assert.equal(f.dispatched.length, 0);
});

test("a late flood error after cancellation cannot rearm work or publish a warning", async (t) => {
  const f = createJobFixture("mensagem");
  t.after(() => f.close());
  await f.ready;
  f.emit(messageUpdate());
  f.job.stop();
  f.rejectRpc(new Error("FLOOD_WAIT_2"));
  await f.flushSends();
  assert.equal(f.events.filter((event) => event.level === "warn").length, 0);
  assert.equal(f.job.nextAllowedAt, 0);
  assert.equal(f.timers.size, 0);
});

test("cancellation while opening mode loads admins cannot register new work", async (t) => {
  const f = createJobFixture("abertura");
  t.after(() => f.close());
  let releaseAdmins;
  let started;
  const loading = new Promise((resolve) => { started = resolve; });
  f.job.loadAdmins = () => {
    started();
    return new Promise((resolve) => { releaseAdmins = resolve; });
  };
  await loading;
  f.job.stop();
  releaseAdmins(new Set([42]));
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(f.job.rawHandler, null);
  assert.equal(f.timers.size, 0);
});
