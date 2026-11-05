// Automação server-side do fluxo my.telegram.org: send_password → login →
// /apps → /apps/create → /apps. Extrai api_id / api_hash direto do HTML e
// devolve pro cliente já pronto pra usar no MTProto. O cookie stel_token é
// sensível: nunca sai em texto claro; é criptografado (AES-GCM + HKDF por
// userId, mesma abordagem do sessionCrypto.functions.ts) e devolvido como
// string opaca `mtSession` de TTL curto (15 min).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const phoneSchema = z.string().trim().min(7).max(24).regex(/^\+?[0-9 ()-]+$/);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const ORIGIN = "https://my.telegram.org";
const MT_SESSION_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const ACCEPT_LANGUAGE = "pt-BR,pt;q=0.9";
const SEC_CH_UA = '"Not-A.Brand";v="24", "Chromium";v="146"';

// ---------- crypto helpers (idênticos ao sessionCrypto.functions.ts) ----------
async function getKey(userId: string): Promise<CryptoKey> {
  const secret = process.env.SESSION_ENCRYPTION_KEY;
  if (!secret) throw new Error("SESSION_ENCRYPTION_KEY not configured");
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(`mt-session:${userId}`),
      info: enc.encode("aes-gcm-256"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface MtSessionPayload {
  stelToken: string;
  cookies?: string;
  phone: string;
  exp: number;
}

async function packSession(userId: string, payload: MtSessionPayload): Promise<string> {
  const key = await getKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt as BufferSource),
  );
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function unpackSession(userId: string, blob: string): Promise<MtSessionPayload> {
  const [ivB64, ctB64] = blob.split(".");
  if (!ivB64 || !ctB64) throw new Error("mt_session_malformed");
  const key = await getKey(userId);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64url(ivB64) as BufferSource },
    key,
    unb64url(ctB64) as BufferSource,
  );
  const payload = JSON.parse(new TextDecoder().decode(pt)) as MtSessionPayload;
  if (!payload.stelToken || !payload.exp || Date.now() > payload.exp) {
    throw new Error("mt_session_expired");
  }
  return payload;
}

// ---------- telefone ----------
function normalizeTelegramPhone(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("phone required");
  let digits = raw.replace(/\D/g, "");

  if (raw.startsWith("+")) {
    if (!/^\d{8,20}$/.test(digits)) throw new Error("phone invalid format");
    return `+${digits}`;
  }

  digits = digits.replace(/^0+/, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  if (/^\d{8,20}$/.test(digits)) return `+${digits}`;
  throw new Error("phone invalid format");
}

// ---------- cookie jar ----------
type CookieJar = Record<string, string>;

function splitCombinedSetCookie(header: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let i = 0; i < header.length; i++) {
    const before = header.slice(Math.max(0, i - 8), i + 1).toLowerCase();
    if (before.endsWith("expires=")) inExpires = true;
    if (inExpires && header[i] === ";") inExpires = false;
    if (!inExpires && header[i] === ",") {
      const rest = header.slice(i + 1);
      if (/^\s*[^=;\s,]+=[^;]*/.test(rest)) {
        out.push(header.slice(start, i).trim());
        start = i + 1;
      }
    }
  }

  const last = header.slice(start).trim();
  if (last) out.push(last);
  return out;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") {
    const values = maybeGetSetCookie.call(headers).filter(Boolean);
    if (values.length) return values;
  }
  const single = headers.get("set-cookie");
  return single ? splitCombinedSetCookie(single) : [];
}

function applySetCookies(jar: CookieJar, headers: Headers): CookieJar {
  const next: CookieJar = { ...jar };
  for (const setCookie of getSetCookieHeaders(headers)) {
    const first = setCookie.split(";")[0]?.trim();
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    if (!value) delete next[name];
    else next[name] = value;
  }
  return next;
}

function parseCookieHeader(header: string): CookieJar {
  const out: CookieJar = {};
  if (!header) return out;
  header.split(/;\s*/).forEach((part) => {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  });
  return out;
}

