import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { Archive, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
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
    const prev = activeClient.get();
    if (clientId) activeClient.set(clientId);
    const photoClientId = clientId ?? activeClient.get() ?? undefined;
    setLoading(true);
    setError(null);
    listGroups()
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
      .finally(() => { setLoading(false); if (clientId) activeClient.set(prev); });
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
      new Set(
        (clientId ? clientData.getGroups(clientId) : storage.getGroups()).map((g) => g.id)
      ),
    [open, groups, clientId]
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

  const title = picking ? "Selecione um grupo" : "Adicionar grupo";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent
        className="flex h-[80dvh] w-[calc(100vw-2rem)] min-w-0 max-w-lg flex-col gap-0 overflow-hidden p-0 sm:h-[560px] sm:max-h-[80dvh]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="relative sticky top-0 z-20 shrink-0 border-b border-border bg-background px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          {picking && view === "archived" && (
            <button
              type="button"
              onClick={() => goTo("main")}
              className="absolute left-4 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-border/70 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground sm:left-6"
              aria-label="Voltar"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          <DialogTitle className="flex items-center justify-center text-center">
            {title}
          </DialogTitle>
        </DialogHeader>


        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-6 sm:px-6 sm:pb-5 sm:pt-7">
          {picking ? (
          <div className="w-full min-w-0 overflow-x-hidden" style={{ perspective: 900 }}>
            <div className="mb-5 w-full">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Buscar..."
                  disabled={!groups}
                  className="h-11 w-full rounded-full pl-10"
                />
              </div>
            </div>

          <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={view}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: 64 * d, rotateY: 10 * d }),
              center: { opacity: 1, x: 0, rotateY: 0 },
              exit: (d: number) => ({ opacity: 0, x: -64 * d, rotateY: -8 * d }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformStyle: "preserve-3d" }}
            className="w-full min-w-0 space-y-3 overflow-x-hidden"
          >
            {view === "main" && hasArchived && (
              <button
                type="button"
                onClick={() => goTo("archived")}
                className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-muted/30 px-3 py-2.5 text-left transition hover:bg-muted/60"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                  <Archive className="size-5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">Arquivados</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            )}

            <div className="w-full min-w-0 space-y-1 overflow-x-hidden rounded-2xl border border-border/70 p-1">
              {loading && !groups && (
                <div className="flex w-full items-center justify-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Carregando grupos…
                </div>
              )}
              {groups && filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum grupo encontrado
                </div>
              )}
              {filtered.map((g) => {
                const isCurrent = resolved?.id === g.id;
                const already = existingIds.has(g.id) && !isCurrent;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => !already && pickGroup(g)}
                    disabled={loading || already}
                    className="grid w-full max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-left text-sm transition hover:bg-muted/60 disabled:opacity-50"
                  >
                    {photos[g.id] ? (
                      <img
                        src={photos[g.id] as string}
                        alt=""
                        className="size-10 shrink-0 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <TgAvatar name={g.name} single className="shrink-0" />
                    )}
                    <span
                      className="block min-w-0 max-w-full overflow-hidden font-medium"
                      style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {g.name}
                    </span>
                    {isCurrent ? (
                      <span className="w-20 shrink-0 text-right text-[10px] uppercase text-foreground">atual</span>
                    ) : already ? (
                      <span className="w-20 shrink-0 text-right text-[10px] uppercase text-success">Já adicionado</span>
                    ) : (
                      <span className="w-20 shrink-0 text-right text-[10px] uppercase text-muted-foreground">
                        {g.isChannel ? "canal" : "grupo"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
          </AnimatePresence>
          </div>
          ) : (
          <div className="space-y-3 animate-in fade-in duration-300">
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-1 overflow-hidden rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground text-xs">Grupo:</span>
              <span className="block min-w-0 truncate font-medium">{resolved?.name}</span>
            </div>
            <div>
              <Label className="text-sm">
                Rascunho {resolved?.draft && <span className="text-success">· carregado</span>}
              </Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="Digite o rascunho a enviar quando o grupo abrir..."
              />
            </div>
          </div>
          )}

          {error && (
            <div className="mt-4 space-y-2">
              <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger font-mono">
                {error}
              </p>
              {picking && (
                <Button variant="outline" size="sm" onClick={retryList} disabled={loading} className="w-full">
                  {loading ? "Tentando…" : "Tentar novamente"}
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-background px-4 py-4 sm:px-6">
          {!picking && (
            <Button onClick={save} disabled={!message.trim()}>
              Adicionar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
