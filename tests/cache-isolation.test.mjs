import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual module against a controllable transport. Resolving account
// A's request after switching to B reproduces the stale-reply cache race.
const source = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fixture({
  results = {},
  secrets = Promise.resolve({}),
  clientSecrets = Promise.resolve(null),
  localValues = {},
} = {}) {
  let user = "A";
  const writes = [];
  const requests = [];
  const callbacks = [];
  let secretCalls = 0;
  const localStorage = {
    getItem: (key) => localValues[key] ?? null,
    setItem: (key, value) => writes.push({ user, kind: "migration", key, value }),
  };
  const storageModule = {
    clientsStore: {
      list: () => [],
      _setAll: (value) => writes.push({ user, kind: "clients", value }),
    },
    monitorSettings: {
      get: () => ({}),
      _setLocal: (value) => writes.push({ user, kind: "settings", value }),
    },
    storage: Object.fromEntries(
      ["_setCredsLocalFor", "_setSessionLocalFor", "_setGroupsLocalFor"].map((kind) => [
        kind,
        (id, value) => writes.push({ user, kind, id, value }),
      ]),
    ),
    clientData: { getCreds: () => null, getSession: () => null },
  };
  const channel = {
    on(_event, _filter, callback) {
      callbacks.push(callback);
      return this;
    },
    subscribe() {
      return this;
    },
  };
  const supabase = {
    from(table) {
      requests.push(table);
      const builder = new Proxy(
        {},
        {
          get(_obj, prop) {
            if (prop === "then") {
              const response = results[table] ?? {
                data: table === "monitor_settings" ? {} : [],
                error: null,
              };
              return Promise.resolve(response).then.bind(Promise.resolve(response));
            }
            return () => builder;
          },
        },
      );
      return builder;
    },
    channel: () => channel,
    removeChannel: () => Promise.resolve(),
  };
  const exports = {};
  const modules = {
    "@/integrations/supabase/client": { supabase },
    "@/lib/appAuth": { appAuth: { currentUserId: () => user, current: () => user.toLowerCase() } },
    "@/lib/storage": storageModule,
    "@/lib/sessionCrypto.functions": {
      pullAllClientSecrets: () => {
        secretCalls++;
        return secrets;
      },
      pullClientSecrets: () => clientSecrets,
      pushClientSecrets: () => {
        writes.push({ user, kind: "pushSecrets" });
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(modules[id], `Unexpected module: ${id}`);
      return modules[id];
    },
    window: { localStorage, sessionStorage: { getItem: () => "client-a" } },
    console,
    Date,
    Map,
  });
  return {
    api: exports,
    writes,
    requests,
    callbacks,
    setUser: (next) => {
      user = next;
    },
    secretCalls: () => secretCalls,
  };
}

async function flush() {
  await new Promise((r) => setImmediate(r));
}

test("late client-list reply from A cannot write B's cache or fetch secrets", async () => {
  const clients = deferred();
  const f = fixture({ results: { clients: clients.promise } });
  const pending = f.api.pullAll("A");
  f.setUser("B");
  clients.resolve({ data: [{ id: "a-client", title: "A only" }], error: null });
  await pending;
  assert.deepEqual(f.writes, []);
  assert.equal(f.secretCalls(), 0);
  assert.deepEqual(f.requests, ["clients"]);
});

test("late decrypted credentials from A cannot write B's cache", async () => {
  const secrets = deferred();
  const f = fixture({
    results: { clients: { data: [{ id: "a-client", title: "A only" }], error: null } },
    secrets: secrets.promise,
  });
  const pending = f.api.pullAll("A");
  await flush();
  assert.equal(f.secretCalls(), 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].user, "A");
  f.setUser("B");
  secrets.resolve({ "a-client": { apiId: 42, apiHash: "test-hash", session: "test-session" } });
  await pending;
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.requests, ["clients"]);
});

test("late settings reply cannot overwrite the new account settings", async () => {
  const settings = deferred();
  const f = fixture({ results: { monitor_settings: settings.promise } });
  const pending = f.api.pullAll("A");
  await flush();
  assert.ok(f.requests.includes("monitor_settings"));
  f.setUser("B");
  settings.resolve({ data: { auto_stop: false }, error: null });
  await pending;
  assert.equal(f.writes.filter((w) => w.user === "B").length, 0);
});

test("late group reply cannot add A's draft to B's account", async () => {
  const groups = deferred();
  const f = fixture({ results: { monitored_groups: groups.promise } });
  const pending = f.api.pullGroups("A", "a-client");
  f.setUser("B");
  groups.resolve({ data: [{ id: "a-group", message: "A private draft" }], error: null });
  await pending;
  assert.deepEqual(f.writes, []);
});

test("late single-client secret reply cannot write after logout", async () => {
  const secret = deferred();
  const f = fixture({ clientSecrets: secret.promise });
  const pending = f.api.pullClientSecrets("A", "a-client");
  f.setUser(null);
  secret.resolve({ apiId: 42, apiHash: "test-hash", session: "test-session" });
  await pending;
  assert.deepEqual(f.writes, []);
});

test("in-flight legacy migration does not push A's records under B's session", async () => {
  const count = deferred();
  const g = fixture({
    results: { clients: count.promise },
    localValues: {
      "cloud_migrated_v1:A": "1",
      "tg_app_v2:a:clients_index_v1": JSON.stringify([{ id: "a-client", title: "A only" }]),
    },
  });
  const pending = g.api.migrateLegacyLocalDataOnce("A", "a");
  g.setUser("B");
  count.resolve({ count: 0, error: null });
  await pending;
  assert.deepEqual(g.writes, []);
  assert.deepEqual(g.requests, ["clients"]);
});

test("stale realtime callbacks stop issuing requests and notifying B", async () => {
  const f = fixture();
  let changed = 0;
  const stop = f.api.subscribeRealtime("A", () => {
    changed++;
  });
  f.setUser("B");
  for (const callback of f.callbacks) callback();
  await flush();
  assert.deepEqual(f.requests, []);
  assert.equal(changed, 0);
  stop();
});

test("valid current-account pulls still apply data", async () => {
  const f = fixture({
    results: { monitored_groups: { data: [{ id: "a-group", message: "A draft" }], error: null } },
  });
  await f.api.pullGroups("A", "a-client");
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].user, "A");
  assert.equal(f.writes[0].value[0].message, "A draft");
});

test("realtime reply started by A cannot notify after B signs in", async () => {
  const clients = deferred();
  const f = fixture({ results: { clients: clients.promise } });
  let changed = 0;
  f.api.subscribeRealtime("A", () => {
    changed++;
  });
  f.callbacks[0]();
  assert.deepEqual(f.requests, ["clients"]);
  f.setUser("B");
  clients.resolve({ data: [{ id: "a-client", title: "A only" }], error: null });
  await flush();
  assert.deepEqual(f.writes, []);
  assert.equal(changed, 0);
});

test("stale writes and subscriptions for A are rejected under B's session", async () => {
  const f = fixture();
  f.setUser("B");
  f.api.pushClient("A", { id: "a-client", title: "A only" });
  f.api.pushCreds("A", "a-client", { apiId: 42, apiHash: "test-hash" });
  f.api.pushSession("A", "a-client", "test-session");
  f.api.pushGroup("A", "a-client", { id: "a-group", message: "A private draft" });
  f.api.deleteClient("A", "a-client");
  f.api.deleteGroup("A", "a-client", "a-group");
  await f.api.pushSettings("A", {});
  f.api.subscribeRealtime("A", () => {});
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.callbacks, []);
});
