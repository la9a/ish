import { useEffect, useId, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { appAuth } from "@/lib/appAuth";
import type { ClientRecord } from "@/lib/storage";
import { readClientEdit, saveClientEdit, type ClientEditDraft } from "@/lib/clientEdit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const blankDraft: ClientEditDraft = { title: "", phone: "", apiHash: "", apiId: "" };

export function ClientEditForm({
  clientId,
  onSaved,
  onCancel,
}: {
  clientId: string;
  onSaved?: (client: ClientRecord) => void;
  onCancel?: () => void;
}) {
  const inputId = useId();
  const [ownerAtOpen] = useState(() => appAuth.currentUserId());
  const [snapshot, setSnapshot] = useState(() => readClientEdit(clientId));
  const [draft, setDraft] = useState<ClientEditDraft>(() => snapshot?.draft ?? blankDraft);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const touched = useRef(new Set<keyof ClientEditDraft>());
  const owner = appAuth.currentUserId();

  useEffect(() => {
    function refresh() {
      if (!ownerAtOpen || appAuth.currentUserId() !== ownerAtOpen) {
        setSnapshot(null);
        setDraft(blankDraft);
        onCancel?.();
        return;
      }
      const next = readClientEdit(clientId);
      setSnapshot(next);
      if (!next) return;
      setDraft((existing) => ({
        title: touched.current.has("title") ? existing.title : next.draft.title,
        phone: touched.current.has("phone") ? existing.phone : next.draft.phone,
        apiHash: touched.current.has("apiHash") ? existing.apiHash : next.draft.apiHash,
        apiId: touched.current.has("apiId") ? existing.apiId : next.draft.apiId,
      }));
    }
    refresh();
    window.addEventListener("cloud:changed", refresh);
    window.addEventListener("storage", refresh);
    const unsubscribe = appAuth.subscribe(refresh);
    return () => {
      window.removeEventListener("cloud:changed", refresh);
      window.removeEventListener("storage", refresh);
      unsubscribe();
    };
  }, [clientId, ownerAtOpen, onCancel]);

  function change(field: keyof ClientEditDraft, value: string) {
    touched.current.add(field);
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
    setSaved(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const result = saveClientEdit(clientId, ownerAtOpen, draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    touched.current.clear();
    setSaved(true);
    onSaved?.(result.client);
  }

  if (!ownerAtOpen || owner !== ownerAtOpen || !snapshot || snapshot.record.id !== clientId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Esta cliente não está disponível para edição.
      </p>
    );
  }
  const numberChanged = draft.phone.replace(/\D/g, "") !== snapshot.draft.phone.replace(/\D/g, "");

  return (
    <form onSubmit={save} className="min-w-0 space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${inputId}-name`}>Nome</Label>
        <Input
          id={`${inputId}-name`}
          value={draft.title}
          onChange={(event) => change("title", event.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${inputId}-phone`}>Número</Label>
        <Input
          id={`${inputId}-phone`}
          type="tel"
          value={draft.phone}
          onChange={(event) => change("phone", event.target.value)}
          placeholder="+55 11 99999-9999"
          autoComplete="off"
          aria-describedby={numberChanged ? `${inputId}-phone-help` : undefined}
        />
        {numberChanged && (
          <p id={`${inputId}-phone-help`} className="text-[11px] leading-5 text-muted-foreground">
            Para conectar outra conta, use Reconectar.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${inputId}-hash`}>API Hash</Label>
        <Input
          id={`${inputId}-hash`}
          value={draft.apiHash}
          onChange={(event) => change("apiHash", event.target.value)}
          readOnly={snapshot.credentialsLocked}
          placeholder="Não informado"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          aria-describedby={snapshot.credentialsLocked ? `${inputId}-credentials-help` : undefined}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${inputId}-api-id`}>API ID</Label>
        <Input
          id={`${inputId}-api-id`}
          value={draft.apiId}
          onChange={(event) => change("apiId", event.target.value)}
          readOnly={snapshot.credentialsLocked}
          placeholder="Não informado"
          inputMode="numeric"
          autoComplete="off"
          className="font-mono text-xs"
          aria-describedby={snapshot.credentialsLocked ? `${inputId}-credentials-help` : undefined}
        />
      </div>
      {snapshot.credentialsLocked && (
        <p
          id={`${inputId}-credentials-help`}
          className="text-[11px] leading-5 text-muted-foreground"
        >
          As credenciais desta sessão são exibidas para consulta.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-success">
          Dados atualizados.
        </p>
      )}
      <div className={`grid gap-3 pt-2 ${onCancel ? "grid-cols-2" : "grid-cols-1"}`}>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="gap-2">
          <Check className="size-4" aria-hidden />
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

export function ClientEditDialog({
  client,
  onClose,
  onSaved,
}: {
  client: ClientRecord | null;
  onClose: () => void;
  onSaved: (client: ClientRecord) => void;
}) {
  return (
    <Dialog
      open={Boolean(client)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto rounded-2xl bg-card p-5 sm:p-7">
        <DialogHeader className="space-y-2 text-left">
          <span className="mb-1 grid size-10 place-items-center rounded-xl border border-border bg-background">
            <Pencil className="size-4" aria-hidden />
          </span>
          <DialogTitle className="text-xl font-medium">Editar cliente</DialogTitle>
          <DialogDescription>Atualize os dados do cadastro.</DialogDescription>
        </DialogHeader>
        {client && (
          <ClientEditForm
            key={client.id}
            clientId={client.id}
            onCancel={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
