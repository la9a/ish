import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import ts from "typescript";

// Run the actual pure recovery function from the route, without rendering the
// wizard or triggering Telegram requests. TypeScript's AST selects its body.
const text = readFileSync(new URL("../src/routes/dashboard.cadastro.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "dashboard.cadastro.tsx",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const helper = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "recoverWizardClientId",
);
assert.ok(helper, "route recovery helper exists");
const recover = new Function(
  `${stripTypeScriptTypes(helper.getText(ast))}; return recoverWizardClientId;`,
)();
const draft = { clientId: "pending-client", apiId: "123456", apiHash: "abcdef0123456789" };
const matching = (id) =>
  id === "pending-client" ? { apiId: 123456, apiHash: "abcdef0123456789" } : null;

test("restores the pending client ID with matching credentials after refresh", () => {
  assert.equal(recover(draft, matching), "pending-client");
});
test("legacy drafts cannot resume an account using only shared app credentials", () => {
  assert.equal(recover({ ...draft, clientId: undefined }, matching), null);
});
test("missing, mismatched or unreadable credentials require a fresh connection", () => {
  assert.equal(
    recover(draft, () => null),
    null,
  );
  assert.equal(
    recover(draft, () => ({ apiId: 999, apiHash: draft.apiHash })),
    null,
  );
  assert.equal(
    recover(draft, () => ({ apiId: 123456, apiHash: "wrong" })),
    null,
  );
  assert.equal(
    recover(draft, () => {
      throw new Error("unavailable");
    }),
    null,
  );
  assert.equal(recover({ ...draft, apiHash: "" }, matching), null);
  assert.equal(recover({ ...draft, clientId: undefined }, matching), null);
});
test("hash case and surrounding whitespace do not invalidate a matching account", () => {
  assert.equal(
    recover({ ...draft, apiId: " 123456 ", apiHash: draft.apiHash.toUpperCase() }, matching),
    "pending-client",
  );
});

const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
const restoreEffect = effects.find((node) => node.getText(ast).includes("wizardDraft.get()"));
const persistEffect = effects.find((node) => node.getText(ast).includes("wizardDraft.set("));
const wizard = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "NewClientWizard",
);
const submitCode = wizard.body.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "submitCode",
);
function bindArrow(node, scope) {
  return new Function(
    ...Object.keys(scope),
    `return (${stripTypeScriptTypes(node.getText(ast))});`,
  )(...Object.values(scope));
}
function restoreFixture(saved, activeId, readCreds) {
  const values = {};
  const scope = {
    editingId: undefined,
    draftRestoredRef: { current: false },
    setDraftReady: (value) => {
      values.DraftReady = value;
    },
    wizardDraft: { get: () => saved },
    activeClient: {
      get: () => activeId,
      set: (id) => {
        values.activeId = id;
      },
    },
    clientData: { getCreds: readCreds },
    recoverWizardClientId: recover,
    resendCode: () => {
      throw new Error("Recovery fixture must not contact Telegram");
    },
  };
  for (const field of [
    "ClientId",
    "Step",
    "CredsInfo",
    "Title",
    "SchedRas",
    "SchedFim",
    "SchedEnv",
    "Weekdays",
    "ApiId",
    "ApiHash",
    "Ddi",
    "Phone",
    "PhoneCodeHash",
    "CodeSentAt",
  ])
    scope[`set${field}`] = (v) => {
      values[field] = v;
    };
  bindArrow(restoreEffect, scope)();
  return values;
}
test("the actual draft restoration effect sets client state and active scope before confirming", () => {
  const restored = restoreFixture(
    { ...draft, step: "code", phoneCodeHash: "hash", codeSentAt: 0 },
    null,
    matching,
  );
  assert.equal(restored.ClientId, "pending-client");
  assert.equal(restored.activeId, "pending-client");
  assert.equal(restored.Step, "code");
});
test("the actual restoration effect falls back visibly when its client cannot be recovered", () => {
  const restored = restoreFixture(
    { ...draft, step: "code", phoneCodeHash: "hash", codeSentAt: 0 },
    null,
    () => null,
  );
  assert.equal(restored.ClientId, undefined);
  assert.equal(restored.Step, "creds");
  assert.match(restored.CredsInfo, /solicite um novo código/);
});
test("the actual draft persistence effect includes the pending client ID", () => {
  let saved;
  const scope = {
    editingId: undefined,
    draftReady: true,
    leavingRef: { current: false },
    clientId: "pending-client",
    wizardDraft: {
      set: (value) => {
        saved = value;
      },
    },
  };
  for (const field of [
    "step",
    "title",
    "schedRas",
    "schedFim",
    "schedEnv",
    "weekdays",
    "apiId",
    "apiHash",
    "ddi",
    "phone",
    "phoneCodeHash",
    "credsInfo",
    "codeSentAt",
  ])
    scope[field] = field === "step" ? "code" : "";
  bindArrow(persistEffect, scope)();
  assert.equal(saved.clientId, "pending-client");
  assert.equal(saved.step, "code");
});
test("confirming without a client ID shows a recovery action instead of silently returning", async () => {
  let error, step;
  const scope = {
    pendingRef: { current: false },
    clientId: null,
    setError: (value) => {
      error = value;
    },
    setStep: (value) => {
      step = value;
    },
  };
  const actualSubmit = new Function(
    ...Object.keys(scope),
    `${stripTypeScriptTypes(submitCode.getText(ast))}; return submitCode;`,
  )(...Object.values(scope));
  await actualSubmit({ preventDefault() {} });
  assert.match(error, /novo código/);
  assert.equal(step, "creds");
});

