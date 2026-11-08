import { appAuth } from "@/lib/appAuth";
import { clientData, clientsStore, storage, type ClientRecord, type TgCreds } from "@/lib/storage";
import { pushCreds } from "@/lib/cloudSync";

export type ClientEditDraft = {
  title: string;
  phone: string;
  apiHash: string;
  apiId: string;
};

export type ClientEditSnapshot = {
  ownerId: string;
  record: ClientRecord;
  credentialsLocked: boolean;
  draft: ClientEditDraft;
};

export function readClientEdit(clientId: string): ClientEditSnapshot | null {
  const ownerId = appAuth.currentUserId();
  const record = ownerId ? clientsStore.get(clientId) : null;
  if (!ownerId || !record) return null;
  const creds = clientData.getCreds(clientId);
  return {
    ownerId,
    record,
    credentialsLocked: record.hasSession || clientData.getSession(clientId).length > 4,
    draft: {
      title: record.title,
      phone: record.phone ?? "",
      apiHash: creds?.apiHash ?? "",
      apiId: creds ? String(creds.apiId) : "",
    },
  };
}

export function saveClientEdit(
  clientId: string,
  ownerId: string | null,
  draft: ClientEditDraft,
): { client: ClientRecord } | { error: string } {
  if (!ownerId || appAuth.currentUserId() !== ownerId) {
    return { error: "Sua sessão mudou. Abra a cliente novamente para editar." };
  }
  const current = readClientEdit(clientId);
  if (!current || current.ownerId !== ownerId) {
    return { error: "Esta cliente não está disponível para edição." };
  }
  const title = draft.title.trim();
  if (!title) return { error: "Informe o nome da cliente." };
  const phone = draft.phone.trim().replace(/[\s().-]/g, "");
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return { error: "Informe o número com DDI, por exemplo: +55 11 99999-9999." };
  }

  const apiId = draft.apiId.trim();
  const apiHash = draft.apiHash.trim().toLowerCase();
  const credentialsChanged =
    apiId !== current.draft.apiId || apiHash !== current.draft.apiHash.trim().toLowerCase();
  let newCreds: TgCreds | null = null;
  if (credentialsChanged) {
    if (current.credentialsLocked) {
      return { error: "As credenciais da sessão salva são somente para consulta." };
    }
    if (!apiId || !apiHash) return { error: "Preencha API Hash e API ID juntos." };
    const numericId = Number(apiId);
    if (
      !/^\d+$/.test(apiId) ||
      !Number.isSafeInteger(numericId) ||
      numericId < 1 ||
      numericId > 2_147_483_647
    ) {
      return { error: "Informe um API ID numérico válido." };
    }
    if (!/^[a-f0-9]{32}$/.test(apiHash)) {
      return { error: "O API Hash deve ter 32 caracteres, usando números e letras de A a F." };
    }
    newCreds = { apiId: numericId, apiHash };
  }
  if (appAuth.currentUserId() !== ownerId) {
    return { error: "Sua sessão mudou. Abra a cliente novamente para editar." };
  }

  // Neither operation switches activeClient or touches saved Telegram authorizations.
  if (newCreds) {
    storage._setCredsLocalFor(clientId, newCreds);
    pushCreds(ownerId, clientId, newCreds);
  }
  clientsStore.update(clientId, { title, phone: phone || null });
  const client = clientsStore.get(clientId) ?? { ...current.record, title, phone: phone || null };
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cloud:changed"));
  return { client };
}