function serializeCookies(jar: CookieJar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function cookieNames(jar: CookieJar): string[] {
  return Object.keys(jar).sort();
}

function extractStelTokenFromCookies(cookieHeader: string): string | null {
  return parseCookieHeader(cookieHeader).stel_token ?? null;
}

function safeDetail(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

// ---------- fetch helper com timeout e headers padrão de browser ----------
function browserBaseHeaders(referer: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    "User-Agent": UA,
    "Accept-Language": ACCEPT_LANGUAGE,
    "Sec-Ch-Ua": SEC_CH_UA,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Accept-Encoding": "gzip, deflate, br",
    Priority: "u=1, i",
    Referer: referer,
    ...extra,
  };
}

function navigationHeaders(referer = ORIGIN, extra: Record<string, string> = {}): HeadersInit {
  return browserBaseHeaders(referer, {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Sec-Fetch-Site": referer === ORIGIN ? "none" : "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    ...extra,
  });
}

function xhrHeaders(referer: string, cookieHeader: string, extra: Record<string, string> = {}): HeadersInit {
  return browserBaseHeaders(referer, {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Origin: ORIGIN,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...extra,
  });
}

function appsPageHeaders(referer: string, cookieHeader: string): HeadersInit {
  return browserBaseHeaders(referer, {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  });
}

async function tgFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

// Faz um GET em /auth?to=apps pra pegar todos os cookies iniciais que o
// my.telegram.org planta antes do POST XHR. O jar preserva todos os nomes,
// não apenas stel_ssid/stel_token.
async function primeAuthCookies(): Promise<{ cookieHeader: string; names: string[]; status: number }> {
  const res = await tgFetch(`${ORIGIN}/auth?to=apps`, {
    method: "GET",
    headers: navigationHeaders(ORIGIN),
  });
  const jar = applySetCookies({}, res.headers);
  return { cookieHeader: serializeCookies(jar), names: cookieNames(jar), status: res.status };
}

function slug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 28);
}

// ============================================================
// 1) send_password: dispara o código pro Telegram do usuário
// ============================================================
export const mtSendPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phone: phoneSchema }).transform((d) => ({ phone: normalizeTelegramPhone(d.phone) })))
  .handler(async ({ data, context }) => {
    const body = `phone=${encodeURIComponent(data.phone)}`;
    const res = await tgFetch(`${ORIGIN}/auth/send_password`, {
      method: "POST",
      // A captura do Burp mostra que o POST que dispara o código não carrega
      // Cookie; enviar o cookie do GET inicial faz o Telegram recusar o XHR em
      // alguns fingerprints/IPs.
      headers: xhrHeaders(`${ORIGIN}/auth/send_password`, ""),
      body,
    });
    const text = await res.text();
    const jarAfter = applySetCookies({}, res.headers);
    const namesAfter = cookieNames(jarAfter);

    if (!res.ok) {
      return {
        error: "send_password_failed",
        status: res.status,
        detail: safeDetail(text),
        stage: "send_password",
        cookieNames: namesAfter,
      } as const;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        error: "send_password_bad_response",
        detail: safeDetail(text),
        stage: "send_password_parse",
        cookieNames: namesAfter,
      } as const;
    }

    const randomHash = (parsed as { random_hash?: string })?.random_hash;
    if (!randomHash || typeof randomHash !== "string") {
      return {
        error: "send_password_no_hash",
        detail: safeDetail(text),
        stage: "send_password_no_hash",
        cookieNames: namesAfter,
      } as const;
    }

    return { ok: true, randomHash, cookies: serializeCookies(jarAfter) } as const;
  });

