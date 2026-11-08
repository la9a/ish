import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(file) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const converted = {};
vm.runInNewContext(compile("../src/lib/clockFormat.ts"), {
  exports: converted,
  Intl,
  Date,
  Number,
});
const { normalizeTime24, time24To12, time12To24, formatClockTime, formatBrasiliaClock } = converted;

test("17:59:36 displays as 5:59:36 PM without changing the canonical schedule", () => {
  assert.equal(formatClockTime("17:59:36", "12h"), "5:59:36 PM");
  assert.equal(formatClockTime("17:59:36", "24h"), "17:59:36");
  assert.equal(time12To24("5:59:36", "PM"), "17:59:36");
});
test("midnight and noon have correct 12h labels and round trips", () => {
  assert.equal(formatClockTime("00:00:00", "12h"), "12:00:00 AM");
  assert.equal(formatClockTime("12:00:00", "12h"), "12:00:00 PM");
  assert.equal(time12To24("12:00:00", "AM"), "00:00:00");
  assert.equal(time12To24("12:00:00", "PM"), "12:00:00");
});
test("all 24 hours round trip with AM/PM, including the last second", () => {
  for (let hour = 0; hour < 24; hour++) {
    const canonical = `${String(hour).padStart(2, "0")}:59:59`;
    const { time, period } = time24To12(canonical);
    assert.equal(time12To24(time, period), canonical);
  }
});
test("legacy HH:MM gains seconds and preserves the intended hour", () => {
  assert.equal(normalizeTime24("09:07"), "09:07:00");
  assert.equal(time12To24("09:07", "AM"), "09:07:00");
  assert.equal(time12To24("9:07", "PM"), "21:07:00");
});
test("invalid hours, minutes, seconds and periods cannot become stored schedules", () => {
  for (const value of [
    "24:00:00",
    "25:59",
    "12:60:00",
    "12:00:60",
    "1:59:36",
    "",
    " 17:59:36",
    "17:59:36 PM",
  ]) {
    assert.equal(normalizeTime24(value), null, value);
  }
  for (const value of ["00:00:00", "13:01:00", "12:60:00", "1:59:60", "", "5:9:36"]) {
    assert.equal(time12To24(value, "PM"), null, value);
  }
  assert.equal(time12To24("12:00:00", "invalid"), null);
  assert.equal(formatClockTime("not-a-time", "12h"), "--:--:--");
});
test("server timestamp is rendered in Brasília regardless of execution timezone", () => {
  const timestamp = Date.UTC(2026, 10, 5, 20, 59, 36);
  assert.equal(formatBrasiliaClock(timestamp, "24h"), "17:59:36");
  assert.equal(formatBrasiliaClock(timestamp, "12h"), "5:59:36 PM");
  assert.equal(formatBrasiliaClock(Date.UTC(2026, 10, 5, 3, 0, 0), "12h"), "12:00:00 AM");
  assert.equal(formatBrasiliaClock(Number.NaN, "12h"), "--:--:--");
});

