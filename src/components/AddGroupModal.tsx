import { useEffect, useId, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveGroup,
  listGroups,
  loadGroupPhotoById,
  invalidateGroupsCache,
  type DialogGroup,
} from "@/lib/telegram";
import { storage, clientData, activeClient, type MonitoredGroup } from "@/lib/storage";
import { TgAvatar } from "@/components/TgAvatar";
import { Archive, Check, ChevronRight, Hash, Loader2, Search, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

function friendlyError(e: any): string {
  const msg = String(e?.message ?? e ?? "");
  const flood = msg.match(/FLOOD_WAIT_(\d+)/i);
  if (flood) return `Muitas requisições ao Telegram. Aguarde ${flood[1]}s e tente novamente.`;
  return msg;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  /** Modo Multi: opera nos grupos deste cliente (storage por conta). */
  clientId?: string;
}

/**
 * Modal único "Adicionar grupo" — compartilhado pelo Painel Único (global)
 * e pelo Painel Multi (por cliente). Qualquer ajuste visual aqui vale para os dois.
 */
export function AddGroupModal({ open, onOpenChange, onSaved, clientId }: Props) {
  const messageId = useId();
  const [groups, setGroups] = useState<DialogGroup[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [filter, setFilter] = useState("");
  const [resolved, setResolved] = useState<{
    id: string;
    name: string;
    draft: string | null;
    username?: string | null;
  } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [picking, setPicking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"main" | "archived">("main");
  const [dir, setDir] = useState(1);

  function goTo(v: "main" | "archived") {
    setDir(v === "archived" ? 1 : -1);
    setView(v);
    setFilter("");
  }

  function reset() {
    setView("main");
    setDir(1);
    setFilter("");
    setResolved(null);
    setPhotoUrl(null);
    setMessage("");
    setPicking(true);
    setError(null);
  }

  useEffect(() => {
    if (!open || !picking || groups !== null) return;
    const photoClientId = clientId ?? activeClient.get() ?? undefined;
    setLoading(true);
    setError(null);
    listGroups(photoClientId)
      .then((g) => {
        setGroups(g);
        // Carrega fotos em background, sem bloquear a UI
        (async () => {
          const queue = g.slice();
          const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
            let item = queue.shift();
            while (item) {
              const currentItem = item;
              try {
                const url = await loadGroupPhotoById(currentItem.id, photoClientId);
                if (url) setPhotos((current) => ({ ...current, [currentItem.id]: url }));
              } catch {
                /* ignore */
              }
              item = queue.shift();
            }
          });
          await Promise.all(workers);
        })();
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => {
        setLoading(false);
      });
  }, [open, picking, groups, clientId]);

  const hasArchived = useMemo(() => (groups ?? []).some((g) => g.archived), [groups]);

  const filtered = useMemo(() => {
    if (!groups) return [];
    const q = filter.trim().toLowerCase();
    const base = groups.filter((g) => (view === "archived" ? !!g.archived : !g.archived));
    if (!q) return base;
    return base.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, filter, view]);

  const existingIds = useMemo(
    () =>
      new Set((clientId ? clientData.getGroups(clientId) : storage.getGroups()).map((g) => g.id)),
    [open, groups, clientId],
  );

  async function pickGroup(g: DialogGroup) {
    setError(null);
    setLoading(true);
    const prev = activeClient.get();
    if (clientId) activeClient.set(clientId);
    try {
      const r = await resolveGroup(g.id);
      setResolved(r);
      setPhotoUrl(r.photoUrl);
      if (clientId) {
        const existing = clientData.getGroups(clientId).find((x) => x.id === r.id);
        if (existing) setMessage(existing.message);
        else if (!message.trim() && r.draft) setMessage(r.draft);
      } else {
        setMessage(r.draft ?? "");
      }
      setPicking(false);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
      if (clientId) activeClient.set(prev);
    }
  }

  function retryList() {
    if (clientId) invalidateGroupsCache(clientId);
    setGroups(null);
  }

  function save() {
    if (!resolved || !message.trim()) return;
    if (clientId) {
      const all = clientData.getGroups(clientId).slice();
      const idx = all.findIndex((g) => g.id === resolved.id);
      const prevActive = idx >= 0 ? all[idx].active : true;
      const merged: MonitoredGroup = {
        id: resolved.id,
        input: resolved.id,
        username: resolved.username ?? null,
        name: resolved.name,
        message: message.trim(),
        active: prevActive,
        addedAt: idx >= 0 ? all[idx].addedAt : Date.now(),
        photoUrl,
      };
      if (idx >= 0) all[idx] = merged;
      else all.push(merged);
      clientData.setGroups(clientId, all);
      clientData.upsertGroup(clientId, merged);
    } else {
      storage.upsertGroup({
        id: resolved.id,
        input: resolved.id,
        username: resolved.username ?? null,
        name: resolved.name,
        message: message.trim(),
        active: true,
        addedAt: Date.now(),
        photoUrl: photoUrl,
      });
    }
    reset();
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex h-[min(760px,88dvh)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="relative shrink-0 overflow-hidden border-b border-border bg-card px-5 py-6 text-left sm:px-7">
          <div className="relative z-10 max-w-[80%]">
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1 text-[9px] uppercase tracking-[.14em] text-muted-foreground">
              <span className="text-foreground">{picking ? "01" : "02"}</span>
              {picking ? "Destino" : "Mensagem"}
              <span className="text-border">/</span>Adicionar grupo
            </span>
            <DialogTitle className="mt-4 text-2xl font-medium tracking-tight">
              {picking ? "Escolher grupo" : "Preparar rascunho"}
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {picking
                ? "Selecione um grupo da conta Telegram desta cliente."
                : "Revise o destino e a mensagem que será enviada."}
            </DialogDescription>
          </div>
          <img
            src="/art/cat-note.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -right-6 -bottom-12 h-44 w-44 rotate-[-12deg] object-cover opacity-80 sm:right-4"
          />
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
          {picking ? (
            <div className="min-w-0 overflow-hidden">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Buscar grupo pelo nome..."
                    aria-label="Buscar grupo pelo nome"
                    disabled={!groups}
                    className="h-10 rounded-lg bg-card pl-10 text-xs"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "grupo" : "grupos"}
                </span>
              </div>
              <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
                <button
                  type="button"
                  onClick={() => goTo("main")}
                  aria-pressed={view === "main"}
                  className={`rounded-lg px-3 py-2 text-xs transition-colors ${view === "main" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                >
                  Grupos
                </button>
                {hasArchived && (
                  <button
                    type="button"
                    onClick={() => goTo("archived")}
                    aria-pressed={view === "archived"}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${view === "archived" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Archive className="size-3.5" aria-hidden />
                    Arquivados
                  </button>
                )}
              </div>
              <AnimatePresence mode="wait" custom={dir} initial={false}>
                <motion.div
                  key={view}
                  custom={dir}
                  variants={{
                    enter: (direction: number) => ({ opacity: 0, x: 16 * direction }),
                    center: { opacity: 1, x: 0 },
                    exit: (direction: number) => ({ opacity: 0, x: -16 * direction }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.18 }}
                  className="space-y-2"
                >
                  {loading && !groups && (
                    <div
                      role="status"
                      className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-5 py-12 text-xs text-muted-foreground"
                    >
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Carregando grupos…
                    </div>
                  )}
                  {groups && !filtered.length && (
                    <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
                      <Hash className="mx-auto size-6 text-muted-foreground" aria-hidden />
                      <p className="mt-3 text-sm">Nenhum grupo encontrado</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {filter.trim()
                          ? "Tente buscar por outro nome."
                          : view === "archived"
                            ? "Não há grupos arquivados nesta conta."
                            : "Os grupos desta conta aparecerão aqui."}
                      </p>
                    </div>
                  )}
                  {filtered.map((g, index) => {
                    const isCurrent = resolved?.id === g.id;
                    const already = existingIds.has(g.id) && !isCurrent;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => !already && pickGroup(g)}
                        disabled={loading || already}
                        className="group flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:border-foreground/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
                      >
                        <span className="hidden w-5 shrink-0 text-[10px] tabular-nums text-muted-foreground sm:block">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {photos[g.id] ? (
                          <img
                            src={photos[g.id] as string}
                            alt=""
                            className="size-10 shrink-0 rounded-xl border border-border object-cover"
                          />
                        ) : (
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background">
                            <TgAvatar name={g.name} single className="shrink-0" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium sm:text-sm">
                            {g.name}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {g.isChannel ? "Canal" : "Grupo"}
                            {g.archived ? " · Arquivado" : ""}
                          </span>
                        </span>
                        {isCurrent || already ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
                            <Check className="size-3" aria-hidden />
                            {isCurrent ? "Selecionado" : "Adicionado"}
                          </span>
                        ) : (
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                            aria-hidden
                          />
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                  <Hash className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                    Destino selecionado
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">{resolved?.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="shrink-0 text-[11px] text-muted-foreground underline underline-offset-4"
                >
                  Alterar
                </button>
              </div>
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={messageId} className="text-xs">
                      Rascunho da cliente
                    </Label>
                    {resolved?.draft && (
                      <span className="rounded-md border border-border px-2 py-1 text-[9px] text-muted-foreground">
                        Carregado do Telegram
                      </span>
                    )}
                  </div>
                  <Textarea
                    id={messageId}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={8}
                    placeholder="Ex.: Maria x João · Raio 5 · Cela 2"
                    className="min-h-48 resize-y rounded-xl border border-solid border-border bg-card p-4 font-sans text-sm leading-relaxed"
                  />
                  <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">
                    {message.length} caracteres
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="flex items-center gap-2 text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                    <Send className="size-3" aria-hidden />
                    Prévia da mensagem
                  </p>
                  <div className="mt-4 rounded-xl rounded-br-sm border border-border bg-muted/60 p-4">
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                      {message.trim() || "O rascunho aparecerá aqui."}
                    </p>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                    A mensagem será enviada ao grupo selecionado quando o monitoramento disparar.
                  </p>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-5 space-y-3">
              <p
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-xs leading-relaxed text-danger"
              >
                {error}
              </p>
              {picking && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryList}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Tentando…" : "Tentar novamente"}
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center gap-3 border-t border-border bg-card px-5 py-4 sm:justify-between sm:px-7">
          <span className="mr-auto hidden text-[10px] text-muted-foreground sm:block">
            {picking ? "Etapa 1 de 2 · Seleção do destino" : "Etapa 2 de 2 · Revisão do rascunho"}
          </span>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancelar
            </Button>
            {!picking && (
              <Button type="button" onClick={save} disabled={!message.trim()}>
                <Check className="size-4" aria-hidden />
                Adicionar grupo
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
