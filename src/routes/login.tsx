import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { appAuth } from "@/lib/appAuth";
import { getAccessLock } from "@/lib/accessKey.functions";
import { Logo } from "@/components/Logo";
import { AccessNotification } from "@/components/AccessNotification";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entre na sua conta · Senha Baixa" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { name: "description", content: "Suas clientes, seus rascunhos. Tudo em um só lugar." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [vpn, setVpn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setHydrated(true);
    appAuth
      .hydrate()
      .then(() => {
        if (alive && appAuth.current()) navigate({ to: "/dashboard", replace: true });
      })
      .catch(() => {});
    getAccessLock()
      .then((result) => {
        if (!alive) return;
        if (result.remainingMs > 0) setLockUntil(Date.now() + result.remainingMs);
        setVpn(result.vpn);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!lockUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  const locked = vpn || lockUntil > now;
  const seconds = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  const lockMessage = vpn
    ? "Desative a VPN ou proxy para entrar."
    : `Tente novamente em ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || locked || !key.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await appAuth.loginWithKey(key);
      if (!result.ok) {
        setKey("");
        setError(result.error);
        if (result.vpn) setVpn(true);
        if (result.remainingMs) {
          setLockUntil(Date.now() + result.remainingMs);
          setNow(Date.now());
        }
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch {
      setError("Não foi possível conectar. Confira sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sb-auth">
      <section className="sb-auth-form">
        <a href="/" className="sb-brand" aria-label="Senha Baixa, início">
          <Logo className="size-9" />
          <span>
            senha baixa<span className="text-muted-foreground">.</span>
          </span>
        </a>
        <div className="sb-auth-inner">
          <span className="sb-eyebrow">MENOS CORRERIA. MAIS CONTROLE.</span>
          <h1>
            Bom ter
            <br />
            você por aqui<span className="text-muted-foreground">.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
            Entre na sua conta para organizar suas clientes e acompanhar cada atendimento.
          </p>
          <form onSubmit={submit} className="mt-10 space-y-5">
            <div>
              <label htmlFor="access-key" className="mb-2.5 block text-sm font-medium">
                Sua chave de acesso
              </label>
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-4 top-4 size-4 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id="access-key"
                  disabled={!hydrated}
                  type={visible ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                  autoComplete="current-password"
                  spellCheck={false}
                  placeholder="Digite sua chave"
                  aria-describedby={error || locked ? "login-error" : undefined}
                  aria-invalid={Boolean(error)}
                  className="sb-input w-full py-3.5 pl-11 pr-12"
                />
                <button
                  type="button"
                  disabled={!hydrated}
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Ocultar chave" : "Mostrar chave"}
                  aria-pressed={visible}
                  className="absolute right-1 top-1 grid size-10 place-items-center text-muted-foreground hover:text-white"
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {(error || locked) && (
              <p id="login-error" role="alert" className="text-sm leading-6 text-danger">
                {locked ? lockMessage : error}
              </p>
            )}
            <button
              type="submit"
              disabled={!hydrated || busy || locked || !key.trim()}
              className="sb-button w-full justify-between py-3.5"
            >
              {busy ? "Entrando na sua conta…" : "Entrar no painel"}
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </button>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4" /> Seu acesso é pessoal. Suas clientes também.
            </p>
          </form>
        </div>
        <footer className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>© {new Date().getFullYear()} Senha Baixa</span>
          <span>Feito para facilitar sua rotina.</span>
        </footer>
      </section>
      <section className="sb-auth-art" aria-label="Ilustração de gato colorido">
        <img
          src="/art/cat-hero.svg"
          alt="Gato de óculos em uma composição lilás, rosa e verde"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="sb-art-label">
          <span className="sb-art-pill">SUA ROTINA, EM OUTRO RITMO ↗</span>
          <p>
            Organização
            <br />é coisa de
            <br />
            <em>quem cuida.</em>
          </p>
        </div>
        <span className="absolute bottom-7 right-7 text-xs font-semibold text-black/60">
          SENHA BAIXA — DO SEU JEITO.
        </span>
      </section>
      <AccessNotification open={locked} title="Acesso temporariamente bloqueado">
        {lockMessage}
      </AccessNotification>
    </main>
  );
}
