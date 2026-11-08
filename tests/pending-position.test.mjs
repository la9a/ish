import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/pendingPosition.ts", import.meta.url), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText,
  { exports },
);
const { pendingPositionParts } = exports;

test("the pending Miami placeholder yields an inline spinner slot, keeping the surrounding log", () => {
  for (const placeholder of ["…", "..."]) {
    const result = pendingPositionParts(`Lola: enviado ao grupo (Senha: ${placeholder})`, true);
    assert.equal(result.before, "Lola: enviado ao grupo (Senha: ");
    assert.equal(result.after, ")");
  }
});

test("final positions and failed/unconfirmed results remain the server's text", () => {
  for (const value of ["1", "23", "não encontrada", "não confirmada"]) {
    assert.equal(pendingPositionParts(`Rascunho (Senha: ${value})`, false), null);
    assert.equal(pendingPositionParts(`Rascunho (Senha: ${value})`, true), null);
  }
  assert.equal(pendingPositionParts("Rascunho (Senha: …)", false), null);
});

test("unrelated pending logs are untouched, including ellipses in the message", () => {
  assert.equal(pendingPositionParts("Conectando ao grupo…", true), null);
  assert.equal(pendingPositionParts("Rascunho incompleto...", true), null);
  assert.equal(pendingPositionParts("Senha: ...texto", true), null);
});
