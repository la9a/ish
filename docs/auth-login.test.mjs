import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Execute the real server handler without a network connection or real secrets.
// Only module wiring is replaced; validation and authentication logic are intact.
const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/accessKey.functions.ts", import.meta.url), "utf8"),
)
  .replace(/^import .*;\n/gm, "")
  .replaceAll("export const ", "const ")
  .replaceAll("await import(", "await loadModule(");

function fixture(options = {}) {
  const calls = { rates: [], locks: [], generatedEmails: [], verified: 0, urls: [] };
  const builder = () => ({
    inputValidator(validate) {
      this.validate = validate;
      return this;
    },
    handler(fn) {
      const validate = this.validate;
      return (input = {}) => fn({ data: validate ? validate(input.data) : undefined });
    },
  });
  const db = {
    from(name) {
      assert.equal(name, "auth_ip_locks");
      return {
        select: () => ({
          in: async () => ({
            data: options.lockedUntil ? [{ locked_until: options.lockedUntil }] : [],
          }),
        }),
        upsert: async (rows) => {
          calls.locks.push(...rows);
          return { error: null };
        },
      };
    },
    auth: {
      admin: {
        generateLink: async ({ email }) => {
          calls.generatedEmails.push(email);
          return options.generateError
            ? { error: { message: "test failure" } }
            : { data: { properties: { hashed_token: "fake-hash" } } };
        },
      },
      verifyOtp: async ({ type, token_hash }) => {
        assert.equal(type, "magiclink");
        assert.equal(token_hash, "fake-hash");
        calls.verified++;
        return options.verifyError
          ? { error: { message: "test failure" } }
          : { data: { session: { access_token: "fake-access", refresh_token: "fake-refresh" } } };
      },
    },
  };
  const loadModule = async (name) => {
    if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: db };
    assert.equal(name, "@/lib/rateLimit.server");
    return {
      consumeRateLimit: async (key, limit, seconds) => {
        calls.rates.push({ key, limit, seconds });
        return { allowed: options.deniedRate !== key, retryAfterSeconds: 42 };
      },
    };
  };
  const fetch = async (url) => {
    calls.urls.push(url);
    assert.match(url, /^https:\/\/proxycheck\.io\/v2\//);
    return {
      ok: !options.proxyUnavailable,
      json: async () => ({ "8.8.8.8": { proxy: options.vpn ? "yes" : "no" } }),
    };
  };
  const getRequest = () => ({
    headers: new Headers(options.noIp ? {} : { "cf-connecting-ip": "8.8.8.8" }),
  });
  const env = options.noKeys
    ? {}
    : { ACCESS_KEY_RONEI: "fixture-ronei-key", ACCESS_KEY_PEDRO: "fixture-pedro-key" };
  const handlers = new Function(
    "createServerFn",
    "getRequest",
    "loadModule",
    "process",
    "fetch",
    `${source}\nreturn { loginWithAccessKey, getAccessLock };`,
  )(builder, getRequest, loadModule, { env }, fetch);
  return { ...handlers, calls };
}

test("valid key logs into its account without CAPTCHA configuration or token", async () => {
  for (const [key, email] of [
    ["fixture-ronei-key", "ronei@app.local"],
    ["fixture-pedro-key", "pedro@app.local"],
  ]) {
    const f = fixture();
    assert.deepEqual(await f.loginWithAccessKey({ data: { key } }), {
      ok: true,
      accessToken: "fake-access",
      refreshToken: "fake-refresh",
    });
    assert.deepEqual(f.calls.generatedEmails, [email]);
    assert.equal(f.calls.verified, 1);
    assert.equal(f.calls.locks.length, 0);
  }
});

test("invalid key is rejected and retains the IP lock", async () => {
  const f = fixture();
  const result = await f.loginWithAccessKey({ data: { key: "incorrect-key" } });
  assert.equal(result.ok, false);
  assert.equal(result.remainingMs, 30 * 60 * 1000);
  assert.equal(f.calls.locks[0].ip, "ip:8.8.8.8");
  assert.deepEqual(f.calls.generatedEmails, []);
});

test("absent server keys never grant a session", async () => {
  const f = fixture({ noKeys: true });
  assert.equal((await f.loginWithAccessKey({ data: { key: "fixture-ronei-key" } })).ok, false);
  assert.deepEqual(f.calls.generatedEmails, []);
});

