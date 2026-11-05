import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Editando rascunho</DialogTitle>
        </DialogHeader>
        {group && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  className="size-10 shrink-0 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50">
                  <TgAvatar name={group.name} single className="shrink-0" />
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
            </div>
            <div>
              <Label className="text-sm">Rascunho</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                autoFocus={false}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={save} disabled={!message.trim()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}