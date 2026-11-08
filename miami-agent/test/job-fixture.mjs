import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing source boundary: ${start}`);
  return source.slice(a, b);
};

export function createJobFixture(method = "abertura", overrides = {}) {
  const dispatched = [],
    events = [],
    positions = [],
    traces = [],
    firePromises = [];
  const timers = new Map(),
    listeners = new Set(),
    sentIds = new Map();
  let nextTimer = 0,
    resolveReady,
    resolveRpc,
    rejectRpc;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const rpc = new Promise((resolve, reject) => {
    resolveRpc = resolve;
    rejectRpc = reject;
  });
  const timer = (fn, ms) => {
    const id = ++nextTimer;
    timers.set(id, { fn, ms });
    return id;
  };
  const account = {
    selfId: 7,
    main: {
      call: async () => ({}),
      onRawUpdate: {
        add(fn) {
          listeners.add(fn);
          resolveReady();
        },
        remove(fn) {
          listeners.delete(fn);
        },
      },
    },
    sentMessageId: (id) => sentIds.get(id) ?? null,
    closePeer() {},
  };
  const context = vm.createContext({
    Date,
    performance,
    Long: { ZERO: 0, isLong: () => false },
    SEND_NO_UPDATES: false,
    RECONCILE_MS: 0,
    JOB_TTL_MS: 60_000,
    setInterval: timer,
    setTimeout: timer,
    clearInterval: (id) => timers.delete(id),
    clearTimeout: (id) => timers.delete(id),
    setImmediate: (fn) => timer(fn, 0),
    console: { log: (...args) => traces.push(args), error: (...args) => traces.push(args) },
    log: (jobId, level, text, extra) => events.push({ jobId, level, text, ...extra }),
    registerForPosition: (entry) => positions.push(entry),
    readCall: overrides.readCall ?? (async () => ({ messages: [] })),
    fastSend: (client, payload, options) => {
      dispatched.push({ client, payload, options, priorTraces: traces.length });
      return rpc;
    },
  });
  vm.runInContext(
    [
      between("const PEER_RE =", "const USE_ALT ="),
      between("function numericMessageId(", "function senderId("),
      between("function channelWriteState(", "const sleep ="),
      between("function peerKey(", "/** Apuração da senha:"),
      between("class Job {", "\nconst MT_ORIGIN ="),
      "globalThis.Job = Job;",
    ].join("\n"),
    context,
  );
  const job = new context.Job(
    { jobId: "fixture-job", group: "fixture-group", message: "hello", method },
    account,
  );
  job.payload = {
    peer: { _: "inputPeerChannel", channelId: 123, accessHash: 0 },
    randomId: "fixture-random",
    text: "hello",
  };
  job.baselineId = 100;
  job.prewarm = async () => {};
  job.loadAdmins = async () => new Set([42]);
  job.reconcileOnce = async () => {};
  const fire = job.fire.bind(job);
  job.fire = (...args) => {
    const pending = fire(...args);
    firePromises.push(pending);
    return pending;
  };
  const running = job.run();
  return {
    job,
    account,
    dispatched,
    events,
    positions,
    traces,
    timers,
    sentIds,
    ready,
    emit: (update) => {
      for (const fn of [...listeners]) fn(update);
    },
    resolveRpc,
    rejectRpc,
    flushSends: () => Promise.all(firePromises),
    async close() {
      job.stop();
      if (dispatched.length) rejectRpc(new Error("fixture_cancelled"));
      else resolveRpc({});
      await Promise.all(firePromises);
      await running;
      timers.clear();
    },
  };
}

export function messageUpdate({
  id = 101,
  peer = 123,
  sender = 42,
  out = false,
  text = "hello",
  date = Math.floor(Date.now() / 1000),
} = {}) {
  return {
    _: "updateNewChannelMessage",
    message: {
      _: "message",
      id,
      date,
      out,
      message: text,
      peerId: { _: "peerChannel", channelId: peer },
      fromId: { _: "peerUser", userId: sender },
    },
  };
}