test("global and per-IP rate limits reject valid keys before issuing a session", async () => {
  for (const deniedRate of ["login:global", "login:ip:8.8.8.8"]) {
    const f = fixture({ deniedRate });
    const result = await f.loginWithAccessKey({ data: { key: "fixture-ronei-key" } });
    assert.equal(result.ok, false);
    assert.equal(result.remainingMs, 42000);
    assert.deepEqual(f.calls.generatedEmails, []);
  }
});

test("an existing IP lock still blocks a valid key", async () => {
  const f = fixture({ lockedUntil: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await f.loginWithAccessKey({ data: { key: "fixture-ronei-key" } })).ok, false);
  assert.deepEqual(f.calls.generatedEmails, []);
});

test("VPN and unknown proxy verdict protections remain active", async () => {
  const vpn = fixture({ vpn: true });
  const denied = await vpn.loginWithAccessKey({ data: { key: "fixture-ronei-key" } });
  assert.equal(denied.ok, false);
  assert.equal(denied.vpn, true);
  assert.deepEqual(vpn.calls.generatedEmails, []);
  const unknown = fixture({ proxyUnavailable: true, deniedRate: "login-novpncheck:ip:8.8.8.8" });
  assert.equal(
    (await unknown.loginWithAccessKey({ data: { key: "fixture-ronei-key" } })).ok,
    false,
  );
  assert.deepEqual(unknown.calls.generatedEmails, []);
  assert.ok(
    unknown.calls.rates.some(
      (r) => r.key === "login-novpncheck:ip:8.8.8.8" && r.limit === 3 && r.seconds === 900,
    ),
  );
});

test("requests without a public IP keep their stricter shared limit", async () => {
  const f = fixture({ noIp: true, deniedRate: "login:no-ip" });
  assert.equal((await f.loginWithAccessKey({ data: { key: "fixture-ronei-key" } })).ok, false);
  assert.ok(f.calls.rates.some((r) => r.key === "login:no-ip" && r.limit === 3));
  assert.deepEqual(f.calls.generatedEmails, []);
});

test("Supabase link generation or session verification failures reject login", async () => {
  for (const option of ["generateError", "verifyError"]) {
    const f = fixture({ [option]: true });
    const result = await f.loginWithAccessKey({ data: { key: "fixture-ronei-key" } });
    assert.equal(result.ok, false);
    assert.equal("accessToken" in result, false);
    assert.equal(f.calls.locks.length, 1);
  }
});

test("logout invalidates the local account immediately and resets active client memory", async () => {
  const authSource = stripTypeScriptTypes(
    readFileSync(new URL("../src/lib/appAuth.ts", import.meta.url), "utf8"),
  )
    .replace(/^import .*;\n/gm, "")
    .replaceAll("export const ", "const ")
    .replaceAll("await import(", "await loadModule(");
  const localValues = new Map([
    ["app_user_v3", "ronei"],
    ["app_user_id_v3", "account-a"],
  ]);
  const sessionValues = new Map([["active_client_v1", "client-a"]]);
  let selectedClient = "client-a";
  let completeSignOut;
  const remoteSignOut = new Promise((resolve) => {
    completeSignOut = resolve;
  });
  const localWindow = {
    localStorage: {
      getItem: (k) => localValues.get(k) ?? null,
      setItem: (k, v) => localValues.set(k, v),
      removeItem: (k) => localValues.delete(k),
    },
    sessionStorage: { removeItem: (k) => sessionValues.delete(k) },
  };
  const loadModule = async (name) => {
    assert.equal(name, "@/lib/storage");
    return {
      activeClient: {
        set: (id) => {
          selectedClient = id;
        },
      },
    };
  };
  const appAuth = new Function(
    "supabase",
    "loginWithAccessKey",
    "loadModule",
    "window",
    `${authSource}\nreturn appAuth;`,
  )(
    { auth: { signOut: () => remoteSignOut } },
    () => {
      throw new Error("Not used");
    },
    loadModule,
    localWindow,
  );
  const notifications = [];
  appAuth.subscribe((user) => notifications.push(user));
  const pending = appAuth.logout();
  assert.equal(appAuth.current(), null);
  assert.equal(appAuth.currentUserId(), null);
  assert.equal(sessionValues.has("active_client_v1"), false);
  assert.deepEqual(notifications, [null]);
  await Promise.resolve();
  assert.equal(selectedClient, null);
  completeSignOut();
  await pending;
});
