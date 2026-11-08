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
    schedule_env: "17:59:36",
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
        JSON.stringify({
          apiId: c.id === "visual-luiz" ? 654321 : 123456,
          apiHash: c.id === "visual-luiz" ? "visual-fixture-luiz-only" : "visual-fixture-only",
        }),
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
const logFixture = `[{id:'visual-1',ts:Date.now()-4000,level:'success',msg:'Lola: conta conectada'},{id:'visual-2',ts:Date.now()-2000,level:'info',msg:'Grupo de visitas 1: aguardando abertura'},{id:'visual-pending',ts:Date.now()-1500,level:'success',msg:'Rascunho enviado (Senha: …)',pending:true},{id:'visual-confirmed',ts:Date.now()-1000,level:'success',msg:'Rascunho enviado (Senha: 3)',pending:false},{id:'visual-unknown',ts:Date.now()-500,level:'warn',msg:'Rascunho enviado (Senha: não encontrada)',pending:false}]`;
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
const myTelegramStub = `export const mtSendPassword=async()=>{window.__visualCodeRequests=(window.__visualCodeRequests||0)+1;if(window.__visualCodeDeferred)return new Promise(resolve=>{window.__visualReleaseCode=()=>resolve(window.__visualCodeFail?{error:'fixture-failure'}:{randomHash:'visual-random-hash'})});return {randomHash:'visual-random-hash'}};export const mtLogin=async()=>({ok:true,session:'visual-only'});export const mtEnsureApp=async()=>({apiId:'123456',apiHash:'visual-fixture-only'});export const mtDiagnose=async()=>({ok:true});`;

