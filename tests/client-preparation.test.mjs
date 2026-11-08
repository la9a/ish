import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/clientPreparation.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports },
);
const { clientPreparation } = exports;

test("a draft and an active group cannot substitute for a saved session", () => {
  const result = clientPreparation({ hasSession: false }, [{ active: true, message: "Visita" }]);
  assert.equal(result.ready, false);
  assert.deepEqual(Array.from(result.issues), ["Reconectar conta"]);
});
test("saved sessions without enabled destinations require group preparation", () => {
  for (const groups of [[], [{ active: false, message: "Visita" }]]) {
    const result = clientPreparation({ hasSession: true }, groups);
    assert.equal(result.ready, false);
    assert.equal(result.activeGroups, 0);
  }
});
test("every enabled group must have a nonblank draft", () => {
  const result = clientPreparation({ hasSession: true }, [
    { active: true, message: "Visita" },
    { active: true, message: " \n " },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.emptyDrafts, 1);
  assert.equal(result.activeGroups, 2);
});
test("disabled groups do not create draft warnings or count as destinations", () => {
  const result = clientPreparation({ hasSession: true }, [
    { active: true, message: "Visita" },
    { active: false, message: "" },
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.emptyDrafts, 0);
  assert.equal(result.activeGroups, 1);
});
test("all independent preparation issues remain visible together", () => {
  const result = clientPreparation({ hasSession: false }, [{ active: true, message: "" }]);
  assert.equal(result.issues.length, 2);
  assert.equal(result.ready, false);
});