function storageFixture() {
  const local = new Map();
  let user = "A";
  const events = new EventTarget();
  const authListeners = new Set();
  const exports = {};
  const context = {
    exports,
    Event,
    require(name) {
      if (name === "@/lib/appAuth")
        return {
          appAuth: {
            currentUserId: () => user,
            current: () => user?.toLowerCase() ?? null,
            subscribe(fn) {
              authListeners.add(fn);
              return () => authListeners.delete(fn);
            },
          },
        };
      if (name === "@/lib/cloudSync")
        return new Proxy(
          {},
          {
            get() {
              throw new Error("Clock preference must not sync to Supabase");
            },
          },
        );
      throw new Error(`Unexpected import: ${name}`);
    },
    window: {
      localStorage: {
        getItem: (key) => local.get(key) ?? null,
        setItem: (key, value) => local.set(key, value),
        removeItem: (key) => local.delete(key),
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  };
  const code = compile("../src/lib/storage.ts");
  vm.runInNewContext(code, context);
  return {
    prefs: exports.clockPrefs,
    local,
    restore() {
      const next = {};
      vm.runInNewContext(code, { ...context, exports: next });
      return next.clockPrefs;
    },
    switchUser(next) {
      user = next;
      authListeners.forEach((listener) => listener(user));
    },
    storageEvent(key) {
      events.dispatchEvent(Object.assign(new Event("storage"), { key }));
    },
  };
}

test("preference persists on this device and stays isolated between operators", () => {
  const f = storageFixture();
  assert.equal(f.prefs.getFormat(), "24h");
  f.prefs.setFormat("12h");
  assert.equal(f.prefs.getFormat(), "12h");
  assert.equal(f.restore().getFormat(), "12h", "survives module/device-page reload");
  f.switchUser("B");
  assert.equal(f.prefs.getFormat(), "24h");
  f.prefs.setFormat("24h");
  f.switchUser("A");
  assert.equal(f.prefs.getFormat(), "12h");
  assert.deepEqual([...f.local.keys()].sort(), [
    "tg_cloud_v1:A:clock_format_v1",
    "tg_cloud_v1:B:clock_format_v1",
  ]);
});
test("clock subscribers react to preference, auth and relevant cross-tab changes and unsubscribe", () => {
  const f = storageFixture();
  let changes = 0;
  const unsubscribe = f.prefs.subscribe(() => {
    changes++;
  });
  f.prefs.setFormat("12h");
  assert.equal(changes, 1);
  f.storageEvent("tg_cloud_v1:B:clock_format_v1");
  assert.equal(changes, 1);
  f.storageEvent("tg_cloud_v1:A:clock_format_v1");
  assert.equal(changes, 2);
  f.switchUser("B");
  assert.equal(changes, 3);
  unsubscribe();
  f.prefs.setFormat("12h");
  f.switchUser("A");
  assert.equal(changes, 3);
});
test("corrupt or unsupported saved preferences fall back to 24h without cloud writes", () => {
  const f = storageFixture();
  f.local.set("tg_cloud_v1:A:clock_format_v1", "broken json");
  assert.equal(f.prefs.getFormat(), "24h");
  f.local.set("tg_cloud_v1:A:clock_format_v1", JSON.stringify("13h"));
  assert.equal(f.prefs.getFormat(), "24h");
  f.prefs.setFormat("13h");
  assert.equal(f.prefs.getFormat(), "24h");
});

function sourceAst(file) {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function bindFunction(node, ast, scope) {
  return new Function(
    ...Object.keys(scope),
    `${stripTypeScriptTypes(node.getText(ast))}; return ${node.name.text};`,
  )(...Object.values(scope));
}
const scheduleAst = sourceAst("../src/components/ScheduleTimeCard.tsx");
const scheduleHelper = (name, scope = {}) =>
  bindFunction(
    scheduleAst.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    ),
    scheduleAst,
    scope,
  );

test("12h editor masks a one-digit hour and rejects rather than clamps invalid 12h time", () => {
  const mask = scheduleHelper("mask");
  assert.equal(mask("5:59:36", "12h"), "05:59:36");
  assert.equal(mask("055936", "12h"), "05:59:36");
  assert.equal(mask("13:60:00", "12h"), "13:60:00");
  assert.equal(time12To24(mask("13:60:00", "12h"), "PM"), null);
});
test("actual schedule editor saves PM in canonical 24h and refuses changes while running", () => {
  const canonicalValue = scheduleHelper("canonicalValue", { time12To24, normalizeTime24 });
  const editorValue = scheduleHelper("editorValue", { time24To12 });
  const component = scheduleAst.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ScheduleTimeCard",
  );
  const confirm = component.body.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "confirm",
  );
  const finalValue = canonicalValue({ time: "05:59:36", period: "PM", format: "12h" });
  const writes = [];
  const scope = {
    finalValue,
    running: false,
    clientId: "client-a",
    format: "12h",
    editorValue,
    setEditor: () => {},
    setEditing: () => {},
    onSaved: () => {},
    clientsStore: { update: (id, patch) => writes.push({ id, patch }) },
  };
  bindFunction(confirm, scheduleAst, scope)();
  assert.equal(writes[0].patch.scheduleEnv, "17:59:36");
  bindFunction(confirm, scheduleAst, { ...scope, running: true })();
  assert.equal(writes.length, 1);
});
test("countdown remains an elapsed duration independent of 12h/24h display", () => {
  const remaining = scheduleHelper("remainingLabel", {
    isClockSynced: () => true,
    serverNow: () => 1000,
  });
  assert.equal(remaining(1000 + (13 * 3600 + 5 * 60 + 9) * 1000), "faltam 13:05:09");
  assert.equal(remaining(1000), "horário atingido");
  const unsynced = scheduleHelper("remainingLabel", {
    isClockSynced: () => false,
    serverNow: () => {
      throw new Error("No device-time fallback");
    },
  });
  assert.equal(unsynced(1000), "sincronizando horário de Brasília…");
});
test("actual clock effect waits for sync and takes its timestamp exclusively from serverNow", () => {
  const ast = sourceAst("../src/components/BrasiliaClock.tsx");
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect);
  let synced = false;
  const values = [],
    timers = [];
  const corrected = Date.UTC(2026, 10, 5, 20, 59, 36);
  const scope = {
    syncServerClock: () => Promise.resolve(),
    isClockSynced: () => synced,
    serverNow: () => corrected,
    setNow: (value) => values.push(value),
    window: {
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: () => {},
    },
  };
  const cleanup = new Function(
    ...Object.keys(scope),
    `return (${stripTypeScriptTypes(effect.getText(ast))});`,
  )(...Object.values(scope))();
  assert.deepEqual(values, []);
  synced = true;
  timers.shift()();
  assert.deepEqual(values, [corrected]);
  assert.equal(formatBrasiliaClock(values[0], "12h"), "5:59:36 PM");
  cleanup();
});
