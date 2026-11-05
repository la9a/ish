// Server-side envelope encryption for Telegram credentials.
// api_hash and tg_session are AES-GCM encrypted with a key derived from
// SESSION_ENCRYPTION_KEY (server secret) + per-user salt (userId), so the
// browser never handles plaintext DB writes and RLS is no longer the only
// defense-in-depth layer.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ENC_PREFIX = "enc:v1:";

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
      salt: enc.encode(`tg-creds:${userId}`),
      info: enc.encode("aes-gcm-256"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encryptStr(userId: string, plaintext: string): Promise<string> {
  const key = await getKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return `${ENC_PREFIX}${b64(iv)}.${b64(ct)}`;
}

async function decryptStr(userId: string, blob: string): Promise<string> {
  if (!blob.startsWith(ENC_PREFIX)) return blob; // legacy plaintext row
  const [ivB64, ctB64] = blob.slice(ENC_PREFIX.length).split(".");
  if (!ivB64 || !ctB64) throw new Error("bad ciphertext format");
  const key = await getKey(userId);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) as BufferSource },
    key,
    unb64(ctB64) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

export const pushClientSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    clientId: z.string().trim().min(1).max(128),
    apiId: z.number().int().positive().max(9_999_999_999).nullable().optional(),
    apiHash: z.string().max(128).nullable().optional(),
    session: z.string().max(16_384).nullable().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const patch: Record<string, unknown> = {};
    if (data.apiId !== undefined) patch.api_id = data.apiId == null ? null : Number(data.apiId);
    if (data.apiHash !== undefined) {
      patch.api_hash = data.apiHash ? await encryptStr(userId, String(data.apiHash)) : null;
    }
    if (data.session !== undefined) {
      const s = data.session;
      patch.tg_session = s && s.length > 4 ? await encryptStr(userId, s) : null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("clients")
      .update(patch)
      .eq("user_id", userId)
      .eq("id", data.clientId);
    if (error) {
      console.error("Falha ao salvar credenciais", error.message);
      throw new Error("Não foi possível salvar as credenciais.");
    }
    return { ok: true };
  });

export const pullClientSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: z.string().trim().min(1).max(128) }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data: row, error } = await supabase
      .from("clients")
      .select("api_id, api_hash, tg_session")
      .eq("user_id", userId)
      .eq("id", data.clientId)
      .maybeSingle();
    if (error) {
      console.error("Falha ao carregar credenciais", error.message);
      throw new Error("Não foi possível carregar as credenciais.");
    }
    if (!row) return null;
    return {
      apiId: row.api_id == null ? null : Number(row.api_id),
      apiHash: row.api_hash ? await decryptStr(userId, String(row.api_hash)) : null,
      session: row.tg_session ? await decryptStr(userId, String(row.tg_session)) : null,
    };
  });

export const pullAllClientSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data, error } = await supabase
      .from("clients")
      .select("id, api_id, api_hash, tg_session")
      .eq("user_id", userId);
    if (error) {
      console.error("Falha ao carregar credenciais", error.message);
      throw new Error("Não foi possível carregar as credenciais.");
    }
    const out: Record<string, { apiId: number | null; apiHash: string | null; session: string | null }> = {};
    for (const row of data ?? []) {
      out[String(row.id)] = {
        apiId: row.api_id == null ? null : Number(row.api_id),
        apiHash: row.api_hash ? await decryptStr(userId, String(row.api_hash)) : null,
        session: row.tg_session ? await decryptStr(userId, String(row.tg_session)) : null,
      };
    }
    return out;
  });