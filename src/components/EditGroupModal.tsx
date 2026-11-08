import { BannerArtwork } from "@/components/BannerArtwork";
import { Check, Hash, Send } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadGroupPhotoById } from "@/lib/telegram";
import { storage, clientData, type MonitoredGroup } from "@/lib/storage";
import { TgAvatar } from "@/components/TgAvatar";

interface Props {
  group: MonitoredGroup | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  /** No Painel Multi, salva o grupo diretamente neste cliente. */
  clientId?: string;
}

/** Modal compartilhado de edição de rascunho dos painéis Único e Multi. */
export function EditGroupModal({ group, onOpenChange, onSaved, clientId }: Props) {
  const messageId = useId();
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    setMessage(group.message);
    if (group.photoUrl) {
      setPhoto(group.photoUrl);
      return;
    }
    let active = true;
    loadGroupPhotoById(group.id, clientId)
      .then((url) => {
        if (active) setPhoto(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [group, clientId]);
  function save() {
    if (!group || !message.trim()) return;
    const next = { ...group, message: message.trim() };
    if (clientId) clientData.upsertGroup(clientId, next);
    else storage.upsertGroup(next);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="sb-illustrated-header">
          <div className="sb-illustrated-copy">
            <span className="inline-flex items-center gap-2 rounded-md border border-black/20 bg-white/20 px-2 py-1 text-[9px] uppercase tracking-[.14em] text-black/70">
              <span className="text-black">02</span>Mensagem
              <span className="text-border">/</span>Grupo cadastrado
            </span>
            <DialogTitle className="mt-4 text-2xl font-medium tracking-tight">
              Editar rascunho
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs text-black/70">
              Atualize a mensagem preparada para este grupo.
            </DialogDescription>
          </div>
          <BannerArtwork image="/art/cat-edit-draft.svg" className="sb-header-art" />
        </DialogHeader>
        {group && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  className="size-10 shrink-0 rounded-xl border border-border object-cover"
                />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background">
                  <TgAvatar name={group.name} single className="shrink-0" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                  <Hash className="size-3" aria-hidden />
                  Destino
                </p>
                <p className="mt-1 truncate text-sm font-medium">{group.name}</p>
              </div>
              <span className="rounded-md border border-border px-2 py-1 text-[9px] text-muted-foreground">
                {group.active ? "Grupo ativo" : "Grupo inativo"}
              </span>
            </div>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div>
                <Label htmlFor={messageId} className="mb-2 block text-xs">
                  Rascunho da cliente
                </Label>
                <Textarea
                  id={messageId}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={8}
                  autoFocus={false}
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
                  Revise o texto antes de salvar. O destino permanece o mesmo.
                </p>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="shrink-0 gap-3 border-t border-border bg-card px-5 py-4 sm:justify-between sm:px-7">
          <span className="mr-auto hidden self-center text-[10px] text-muted-foreground sm:block">
            As alterações valem para os próximos envios.
          </span>
          <div className="flex w-full justify-end gap-2 sm:w-auto">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={!message.trim()}>
              <Check className="size-4" aria-hidden />
              Salvar rascunho
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