test("StrictMode initial effect replay cannot overwrite the saved draft with empty values", () => {
  let saved = { ...draft, step: "creds", title: "Restored client", phone: "11988887777" };
  let reads = 0;
  const state = {};
  const restoreScope = {
    editingId: undefined,
    draftRestoredRef: { current: false },
    wizardDraft: {
      get: () => {
        reads++;
        return saved;
      },
    },
    activeClient: { set() {} },
    clientData: { getCreds: matching },
    recoverWizardClientId: recover,
  };
  for (const field of [
    "DraftReady",
    "ClientId",
    "Step",
    "CredsInfo",
    "Title",
    "SchedRas",
    "SchedFim",
    "SchedEnv",
    "Weekdays",
    "ApiId",
    "ApiHash",
    "Ddi",
    "Phone",
    "PhoneCodeHash",
    "CodeSentAt",
  ])
    restoreScope[`set${field}`] = (v) => {
      state[field] = v;
    };
  const persistScope = {
    editingId: undefined,
    draftReady: false,
    leavingRef: { current: false },
    clientId: null,
    wizardDraft: {
      set: (d) => {
        saved = d;
      },
    },
  };
  for (const field of [
    "step",
    "title",
    "schedRas",
    "schedFim",
    "schedEnv",
    "weekdays",
    "apiId",
    "apiHash",
    "ddi",
    "phone",
    "phoneCodeHash",
    "credsInfo",
    "codeSentAt",
  ])
    persistScope[field] = field === "step" ? "title" : "";
  const restore = bindArrow(restoreEffect, restoreScope);
  const initialPersist = bindArrow(persistEffect, persistScope);
  restore();
  initialPersist();
  restore();
  initialPersist();
  assert.equal(reads, 1);
  assert.equal(saved.step, "creds");
  assert.equal(saved.title, "Restored client");
  assert.equal(state.DraftReady, true);
  assert.equal(state.Step, "creds");
  assert.equal(state.Title, "Restored client");
});

test("a legacy draft cannot select an unrelated active account with identical API credentials", () => {
  const restored = restoreFixture(
    { ...draft, clientId: undefined, step: "code", phoneCodeHash: "hash", codeSentAt: 0 },
    "unrelated-active-client",
    () => ({ apiId: 123456, apiHash: draft.apiHash }),
  );
  assert.equal(restored.ClientId, undefined);
  assert.equal(restored.Step, "creds");
  assert.match(restored.CredsInfo, /novo código/);
});
