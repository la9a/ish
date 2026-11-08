import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL("../src/lib/connectionOrder.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports });

test("All accounts lists saved sessions before reconnect accounts, alphabetical within each group", () => {
  const accounts = [
    { title: "Ana", hasSession: false },
    { title: "Zélia", hasSession: true },
    { title: "Brenda", hasSession: false },
    { title: "Adriana", hasSession: true },
  ];
  assert.deepEqual(accounts.sort(exports.compareConnectionAccounts).map(a => a.title),
    ["Adriana", "Zélia", "Ana", "Brenda"]);
});