const blocked = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  const modules = {
    "/src/lib/telegram.ts": telegramStub,
    "/src/lib/multiMonitor.ts": multiStub,
    "/src/lib/miamiAgent.functions.ts": agentStub,
    "/src/lib/sessionCrypto.functions.ts": cryptoStub,
    "/src/lib/myTelegram.functions.ts": myTelegramStub,
    "/src/lib/serverTime.functions.ts": `export const getServerNow=async()=>({now:Date.UTC(2026,10,5,20,59,0)});`,
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
  if (
    await page
      .getByLabel("Horário de Brasília sincronizado com o servidor", { exact: true })
      .count()
  ) {
    await page.waitForFunction(() => {
      const clock = document.querySelector(
        '[aria-label="Horário de Brasília sincronizado com o servidor"]',
      );
      return clock && !clock.textContent.includes("--");
    });
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sb-art-scene img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="listbox"], [role="dialog"]')].every(
      (el) => getComputedStyle(el).opacity === "1",
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sb-page-enter-item")].every(
      (el) => getComputedStyle(el).opacity === "1",
    ),
  );
  await assertBannerSeparation(name);
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: overflow`,
  );
}
async function assertBannerSeparation(name) {
  const failures = await page.evaluate(() => {
    const issues = [];
    for (const frame of document.querySelectorAll(
      ".sb-page-banner, .sb-hero, .sb-illustrated-header, .sb-flow-header, .sb-cat-callout, .sb-auth-art",
    )) {
      const copies = frame.querySelectorAll(
        ".sb-banner-copy, .sb-banner-support, .sb-hero-copy, .sb-hero-support, .sb-illustrated-copy, .sb-flow-copy, .sb-callout-copy, .sb-art-label",
      );
      const art = frame.querySelector(".sb-art-subject");
      if (!art || !frame.getBoundingClientRect().height) continue;
      for (const copy of copies) {
        const a = copy.getBoundingClientRect(),
          b = art.getBoundingClientRect(),
          f = frame.getBoundingClientRect();
        if (!a.height || !b.height) continue;
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
        )
          issues.push(`Text overlaps cat: ${copy.textContent.slice(0, 60)}`);
        if (
          a.left < f.left - 1 ||
          a.right > f.right + 1 ||
          a.top < f.top - 1 ||
          a.bottom > f.bottom + 1
        )
          issues.push(`Text clipped: ${copy.textContent.slice(0, 60)}`);
      }
    }
    return issues;
  });
  assert.deepEqual(failures, [], `${name}: readable banners`);
}

async function checkCompactControls() {
  const rowHeights = [];
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(size);
    for (const [route, heading] of [
      ["/dashboard/clientes", "Minhas clientes"],
      ["/dashboard/multi", "Atendimento multi"],
      ["/dashboard/cadastro?id=visual-lola", "Reconectar Telegram"],
    ]) {
      await page.goto(base + route);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      await imageReady();
      const layout = await page.locator(".sb-page-banner").evaluate((banner) => {
        const copy = banner.querySelector(".sb-banner-copy").getBoundingClientRect();
        const cat = banner.querySelector(".sb-art-subject").getBoundingClientRect();
        return {
          height: banner.getBoundingClientRect().height,
          sideBySide: cat.left >= copy.right - 1 && cat.top < copy.bottom,
        };
      });
      assert.equal(layout.sideBySide, true, `${heading}: horizontal art in either orientation`);
      if (size.width < 640)
        assert.ok(layout.height < 400, `${heading}: compact portrait banner (${layout.height}px)`);
      // Reproduce a light host reset: controls must explicitly retain the dark theme.
      await page.addStyleTag({ content: "button { background: #fff; color: #111; }" });
      const paleControls = await page.evaluate(() => {
        const issues = [];
        for (const button of document.querySelectorAll(
          ".sb-directory-toggle, .sb-pin-toggle, .sb-select-trigger, .sb-text-action",
        )) {
          if (!button.getBoundingClientRect().height) continue;
          let node = button;
          while (node) {
            const color = getComputedStyle(node).backgroundColor;
            const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
            if (values.length >= 3 && (values.length < 4 || values[3] > 0)) {
              if (values.slice(0, 3).some((value) => value > 100))
                issues.push(button.textContent.trim() || button.getAttribute("aria-label"));
              break;
            }
            node = node.parentElement;
          }
        }
        return issues;
      });
      assert.deepEqual(
        paleControls,
        [],
        "Dark toggles, pins, filters and text links survive a light host reset",
      );
      if (heading === "Minhas clientes") {
        rowHeights.push((await page.locator(".sb-directory-row").first().boundingBox()).height);
        await page.getByRole("combobox", { name: "Status", exact: true }).click();
        const menu = page.getByRole("listbox");
        await menu.waitFor();
        const menuColor = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.equal(menuColor, "rgb(28, 28, 30)");
        await photo(`dropdown-escuro-${size.width}`);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Ver detalhes de Lola", exact: true }).click();
        await page.getByRole("region", { name: "Detalhes de Lola", exact: true }).waitFor();
      }
      if (heading === "Reconectar Telegram")
        assert.match(
          await page.locator(".sb-banner-art [data-cat-subject]").getAttribute("src"),
          /cat-reconnect-servers\.png$/,
        );
      await photo(`compacto-${heading.replaceAll(" ", "-")}-${size.width}`);
    }
  }
  assert.ok(
    Math.max(...rowHeights) - Math.min(...rowHeights) < 3,
    "Client rows keep the same compact height in portrait and landscape",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS compact horizontal banners in portrait/landscape, matching client row heights, dark controls and menus even with a light host reset, server-to-server artwork",
  );
}

async function checkBannerFeatures() {
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, heading] of [
      ["/dashboard", /Olá, demo/],
      ["/dashboard/clientes", "Minhas clientes"],
      ["/dashboard/unico", "Atendimento único"],
      ["/dashboard/multi", "Atendimento multi"],
      ["/admin/connection", "Conexões"],
      ["/dashboard/cadastro", "Nova cliente"],
      ["/dashboard/cadastro?id=visual-lola", "Reconectar Telegram"],
      ["/dashboard/unico/visual-lola", "Monitoramento"],
    ]) {
      await page.goto(base + route);
      await page
        .getByRole("heading", { name: heading, exact: typeof heading === "string" })
        .first()
        .waitFor();
      await photo(
        `banner-${route.split("?")[0].replaceAll("/", "-")}-${heading === "Reconectar Telegram" ? "reconnect-" : ""}${width}`,
      );
    }
  }
  await page.goto(base + "/dashboard/clientes");
  await page.getByRole("button", { name: "Revisar pendências", exact: true }).click();
  await page.getByRole("button", { name: "Ver detalhes de Maria", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Ver detalhes de Lola", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Mostrar todas", exact: true }).click();
  await page.getByRole("button", { name: "Ver detalhes de Lola", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Preparação", exact: true }).click();
  await page.getByRole("option", { name: "Preparadas", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Ver detalhes de Maria", exact: true }).count(),
    0,
  );
  await page.locator(".sb-preparation-guide summary").click();
  await page.getByRole("link", { name: "Ver conexões", exact: true }).waitFor();
  await page.goto(base + "/dashboard/multi");
  await page.getByRole("button", { name: "Selecionar preparadas", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "Selecionar Lola", exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "Selecionar Luiz", exact: true }).isChecked(),
    true,
  );
  assert.equal(await page.getByRole("heading", { name: "Monitoramento", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Limpar seleção", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "Selecionar Lola", exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole("button", { name: "Abrir monitoramento", exact: true }).isDisabled(),
    true,
  );
  await page.goto(base + "/admin/connection");
  await page.getByRole("button", { name: "Ver contas sem sessão", exact: true }).click();
  const accounts = page.getByRole("region", { name: "Contas e conexões", exact: true });
  await accounts.getByText("Maria", { exact: true }).waitFor();
  assert.equal(await accounts.getByText("Lola", { exact: true }).count(), 0);
  console.log(
    "PASS banners readable at 360/390/768/1024/1440px; preparation filters, guide, bulk selection and connection shortcut",
  );
}
async function imageReady() {
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sb-art-scene img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
}
async function photo(name) {
  await imageReady();
  await capture(name);
}
async function checkRefinements() {
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(base + "/dashboard");
    await page.getByRole("heading", { name: /Olá, demo/ }).waitFor();
    const hero = page.locator(".sb-hero");
    assert.equal(await hero.evaluate((el) => getComputedStyle(el, "::before").content), "none");
    const links = await hero.getByRole("link").all();
    assert.equal(links.length, 2);
    const [manage, add] = await Promise.all(links.map((el) => el.boundingBox()));
    assert.ok(
      Math.abs(manage.width - add.width) < 1 &&
        Math.abs(manage.height - add.height) < 1 &&
        add.y > manage.y,
    );
    assert.equal(await page.locator("footer").count(), 0);
    await photo("home-" + size.width);
  }
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Minhas clientes" })
    .waitFor();
  for (const label of ["Atendimento único", "Atendimento multi"]) {
    await page
      .getByRole("navigation", { name: "Navegação principal" })
      .getByRole("link", { name: label, exact: true })
      .waitFor();
  }
  await page.getByText("Workspace", { exact: true }).waitFor();
  assert.equal(await page.getByText("Senha Baixa", { exact: true }).count(), 1);
  await page.goto(base + "/dashboard/unico/visual-lola");
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  const clock = page.getByLabel("Horário de Brasília sincronizado com o servidor");
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Horário de Brasília sincronizado com o servidor"]')
      ?.textContent.includes("17:59:"),
  );
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Grupo aberto 2", exact: true }).click();
  const schedule = page.getByRole("region", { name: "Horário de envio", exact: true });
  await schedule.getByText("17:59:36", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Abrir opções de envio" }).click();
  const options = page.getByRole("dialog");
  await options.getByRole("heading", { name: "Formato de horário", exact: true }).waitFor();
  const headers = await options.getByRole("heading").allTextContents();
  assert.ok(headers.indexOf("Formato de horário") > headers.indexOf("Avisos sonoros"));
  await options.getByRole("combobox", { name: "Exibição do relógio", exact: true }).click();
  await page.getByRole("option", { name: /12 horas/ }).click();
  await photo("horario-opcoes-12h");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Horário de Brasília sincronizado com o servidor"]')
      ?.textContent.includes("PM"),
  );
  await schedule.getByText("5:59:36 PM", { exact: true }).waitFor();
  await schedule.getByRole("button", { name: "Editar", exact: true }).click();
  await schedule.getByLabel("Hora, minuto e segundo", { exact: true }).fill("5:59:36");
  await schedule.getByRole("button", { name: "Confirmar", exact: true }).click();
  assert.equal(
    await page.evaluate(
      (uid) =>
        JSON.parse(localStorage.getItem(`tg_cloud_v1:${uid}:clients_index_v1`)).find(
          (c) => c.id === "visual-lola",
        ).scheduleEnv,
      uid,
    ),
    "17:59:36",
  );
  await photo("monitoramento-desktop-12h");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /Eventos/ }).click();
  await page.getByRole("region", { name: "Histórico de eventos do atendimento" }).waitFor();
  await photo("monitoramento-mobile-eventos");
  await page.getByRole("tab", { name: /Clientes e rascunhos/ }).click();
  await schedule.getByText("5:59:36 PM", { exact: true }).waitFor();
  await photo("monitoramento-mobile-clientes");
  assert.ok(await page.locator('[data-avatar="client"]').count());
  assert.ok(await page.locator('[data-avatar="group"]').count());
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await photo("monitoramento-paisagem");
  await page.reload();
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Horário de Brasília sincronizado com o servidor"]')
      ?.textContent.includes("PM"),
  );
  console.log(
    "PASS home/sidebar, no white wash, layouts, 12h display persistence and canonical24h target",
  );
  await page.goto(base + "/dashboard/cadastro?id=visual-lola&edit=1");
  await page.getByRole("heading", { name: "Cadastro da cliente", exact: true }).waitFor();
  assert.equal(await page.getByText("Conta do Telegram", { exact: true }).count(), 0);
  assert.equal(await page.locator(".sb-wizard-aside").count(), 0);
  await photo("editar-cliente");
  assert.ok(
    (await page.locator(".sb-banner-art [data-cat-subject]").getAttribute("src")).includes(
      "cat-edit-client",
    ),
  );
  await page.goto(base + "/dashboard");
  await page.evaluate((uid) => localStorage.removeItem(`tg_cloud_v1:${uid}:wizard_draft_v2`), uid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/dashboard/cadastro");
  await page.getByLabel("Nome da cliente", { exact: true }).fill("Cliente teste");
  await page.getByLabel("Telefone", { exact: true }).fill("11988887777");
  await photo("nova-cliente");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enviar código", exact: true })
    .waitFor();
  const art = page.getByRole("dialog").locator(".sb-flow-art [data-cat-subject]");
  const confirmArt = await art.getAttribute("src");
  await photo("codigo-confirmacao");
  await page.evaluate(() => {
    window.__visualCodeDeferred = true;
    window.__visualCodeFail = true;
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enviar código", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("status").waitFor();
  await page.waitForFunction(() => typeof window.__visualReleaseCode === "function");
  const sendingArt = await art.getAttribute("src");
  assert.notEqual(sendingArt, confirmArt);
  assert.match(sendingArt, /sending/);
  await photo("codigo-enviando");
  await page.evaluate(() => window.__visualReleaseCode());
  await page.getByRole("dialog").getByRole("button", { name: "Voltar", exact: true }).waitFor();
  const failureArt = await art.getAttribute("src");
  assert.match(failureArt, /failure/);
  assert.notEqual(failureArt, sendingArt);
  await photo("codigo-falha");
  await page.getByRole("dialog").getByRole("button", { name: "Voltar", exact: true }).click();
  console.log("PASS edit withoutduplicates, unique confirmation/sending/failure artwork");
  await page.goto(base + "/dashboard/multi");
  await page.getByRole("checkbox", { name: "Selecionar Lola" }).check();
  await page.getByRole("checkbox", { name: "Selecionar Luiz" }).check();
  await photo("selecao-multipla");
  await page.getByRole("button", { name: /Abrir monitoramento/ }).click();
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  await page.getByRole("tab", { name: /Eventos/ }).click();
  await photo("multiplo-eventos");
  await page.getByRole("tab", { name: /Clientes e rascunhos/ }).click();
  await photo("multiplo-clientes");
  assert.deepEqual(errors, []);
  console.log(
    "PASS phone monitoring tabs retain panels, single/multi artworks and no unhandled JS errors",
  );
}

async function checkWorkspaceSplit() {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/dashboard`);
  await page.getByRole("heading", { name: /Olá, demo/ }).waitFor();
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  for (const [name, pathname] of [
    ["Minhas clientes", "/dashboard/clientes"],
    ["Atendimento único", "/dashboard/unico"],
    ["Atendimento multi", "/dashboard/multi"],
  ]) {
    assert.equal(
      await navigation.getByRole("link", { name, exact: true }).getAttribute("href"),
      pathname,
    );
  }
  assert.equal(
    await page.getByRole("link", { name: "Gerenciar clientes", exact: true }).getAttribute("href"),
    "/dashboard/clientes",
  );
  await navigation.getByRole("link", { name: "Minhas clientes", exact: true }).click();
  await page.getByRole("heading", { name: "Minhas clientes", exact: true }).waitFor();
  const catalogUrl = page.url();
  const beforeActive = await page.evaluate(() => sessionStorage.getItem("active_client_v1"));
  const clientButton = page.getByRole("button", { name: "Ver detalhes de Lola", exact: true });
  assert.equal(await clientButton.getAttribute("aria-expanded"), "false");
  await clientButton.click();
  const details = page.getByRole("region", { name: "Detalhes de Lola", exact: true });
  await details.getByText("Lola x João Raio 5 Cela 2", { exact: true }).waitFor();
  await details.getByText("17:59:36", { exact: true }).waitFor();
  assert.equal(page.url(), catalogUrl, "Inventory expansion does not navigate to monitoring");
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("active_client_v1")),
    beforeActive,
    "Inventory does not activate an account",
  );
  assert.equal(await page.getByRole("heading", { name: "Monitoramento", exact: true }).count(), 0);
  await photo("minhas-clientes-detalhes-desktop");
  await page.getByRole("button", { name: "Recolher Lola", exact: true }).click();
  await details.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Ver detalhes de Luiz", exact: true }).click();
  const luizDetails = page.getByRole("region", { name: "Detalhes de Luiz", exact: true });
  await luizDetails.getByText("Luiz x João Raio 5 Cela 2", { exact: true }).waitFor();
  assert.equal(
    await luizDetails.getByText("Lola x João Raio 5 Cela 2", { exact: true }).count(),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await photo("minhas-clientes-detalhes-mobile");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/dashboard/unico`);
  await page.getByRole("heading", { name: "Atendimento único", exact: true }).waitFor();
  const singleArt = await page.locator(".sb-banner-art [data-cat-subject]").getAttribute("src");
  assert.match(singleArt, /cat-single-select/);
  await photo("atendimento-unico-selecao-desktop");
  await page.getByRole("button", { name: "Abrir atendimento de Lola", exact: true }).click();
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  assert.match(page.url(), /\/dashboard\/unico\/visual-lola$/);
  const events = page.getByRole("region", {
    name: "Histórico de eventos do atendimento",
    exact: true,
  });
  await events.getByRole("status", { name: "Apurando senha", exact: true }).waitFor();
  assert.doesNotMatch(
    await events.innerText(),
    /Senha:\s*(?:\.{3}|…)/,
    "Pending ticket uses an inline loader instead of ellipsis",
  );
  await events.getByText(/Senha: 3/).waitFor();
  await events.getByText(/Senha: não encontrada/).waitFor();
  await photo("senha-carregando-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.__visualEntranceNode = document.querySelector(".sb-page-entrance");
  });
  await page.getByRole("tab", { name: /Eventos/ }).click();
  await events.getByRole("status", { name: "Apurando senha", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.__visualEntranceNode === document.querySelector(".sb-page-entrance"),
    ),
    true,
    "Monitoring tabs retain their mounted page",
  );
  await photo("senha-carregando-mobile");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/dashboard/multi`);
  await page.getByRole("checkbox", { name: "Selecionar Lola" }).waitFor();
  assert.match(
    await page.locator(".sb-banner-art [data-cat-subject]").getAttribute("src"),
    /cat-multi-select/,
  );
  await photo("atendimento-multi-selecao-desktop");
  await page.getByRole("checkbox", { name: "Selecionar Lola" }).check();
  await page.getByRole("checkbox", { name: "Selecionar Luiz" }).check();
  await page.getByRole("button", { name: /Abrir monitoramento/ }).click();
  await page.getByRole("heading", { name: "Monitoramento", exact: true }).waitFor();
  assert.equal(await page.locator(".sb-banner-art").getAttribute("data-artwork"), "multi");
  await photo("atendimento-multi-monitoramento-desktop");
  await page.goto(`${base}/admin/connection`);
  await page.getByRole("heading", { name: "Conexões", exact: true }).waitFor();
  const activeBeforeCredentials = await page.evaluate(() =>
    sessionStorage.getItem("active_client_v1"),
  );
  // The exported v2 exposes credentials in the client editor, not inline cards.
  // Exercise the real editor and keep the per-account isolation checks.
  for (const [name, apiId, hash] of [
    ["Lola", "123456", "visual-fixture-only"],
    ["Luiz", "654321", "visual-fixture-luiz-only"],
  ]) {
    await page.getByRole("button", { name: `Editar ${name}`, exact: true }).click();
    const editor = page.getByRole("dialog");
    await editor.getByRole("heading", { name: "Editar cliente", exact: true }).waitFor();
    assert.equal(await editor.getByLabel("Nome", { exact: true }).inputValue(), name);
    assert.equal(await editor.getByLabel("API ID", { exact: true }).inputValue(), apiId);
    assert.equal(await editor.getByLabel("API Hash", { exact: true }).inputValue(), hash);
    assert.equal(await editor.getByLabel("API ID", { exact: true }).isEditable(), false);
    assert.equal(await editor.getByLabel("API Hash", { exact: true }).isEditable(), false);
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("active_client_v1")),
      activeBeforeCredentials,
      "Editing details does not switch the active account",
    );
    await photo(`editar-${name.toLowerCase()}-desktop`);
    await editor.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/dashboard/cadastro?id=visual-lola&edit=1`);
  await page.getByRole("heading", { name: "Cadastro da cliente", exact: true }).waitFor();
  assert.equal(await page.getByLabel("API ID", { exact: true }).inputValue(), "123456");
  assert.equal(
    await page.getByLabel("API Hash", { exact: true }).inputValue(),
    "visual-fixture-only",
  );
  assert.equal(await page.getByText("Conta do Telegram", { exact: true }).count(), 0);
  await photo("editar-cliente-credenciais-mobile");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__visualPageAnimations = 0;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains("sb-page-entrance")) window.__visualPageAnimations += 1;
      return original.apply(this, args);
    };
  });
  await page.goto(`${base}/dashboard/clientes`);
  await page.getByRole("heading", { name: "Minhas clientes", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__visualPageAnimations),
    0,
    "Reduced motion disables page entrance effects",
  );
  await page.getByRole("button", { name: "Ver detalhes de Lola", exact: true }).click();
  await page.getByRole("region", { name: "Detalhes de Lola", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__visualPageAnimations), 0);
  await photo("minhas-clientes-movimento-reduzido");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await checkRegistrationDialogs();
  assert.deepEqual(errors, []);
  console.log(
    "PASS three distinct workspaces, inventory expansion without monitoring, account-scoped editor credentials and locked session fields, inline pending ticket loader and reduced motion",
  );
}

async function checkRegistrationDialogs() {
  await page.goto(`${base}/admin/connection`);
  await page.getByRole("heading", { name: "Conexões", exact: true }).waitFor();
  await capture("conexoes-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("conexoes-mobile");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${base}/dashboard/cadastro`);
  await page.getByLabel("Nome da cliente", { exact: true }).fill("Cliente de teste");
  await page.getByLabel("Telefone", { exact: true }).fill("11988887777");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.locator('[data-flow-state="confirm"]').waitFor();
  await capture("cadastro-confirmacao-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("cadastro-confirmacao-mobile");
  assert.match(await dialog.innerText(), /55/, "Confirmation includes country code");
  await dialog.getByRole("button", { name: "Editar número", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.match(await page.getByLabel("Telefone", { exact: true }).inputValue(), /8888/);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator('[data-flow-state="confirm"]').waitFor();
  await page.evaluate(() => {
    window.__visualDialog = document.querySelector('[role="dialog"]');
    window.__visualCodeDeferred = true;
    window.__visualCodeRequests = 0;
  });
  await dialog.getByRole("button", { name: "Enviar código", exact: true }).dblclick();
  await page.locator('[data-flow-state="sending"]').waitFor();
  await page.waitForFunction(
    () => window.__visualCodeRequests === 1 && typeof window.__visualReleaseCode === "function",
  );
  assert.equal(
    await page.evaluate(() => window.__visualDialog === document.querySelector('[role="dialog"]')),
    true,
    "Same shell while sending",
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-flow-state="sending"]').waitFor();
  await dialog.getByRole("status").waitFor();
  await capture("cadastro-enviando-desktop");
  await page.setViewportSize({ width: 360, height: 800 });
  await capture("cadastro-enviando-mobile");
  assert.equal(await page.evaluate(() => window.__visualCodeRequests), 1, "No duplicate request");
  await page.evaluate(() => window.__visualReleaseCode());
  await page.getByLabel("Código de autorização").waitFor();
  await dialog.waitFor({ state: "hidden" });
  console.log(
    "PASS illustrated confirmation/edit and deferred sending; same dialog, single request, Escape blocked",
  );
  await page.goto(`${base}/dashboard`);
  await page.evaluate((uid) => localStorage.removeItem(`tg_cloud_v1:${uid}:wizard_draft_v2`), uid);
  await page.goto(`${base}/dashboard/cadastro`);
  await page.getByLabel("Nome da cliente", { exact: true }).fill("Cliente de teste");
  await page.getByLabel("Telefone", { exact: true }).fill("11988887777");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator('[data-flow-state="confirm"]').waitFor();
  await page.evaluate(() => {
    window.__visualDialog = document.querySelector('[role="dialog"]');
    window.__visualCodeDeferred = true;
    window.__visualCodeFail = true;
  });
  await dialog.getByRole("button", { name: "Enviar código", exact: true }).click();
  await page.waitForFunction(() => typeof window.__visualReleaseCode === "function");
  await page.evaluate(() => window.__visualReleaseCode());
  await page.locator('[data-flow-state="failure"]').waitFor();
  assert.equal(
    await page.evaluate(() => window.__visualDialog === document.querySelector('[role="dialog"]')),
    true,
    "Same shell on failure",
  );
  await dialog.getByRole("button", { name: "Voltar", exact: true }).waitFor();
  await capture("cadastro-falha-mobile");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await capture("cadastro-falha-desktop");
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("Telefone", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS illustrated failure/back; desktop390px and sending360px fit; no unhandled JS errors",
  );
}
try {
  if (process.env.SMOKE_COMPACT_ONLY === "1") {
    await checkCompactControls();
  } else if (process.env.SMOKE_BANNERS_ONLY === "1") {
    await checkBannerFeatures();
  } else if (process.env.SMOKE_WORKSPACE_ONLY === "1") {
    await checkWorkspaceSplit();
  } else if (process.env.SMOKE_REFINEMENTS_ONLY === "1") {
    await checkRefinements();
  } else if (process.env.SMOKE_REGISTRATION_ONLY === "1") {
    await checkRegistrationDialogs();
  } else {
    await page.goto(`${base}/dashboard`);
    await page.getByRole("heading", { name: /Olá, demo/ }).waitFor();
    await page.getByText("Lola", { exact: true }).waitFor();
    await capture("dashboard-desktop");
    await page.goto(`${base}/dashboard/unico`);
    await page.getByRole("heading", { name: "Atendimento único", exact: true }).waitFor();
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
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Enviar código", exact: true })
      .click();
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
    await page.evaluate(
      (uid) => localStorage.removeItem(`tg_cloud_v1:${uid}:wizard_draft_v2`),
      uid,
    );
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
      ["/dashboard/clientes", "clientes-mobile", "Minhas clientes"],
      ["/dashboard/unico", "atendimento-unico-mobile", "Atendimento único"],
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
  }
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  console.log("FAIL AT", page.url(), await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