// ============================================================
// 2) login: troca código por stel_token e devolve mtSession opaca
// ============================================================
export const mtLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    phone: phoneSchema,
    randomHash: z.string().min(1).max(512),
    password: z.string().min(1).max(32),
    cookies: z.string().max(4_096).optional(),
  }).transform((d) => ({ ...d, phone: normalizeTelegramPhone(d.phone) })))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const body =
      `phone=${encodeURIComponent(data.phone)}` +
      `&random_hash=${encodeURIComponent(data.randomHash)}` +
      `&password=${encodeURIComponent(data.password)}`;
    const res = await tgFetch(`${ORIGIN}/auth/login`, {
      method: "POST",
      headers: xhrHeaders(`${ORIGIN}/auth`, data.cookies ?? ""),
      body,
    });
    const text = (await res.text()).trim();
    const jarAfter = applySetCookies(parseCookieHeader(data.cookies ?? ""), res.headers);
    const cookiesAfter = serializeCookies(jarAfter);

    if (!res.ok) {
      console.error(`[mtLogin] falhou [${res.status}]: ${safeDetail(text).slice(0, 200)}`);
      return { error: "login_failed", status: res.status, detail: safeDetail(text), cookieNames: cookieNames(jarAfter) } as const;
    }
    if (text !== "true") {
      return { error: "invalid_code", detail: safeDetail(text), cookieNames: cookieNames(jarAfter) } as const;
    }

    const stelToken = extractStelTokenFromCookies(cookiesAfter);
    if (!stelToken) {
      console.error(`[mtLogin] sem stel_token; cookies: ${cookieNames(jarAfter).join(",")}`);
      return { error: "login_no_cookie", cookieNames: cookieNames(jarAfter) } as const;
    }

    const mtSession = await packSession(userId, {
      stelToken,
      cookies: cookiesAfter,
      phone: data.phone,
      exp: Date.now() + MT_SESSION_TTL_MS,
    });
    return { ok: true, mtSession } as const;
  });

// ============================================================
// 3) ensureApp: garante que a conta tem um app criado e extrai api_id/hash
// ============================================================

