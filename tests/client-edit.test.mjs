import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const hashA = "a".repeat(32);
const hashB = "b".repeat(32);
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture({ connected = true, session = "saved-session" } = {}) {
  let owner = "operator-A";
  const records = new Map([
    [
      "operator-A:client-A",
      {
        id: "client-A",
        title: "Lola",
        phone: "+5511999990001",
        hasSession: connected,
        method: "abertura2",
        scheduleEnv: "17:59:36",
      },
    ],
    [
      "operator-A:client-B",
      { id: "client-B", title: "Luiz", phone: "+5511999990002", hasSession: false },
    ],
  ]);
  const creds = new Map([
    ["operator-A:client-A", { apiId: 123456, apiHash: hashA }],
    ["operator-A:client-B", { apiId: 654321, apiHash: hashB }],
  ]);
  const writes = [];
  const events = [];
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/clientEdit.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    Event,
    window: { dispatchEvent: (event) => events.push(event.type) },
    require(name) {
      if (name === "@/lib/appAuth") return { appAuth: { currentUserId: () => owner } };
      if (name === "@/lib/cloudSync")
        return {
          pushCreds: (user, id, value) => writes.push(["cloud-creds", user, id, plain(value)]),
        };
      if (name === "@/lib/storage")
        return {
          clientsStore: {
            get: (id) => records.get(`${owner}:${id}`),
            update(id, patch) {
              writes.push(["client", owner, id, plain(patch)]);
              records.set(`${owner}:${id}`, { ...records.get(`${owner}:${id}`), ...patch });
            },
          },
          clientData: {
            getCreds: (id) => creds.get(`${owner}:${id}`) ?? null,
            getSession: (id) => (id === "client-A" ? session : ""),
          },
          storage: {
            _setCredsLocalFor(id, value) {
              writes.push(["local-creds", owner, id, plain(value)]);
              creds.set(`${owner}:${id}`, plain(value));
            },
          },
        };
      throw new Error(`Unexpected operation/import: ${name}`);
    },
  });
  return {
    ...exports,
    records,
    creds,
    writes,
    events,
    changeOwner: (next) => {
      owner = next;
    },
  };
}

test("editing metadata preserves the saved session, API pair, method and exact schedule", () => {
  const f = fixture();
  const draft = {
    ...f.readClientEdit("client-A").draft,
    title: "Lola atualizada",
    phone: "+55 (11) 98888-7777",
  };
  const result = f.saveClientEdit("client-A", "operator-A", draft);
  assert.equal(result.client.title, "Lola atualizada");
  assert.equal(result.client.phone, "+5511988887777");
  assert.equal(result.client.scheduleEnv, "17:59:36");
  assert.equal(result.client.method, "abertura2");
  assert.equal(result.client.hasSession, true);
  assert.deepEqual(f.creds.get("operator-A:client-A"), { apiId: 123456, apiHash: hashA });
  assert.deepEqual(
    f.writes.map((write) => write[0]),
    ["client"],
  );
  assert.deepEqual(f.events, ["cloud:changed"]);
});

test("API changes cannot overwrite credentials associated with either a flagged or locally saved session", () => {
  for (const options of [
    { connected: true, session: "" },
    { connected: false, session: "saved-session" },
  ]) {
    const f = fixture(options);
    const draft = { ...f.readClientEdit("client-A").draft, apiHash: hashB };
    assert.match(f.saveClientEdit("client-A", "operator-A", draft).error, /somente para consulta/);
    assert.deepEqual(f.writes, []);
  }
});

test("a disconnected client can update its complete API pair without writing another client or creating a session", () => {
  const f = fixture({ connected: false, session: "" });
  const originalOther = plain(f.creds.get("operator-A:client-B"));
  const draft = {
    ...f.readClientEdit("client-A").draft,
    apiId: "777777",
    apiHash: hashB.toUpperCase(),
  };
  const result = f.saveClientEdit("client-A", "operator-A", draft);
  assert.ok(result.client);
  assert.deepEqual(f.creds.get("operator-A:client-A"), { apiId: 777777, apiHash: hashB });
  assert.deepEqual(f.creds.get("operator-A:client-B"), originalOther);
  assert.deepEqual(
    f.writes.map((write) => write[0]),
    ["local-creds", "cloud-creds", "client"],
  );
  assert.equal(f.writes[0][2], "client-A");
  assert.equal(f.writes[1][1], "operator-A");
  assert.equal(result.client.hasSession, false);
});

test("invalid phone or partial/invalid API pairs are rejected before any write", () => {
  for (const patch of [
    { phone: "11999990001" },
    { apiId: "" },
    { apiHash: "bad-hash" },
    { apiId: "12e3" },
    { apiId: "2147483648" },
  ]) {
    const f = fixture({ connected: false, session: "" });
    const draft = { ...f.readClientEdit("client-A").draft, ...patch };
    assert.ok(f.saveClientEdit("client-A", "operator-A", draft).error);
    assert.deepEqual(f.writes, []);
  }
});

test("a form opened by another operator or for a deleted client cannot save", () => {
  const f = fixture();
  const draft = f.readClientEdit("client-A").draft;
  f.changeOwner("operator-B");
  assert.ok(f.saveClientEdit("client-A", "operator-A", draft).error);
  assert.deepEqual(f.writes, []);
  f.changeOwner("operator-A");
  f.records.delete("operator-A:client-A");
  assert.ok(f.saveClientEdit("client-A", "operator-A", draft).error);
  assert.deepEqual(f.writes, []);
});
