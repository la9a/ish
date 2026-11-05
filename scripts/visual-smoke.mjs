// Optional browser check. Run against Vite with the visual-only Supabase env in docs/VALIDATION.md.
// Every Telegram/agent operation and Supabase request is replaced in this browser context only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.SCREENSHOT_DIR || path.join(root, "docs/preview");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const uid = "00000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "demo@app.local",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, email: user.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.visual-test-only`;
const session = {
  access_token: token,
  refresh_token: "visual-test-only",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user,
};
const clients = [
  {
    id: "visual-lola",
    title: "Lola",
    has_session: true,
    pinned: true,
    schedule_env: "08:00",
    phone: "+5511999990001",
    created_at: new Date().toISOString(),
    user_id: uid,
  },
  {
    id: "visual-luiz",
    title: "Luiz",
    has_session: true,
    phone: "+5511999990002",
    created_at: new Date().toISOString(),
    user_id: uid,
  },
  {
    id: "visual-maria",
    title: "Maria",
    has_session: false,
    phone: "+5511999990003",
    created_at: new Date().toISOString(),
    user_id: uid,
  },
];
const groups = clients.slice(0, 2).map((c, i) => ({
  id: `visual-group-${i}`,
  client_id: c.id,
  user_id: uid,
  name: `Grupo de visitas ${i + 1}`,
  input: `visual-group-${i}`,
  message: `${c.title} x João Raio 5 Cela 2`,
  active: true,
  added_at: new Date().toISOString(),
}));
await context.addInitScript(
  ({ session, uid, clients, groups }) => {
    localStorage.setItem("sb-visual-test-auth-token", JSON.stringify(session));
    localStorage.setItem("app_user_v3", "demo");
    localStorage.setItem("app_user_id_v3", uid);
    localStorage.setItem(
      `tg_cloud_v1:${uid}:clients_index_v1`,
      JSON.stringify(
        clients.map((c) => ({
          ...c,
          hasSession: c.has_session,
          createdAt: Date.now(),
          scheduleEnv: c.schedule_env,
        })),
      ),
    );
    for (const c of clients) {
      localStorage.setItem(
        `tg_cloud_v1:${uid}:client:${c.id}:creds`,
        JSON.stringify({ apiId: 123456, apiHash: "visual-fixture-only" }),
      );
      localStorage.setItem(
        `tg_cloud_v1:${uid}:client:${c.id}:session`,
        JSON.stringify("visual-fixture-session-only"),
      );
      localStorage.setItem(
        `tg_cloud_v1:${uid}:client:${c.id}:groups`,
        JSON.stringify(
          groups.filter((g) => g.client_id === c.id).map((g) => ({ ...g, addedAt: Date.now() })),
        ),
      );
    }
  },
  { session, uid, clients, groups },
);
const logFixture = `[{id:'visual-1',ts:Date.now()-4000,level:'success',msg:'Lola: conta conectada'},{id:'visual-2',ts:Date.now()-2000,level:'info',msg:'Grupo de visitas 1: aguardando abertura'}]`;
const monitorStub = `let running=false; const listeners=new Set(); const logs=${logFixture}; const emit=()=>listeners.forEach(fn=>fn(logs,running,{},[])); export const monitor={subscribe(fn){listeners.add(fn);fn(logs,running,{},[]);return()=>listeners.delete(fn)},resetPrewarm(){},clearLogs(){},clearSends(){},async prewarm(){return true},start(){running=true;emit()},stop(){running=false;emit()},isRunning(){return running}};`;
const noopNames = [
  ...(await fs.readFile(path.join(root, "src/lib/telegram.ts"), "utf8")).matchAll(
    /^export (?:async )?function (\w+)/gm,
  ),
].map((m) => m[1]);
const telegramStub =
  monitorStub +
  noopNames
    .filter((name) => !["signIn", "listGroups"].includes(name))
    .map(
      (name) =>
        `export const ${name}=async()=>${name === "isAuthorized" ? "true" : name === "checkSessionHealth" ? "'alive'" : ["checkAllSessions", "pruneMissingGroups", "listGroups"].includes(name) ? "[]" : name === "loadGroupPhotoById" ? "null" : name === "sendCode" ? "({phoneCodeHash:'visual-code-hash'})" : "undefined"};`,
    )
    .join("\n") +
  `export const signIn=async(opts)=>{if(!opts.password)throw Object.assign(new Error('visual-2fa'),{code:'2FA_REQUIRED'});};export const listGroups=async(id)=>[{id:(id||'active')+'-destination',name:'Destino '+(id||'active'),archived:false}];`;
const multiStub = `let running=false;const listeners=new Set();const state=()=>({running,logs:${logFixture},statusByClient:{}});const emit=()=>listeners.forEach(f=>f(state()));export const multiMonitor={subscribe(f){listeners.add(f);f(state());return()=>listeners.delete(f)},resetPrewarm(){},clearLogs(){},clearSends(){},async prewarm(){return true},start(){running=true;emit()},stop(){running=false;emit()},allDone(){return false}};`;
const agents = [
  ...(await fs.readFile(path.join(root, "src/lib/miamiAgent.functions.ts"), "utf8")).matchAll(
    /^export const (\w+)/gm,
  ),
].map((m) => m[1]);
const agentStub = agents
  .map(
    (name) =>
      `export const ${name}=async()=>(${name === "miamiAccountInfo" ? "{ok:true,active:true,accountDc:1,groups:{}}" : name === "miamiActiveAccounts" ? "{ok:true,ids:['visual-lola','visual-luiz']}" : "{ok:true}"});`,
  )
  .join("\n");