function inputValueByName(html: string, name: string): string | null {
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    if (nameMatch?.[1] !== name) continue;
    return tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

function extractCreateHash(html: string): string | null {
  return inputValueByName(html, "hash");
}

function extractApiCreds(html: string): { apiId: string; apiHash: string } | null {
  // O Telegram já exibiu esses valores em <strong>, <span> e <input>.
  // Procura primeiro perto do rótulo e mantém um fallback estrutural para
  // pequenas alterações no HTML não mandarem o usuário ao fluxo manual.
  const idArea = html.match(/(?:api[_ ]?id|App api_id)[\s\S]{0,800}/i)?.[0] ?? html;
  const hashArea = html.match(/(?:api[_ ]?hash|App api_hash)[\s\S]{0,800}/i)?.[0] ?? html;
  const idMatch =
    idArea.match(/(?:value=["']|>\s*)(\d{4,12})(?:["']|\s*<)/i) ||
    html.match(/\bapi[_-]?id\b[^\d]{0,500}(\d{4,12})/i);
  const hashMatch =
    hashArea.match(/(?:value=["']|>\s*)([a-f0-9]{32})(?:["']|\s*<)/i) ||
    html.match(/\bapi[_-]?hash\b[^a-f0-9]{0,500}([a-f0-9]{32})/i);
  if (!idMatch || !hashMatch) return null;
  return { apiId: idMatch[1], apiHash: hashMatch[1].toLowerCase() };
}

class AppsPageError extends Error {}

async function getAppsPage(cookieHeader: string): Promise<{ html: string; cookies: string }> {
  const res = await tgFetch(`${ORIGIN}/apps`, {
    method: "GET",
    headers: appsPageHeaders(`${ORIGIN}/auth`, cookieHeader),
  });
  // Redirecionamento para /auth = cookie de login não vale mais.
  if (res.status >= 300 && res.status < 400) throw new AppsPageError("apps_redirect");
  if (!res.ok) throw new AppsPageError(`apps_get_failed_${res.status}`);
  const jarAfter = applySetCookies(parseCookieHeader(cookieHeader), res.headers);
  return { html: await res.text(), cookies: serializeCookies(jarAfter) };
}

/** Texto visível curto (sem tags) para diagnóstico nos logs, sem credenciais. */
function htmlHint(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[a-f0-9]{32}/gi, "[hash]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function asciiTitle(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function createAppViaMiami(
  cookies: string,
  title: string,
  shortNames: string[],
  desc: string,
): Promise<{ ok: true; apiId: string; apiHash: string } | { ok: false; error: string }> {
  const base = process.env.MIAMI_AGENT_URL;
  const token = process.env.MIAMI_AGENT_TOKEN;
  if (!base || !token) return { ok: false, error: "agent_not_configured" };
  const host = new URL(base).hostname;
  const ip = /^(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:\.(?:nip|sslip)\.io)?$/.exec(host);
  // Mesma regra da ponte: HTTPS sslip.io derivado do host configurado primeiro.
  const urls = [
    ...(ip ? [`https://${ip.slice(1).join("-")}.sslip.io/mt/ensure-app`] : []),
    new URL("/mt/ensure-app", base).href,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cookies, title, shortNames, desc }),
        signal: AbortSignal.timeout(55_000),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; apiId?: string; apiHash?: string; error?: string; detail?: string };
      if (out.ok && out.apiId && out.apiHash) return { ok: true, apiId: out.apiId, apiHash: out.apiHash };
      return { ok: false, error: `${out.error ?? `http_${res.status}`} ${out.detail ?? ""}`.trim() };
    } catch (e) {
      console.error(`[mtEnsureApp] Miami inacessível: ${String((e as Error)?.message ?? e)}`);
    }
  }
  return { ok: false, error: "agent_unreachable" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mtEnsureApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    mtSession: z.string().min(20).max(16_384),
    clientTitle: z.string().trim().min(1).max(64),
  }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    let payload: MtSessionPayload;
    try {
      payload = await unpackSession(userId, data.mtSession);
    } catch (e) {
      return { error: "session_expired", detail: String((e as Error).message ?? e) } as const;
    }

    try {
      let cookieHeader = payload.cookies || `stel_token=${payload.stelToken}`;
      const firstApps = await getAppsPage(cookieHeader);
      cookieHeader = firstApps.cookies;
      let html = firstApps.html;
      let creds = extractApiCreds(html);
      if (creds) return { ok: true, apiId: creds.apiId, apiHash: creds.apiHash } as const;

      // Conta ainda sem app: cria igual ao navegador.
      // Título = nome da primeira tela; nome curto = "sb" + nome (ex.: sbAdriana).
      const base = asciiTitle(data.clientTitle).replace(/\s+/g, "") || "Cliente";
      const appTitle = (asciiTitle(data.clientTitle) || "Cliente").slice(0, 32);
      let root = `sb${base}`.slice(0, 30);
      while (root.length < 5) root += "0";
      const shortNames = [root, `${root}2`, `${root}3`];
      const appDesc = "Desktop client";
      let lastDetail = "";

      for (let attempt = 0; attempt < 1; attempt++) {
        const createHash = extractCreateHash(html);
        if (!createHash) {
          console.error(`[mtEnsureApp] sem formulário nem credenciais: ${htmlHint(html)}`);
          return { error: "parse_failed", stage: "no_form_no_creds" } as const;
        }
        const body = new URLSearchParams({
          hash: createHash,
          app_title: appTitle,
          app_shortname: shortNames[0],
          app_url: "",
          app_platform: "desktop",
          app_desc: appDesc,
        }).toString();
        const createRes = await tgFetch(`${ORIGIN}/apps/create`, {
          method: "POST",
          headers: xhrHeaders(`${ORIGIN}/apps`, cookieHeader),
          body,
        });
        const createText = (await createRes.text()).trim();
        cookieHeader = serializeCookies(applySetCookies(parseCookieHeader(cookieHeader), createRes.headers));
        console.log(`[mtEnsureApp] criação ${shortNames[0]} [${createRes.status}]: ${safeDetail(createText).slice(0, 80)}`);
        for (let read = 0; read < 3; read++) {
          if (read > 0) await sleep(1_000);
          const after = await getAppsPage(cookieHeader);
          cookieHeader = after.cookies;
          html = after.html;
          creds = extractApiCreds(html);
          if (creds) return { ok: true, apiId: creds.apiId, apiHash: creds.apiHash } as const;
          if (extractCreateHash(html)) break;
        }
        lastDetail = safeDetail(createText).slice(0, 200);
      }

      // Reserva: cria pelo robô de Miami (IP fixo), com nomes alternativos.
      const viaMiami = await createAppViaMiami(cookieHeader, appTitle, shortNames, appDesc);
      if (viaMiami.ok) return { ok: true, apiId: viaMiami.apiId, apiHash: viaMiami.apiHash } as const;
      console.error(`[mtEnsureApp] reserva Miami falhou: ${viaMiami.error}`);
      lastDetail = viaMiami.error || lastDetail;
      return { error: "create_failed", detail: lastDetail } as const;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.error(`[mtEnsureApp] erro: ${msg}`);
      if (msg === "apps_redirect") return { error: "session_expired", detail: msg } as const;
      return { error: "ensure_failed", detail: msg.slice(0, 200) } as const;
    }
  });

// ============================================================
// 4) diagnose: sonda de fingerprint pro my.telegram.org
// ============================================================
//
// Faz três chamadas isoladas pra descobrir por que o Telegram devolve
// "Only HTML requests are supported here":
//  A) GET /auth?to=apps sem cookies
//  B) POST /auth/send_password SEM Cookie
//  C) POST /auth/send_password COM Cookie do GET
//
// Retorna somente metadados (status, nomes de cookies, primeiros chars do
// corpo) — nunca o cookie/telefone em texto claro pro cliente.
export const mtDiagnose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phone: phoneSchema }).transform((d) => ({ phone: normalizeTelegramPhone(d.phone) })))
  .handler(async ({ data, context }) => {
    const summarize = async (label: string, res: Response) => {
      const text = await res.text();
      const jar = applySetCookies({}, res.headers);
      const preview = text.replace(/\s+/g, " ").trim().slice(0, 300);
      let kind: "json_random_hash" | "html_only" | "json_other" | "html_other" | "other" = "other";
      if (/^\{\s*"random_hash"/.test(text)) kind = "json_random_hash";
      else if (/Only HTML requests are supported here/i.test(text)) kind = "html_only";
      else if (text.trim().startsWith("{")) kind = "json_other";
      else if (text.trim().startsWith("<")) kind = "html_other";
      return {
        label,
        status: res.status,
        contentType: res.headers.get("content-type") ?? null,
        length: text.length,
        setCookieNames: cookieNames(jar),
        preview,
        kind,
      };
    };

    // A) GET inicial
    const aRes = await tgFetch(`${ORIGIN}/auth?to=apps`, {
      method: "GET",
      headers: navigationHeaders(ORIGIN),
    });
    const aText = await aRes.text();
    const aJar = applySetCookies({}, aRes.headers);
    const aCookieHeader = serializeCookies(aJar);
    const a = {
      label: "GET /auth?to=apps",
      status: aRes.status,
      contentType: aRes.headers.get("content-type") ?? null,
      length: aText.length,
      setCookieNames: cookieNames(aJar),
      preview: aText.replace(/\s+/g, " ").trim().slice(0, 300),
    };

    // B) POST sem Cookie
    const bBody = `phone=${encodeURIComponent(data.phone)}`;
    const bRes = await tgFetch(`${ORIGIN}/auth/send_password`, {
      method: "POST",
      headers: xhrHeaders(`${ORIGIN}/auth?to=apps`, ""),
      body: bBody,
    });
    const b = await summarize("POST /auth/send_password (sem cookie)", bRes);

    // C) POST com Cookie do GET
    const cRes = await tgFetch(`${ORIGIN}/auth/send_password`, {
      method: "POST",
      headers: xhrHeaders(`${ORIGIN}/auth?to=apps`, aCookieHeader),
      body: bBody,
    });
    const c = await summarize("POST /auth/send_password (com cookie)", cRes);

    return { ok: true, a, b, c } as const;
  });