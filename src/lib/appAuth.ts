// Auth de aplicação. O acesso é feito por chave; o servidor valida a chave e
// devolve a sessão da conta correspondente.

import { supabase } from "@/integrations/supabase/client";
import { loginWithAccessKey } from "@/lib/accessKey.functions";

const APP_USER_KEY = ["a", "p", "p", "_", "u", "s", "e", "r", "_", "v", "3"].join("");
const APP_USER_ID_KEY = ["a", "p", "p", "_", "u", "s", "e", "r", "_", "i", "d", "_", "v", "3"].join(
  "",
);

type Listener = (user: string | null) => void;
const listeners = new Set<Listener>();

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// Supabase exige senha >= 6. Se a senha digitada for menor, "preenche" com
// um sufixo fixo — invisível pro usuário. A mesma transformação é aplicada
// no login e na troca de senha, então funciona consistentemente.
function toSbPassword(p: string): string {
  const clean = p.trim();
  if (clean.length >= 6) return clean;
  return (clean + "______").slice(0, 6);
}

function setLocalUser(user: string | null, userId: string | null) {
  if (!isBrowser()) return;
  if (user && userId) {
    window.localStorage.setItem(APP_USER_KEY, user);
    window.localStorage.setItem(APP_USER_ID_KEY, userId);
  } else {
    window.localStorage.removeItem(APP_USER_KEY);
    window.localStorage.removeItem(APP_USER_ID_KEY);
  }
}

export const appAuth = {
  current(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(APP_USER_KEY);
  },
  currentUserId(): string | null {
    if (!isBrowser()) return null;
    return window.localStorage.getItem(APP_USER_ID_KEY);
  },
  async hydrate(): Promise<void> {
    // Mantém o cache local em sincronia com o token salvo do supabase.
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setLocalUser(null, null);
      return;
    }
    const email = data.user.email ?? "";
    const u = email.split("@")[0] || null;
    if (u) setLocalUser(u, data.user.id);
  },
  async loginWithKey(
    key: string,
  ): Promise<{ ok: true } | { ok: false; error: string; remainingMs?: number; vpn?: boolean }> {
    const clean = key.trim();
    if (!clean) return { ok: false, error: "Chave inválida." };

    let res: Awaited<ReturnType<typeof loginWithAccessKey>>;
    try {
      res = await loginWithAccessKey({ data: { key: clean } });
    } catch {
      return { ok: false, error: "Não foi possível entrar. Tente de novo." };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: "Chave inválida.",
        remainingMs: "remainingMs" in res ? res.remainingMs : undefined,
        vpn: "vpn" in res ? Boolean(res.vpn) : false,
      };
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: res.accessToken,
      refresh_token: res.refreshToken,
    });
    if (error || !data?.user) return { ok: false, error: "Chave inválida." };

    const u = (data.user.email ?? "").split("@")[0] || null;
    if (!u) return { ok: false, error: "Chave inválida." };
    setLocalUser(u, data.user.id);
    listeners.forEach((fn) => fn(u));
    return { ok: true };
  },
  async logout() {
    // Invalidate the local account before awaiting the network. In-flight
    // cloud sync must stop writing into a scope as soon as logout begins.
    setLocalUser(null, null);
    if (isBrowser()) window.sessionStorage.removeItem("active_client_v1");
    listeners.forEach((fn) => fn(null));
    // The active client also has an in-memory cache. Clearing sessionStorage
    // alone leaves the previous account's selection alive until a reload.
    const { activeClient } = await import("@/lib/storage");
    activeClient.set(null);
    try {
      await supabase.auth.signOut();
    } catch {
      /* local logout remains valid */
    }
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