const cryptoStub = `export const pullAllClientSecrets=async()=>({});export const pullClientSecrets=async()=>({});export const pushClientSecrets=async()=>({ok:true});`;
const myTelegramStub = `export const mtSendPassword=async()=>({randomHash:'visual-random-hash'});export const mtLogin=async()=>({ok:true,session:'visual-only'});export const mtEnsureApp=async()=>({apiId:'123456',apiHash:'visual-fixture-only'});export const mtDiagnose=async()=>({ok:true});`;
const blocked = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  const modules = {
    "/src/lib/telegram.ts": telegramStub,
    "/src/lib/multiMonitor.ts": multiStub,
    "/src/lib/miamiAgent.functions.ts": agentStub,
    "/src/lib/sessionCrypto.functions.ts": cryptoStub,
    "/src/lib/myTelegram.functions.ts": myTelegramStub,
  };
  if (modules[url.pathname])
    return route.fulfill({ contentType: "text/javascript", body: modules[url.pathname] });
  if (url.hostname === "visual-test.supabase.co") {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let data = url.pathname.endsWith("/user")
      ? user
      : url.pathname.includes("/clients")
        ? clients
        : url.pathname.includes("/monitored_groups")
          ? groups.filter(
              (g) =>
                !url.searchParams.get("client_id") ||
                url.searchParams.get("client_id") === `eq.${g.client_id}`,
            )
          : url.pathname.includes("/monitor_settings")
            ? null
            : [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(data),
    });
  }
  if (url.hostname === "127.0.0.1" && url.port === "3001") return route.continue();
  blocked.push(url.hostname);
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://127.0.0.1:3001";
async function capture(name) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="listbox"], [role="dialog"]')].every(
      (el) => getComputedStyle(el).opacity === "1",
    ),
  );
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: overflow`,
  );
}
try {
  await page.goto(`${base}/dashboard`);
  await page.getByRole("heading", { name: /Visão geral/ }).waitFor();
  await page.getByText("Lola", { exact: true }).waitFor();
  await capture("dashboard-desktop");
  await page.goto(`${base}/dashboard/unico`);
  await page.getByRole("heading", { name: "Minhas clientes", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("listbox").waitFor();
  await capture("filtro-clientes");
  await page.getByRole("option", { name: "A reconectar", exact: true }).click();
  await page.getByRole("button", { name: "Conectar Maria", exact: true }).waitFor();
  await page.getByText("Lola", { exact: true }).waitFor({ state: "hidden" });
  console.log("PASS custom client filter");
  await page.getByRole("combobox", { name: "Status", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("Home");
  await page.waitForFunction(() =>
    document.activeElement?.textContent?.includes("Todas as clientes"),
  );
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Abrir atendimento de Lola", exact: true }).waitFor();
  console.log("PASS keyboard select");
  await page.getByLabel("Buscar cliente pelo nome").fill("zzzzz");
  await page.getByRole("heading", { name: "Nenhuma cliente encontrada" }).waitFor();
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  console.log("PASS search and reset");
  await page.goto(`${base}/admin/connection`);
  await page.getByRole("heading", { name: "Conexões", exact: true }).waitFor();
  await capture("conexoes-desktop");
  await page.goto(`${base}/dashboard/cadastro`);
  await page
    .getByRole("heading", { name: /cliente/i })
    .first()
    .waitFor();
  await page.locator("input").first().waitFor();
  await capture("cadastro-desktop");
  await page.getByRole("combobox", { name: "País", exact: true }).click();
  await page.getByRole("option").first().waitFor();
  await capture("cadastro-paises");
  await page.keyboard.press("Escape");
  // Follow the actual first registration step using only fixture handlers.
  await page.getByLabel("Nome da cliente", { exact: true }).fill("Cliente de teste");
  await page.getByLabel("Telefone", { exact: true }).fill("11988887777");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Código de autorização").waitFor();
  await capture("cadastro-autorizacao");
  console.log("PASS registration phone confirmation to authorization");
  for (const step of ["creds", "code"]) {
    await page.evaluate(
      ({ uid, step }) =>
        localStorage.setItem(
          `tg_cloud_v1:${uid}:wizard_draft_v2`,
          JSON.stringify({
            step,
            clientId: "visual-lola",
            title: "Cliente de teste",
            schedRas: "",
            schedFim: "",
            schedEnv: "",
            weekdays: [],
            apiId: "123456",
            apiHash: "visual-fixture-only",
            ddi: "+55",
            phone: "11988887777",
            phoneCodeHash: "visual-hash",
            savedAt: Date.now(),
          }),
        ),
      { uid, step },
    );
    await page.goto(`${base}/dashboard/cadastro`);
    await page
      .getByRole("heading", {
        name: step === "creds" ? "Credenciais do Telegram" : "Confirme a conta",
        exact: true,
      })
      .waitFor();
    await capture(`cadastro-${step}`);
  }
  await page.getByLabel("Código de confirmação").fill("12345");
  await page.getByRole("button", { name: "Concluir cadastro", exact: true }).click();
  await page.locator("#telegram-password").waitFor();
  await capture("cadastro-2fa");
  await page.evaluate((uid) => localStorage.removeItem(`tg_cloud_v1:${uid}:wizard_draft_v2`), uid);
  console.log("PASS registration manual credentials, recovered confirmation and 2FA");
  await page.goto(`${base}/dashboard/unico/visual-lola`);
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  await page.getByText("Lola x João Raio 5 Cela 2", { exact: false }).waitFor();
  await page.getByRole("button", { name: /Iniciar/ }).waitFor();
  await capture("monitoramento-desktop");
  await page.getByRole("button", { name: /Iniciar/ }).click();
  await page.getByRole("button", { name: /Parar/ }).waitFor();
  await page.getByRole("button", { name: /Parar/ }).click();
  console.log("PASS monitoring controls against fixture transport");
  await page.getByRole("button", { name: "Editar grupos", exact: true }).click();
  await page
    .getByRole("button", { name: "Editar grupo e rascunho de Grupo de visitas 1", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await capture("editar-rascunho");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Abrir opções de envio" }).click();
  await page.getByRole("dialog").waitFor();
  await capture("opcoes-envio");
  await page.keyboard.press("Escape");
  await page.goto(`${base}/dashboard/multi`);
  await page.getByRole("checkbox", { name: "Selecionar Lola" }).check();
  await page.getByRole("checkbox", { name: "Selecionar Luiz" }).check();
  await capture("selecao-multipla");
  await page.getByRole("button", { name: /Continuar|Abrir monitoramento/i }).click();
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  await capture("monitoramento-multiplo");
  for (const [name, id] of [
    ["Lola", "visual-lola"],
    ["Luiz", "visual-luiz"],
  ]) {
    const panel = page
      .getByRole("heading", { name, exact: true })
      .locator("xpath=ancestor::section[1]");
    await panel.getByRole("button", { name: "Editar grupos", exact: true }).click();
    await panel.getByRole("button", { name: /Adicionar grupo/ }).click();
    await page
      .getByRole("dialog")
      .getByText("Destino " + id, { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByText("Destino " + (id === "visual-lola" ? "visual-luiz" : "visual-lola"), {
          exact: true,
        })
        .count(),
      0,
    );
    await capture("adicionar-grupo-" + id);
    await page.keyboard.press("Escape");
  }
  console.log("PASS group picker changes account without reusing another client list");
  for (const [route, name, heading] of [
    ["/dashboard/unico", "clientes-mobile", "Minhas clientes"],
    ["/admin/connection", "conexoes-mobile", "Conexões"],
    ["/dashboard/cadastro", "cadastro-mobile", null],
    ["/dashboard/unico/visual-lola", "monitoramento-mobile", "Monitoramento"],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + route);
    if (heading) await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    else await page.locator("input").first().waitFor();
    await capture(name);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await capture("monitoramento-360");
  // Use a separate, unauthenticated context to verify the actual route guard and login.
  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await loginContext.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  const loginPage = await loginContext.newPage();
  loginPage.setDefaultTimeout(20000);
  loginPage.on("pageerror", (error) => errors.push(error.message));
  await loginPage.goto(base + "/dashboard");
  await loginPage.getByRole("heading", { name: /Acesse.*sua conta/ }).waitFor();
  assert.match(loginPage.url(), /\/login$/);
  await loginPage.getByLabel("Sua chave de acesso").fill("visual-only");
  await loginPage.getByRole("button", { name: "Mostrar chave" }).click();
  await loginPage.waitForFunction(() => document.querySelector("#access-key")?.type === "text");
  await loginPage.getByRole("button", { name: "Ocultar chave" }).click();
  await loginPage.getByLabel("Sua chave de acesso").fill("");
  await loginPage.evaluate(() => {
    const badge = document.createElement("div");
    badge.id = "lovable-badge";
    badge.textContent = "visual test";
    document.body.appendChild(badge);
  });
  assert.equal(
    await loginPage.locator("#lovable-badge").evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  await loginPage.screenshot({ path: path.join(output, "login-desktop.png"), fullPage: true });
  await loginPage.setViewportSize({ width: 390, height: 844 });
  await loginPage.screenshot({ path: path.join(output, "login-mobile.png"), fullPage: true });
  assert.equal(
    await loginPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await loginContext.close();
  console.log("PASS route guard, login toggle and badge CSS");
  assert.deepEqual(errors, []);
  console.log("PASS all screens, 1440/390/360px; no unhandled JS errors");
  console.log("External destinations intercepted/blocked:", [...new Set(blocked)].join(", "));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  console.log("FAIL AT", page.url(), await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
