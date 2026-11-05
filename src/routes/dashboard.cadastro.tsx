import { AdminLayout } from "./admin";
import { createFileRoute, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { activeClient, clientsStore, clientData, storage, wizardDraft } from "@/lib/storage";
import { sendCode, signIn, resendCode, resetPooledClient } from "@/lib/telegram";
import { mtSendPassword, mtLogin, mtEnsureApp } from "@/lib/myTelegram.functions";
import {
  ArrowLeft,
  Check,
  ChevronsUpDown,
  Loader2,
  Lock,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const AUTOMATION_TIMEOUT_MS = 35_000;

async function withUiTimeout<T>(
  promise: Promise<T>,
  message: string,
  ms = AUTOMATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  COUNTRIES,
  findCountryByDial,
  findCountryByExactDial,
  formatByMask,
  formatDisplayPhone,
  placeholderFor,
} from "@/lib/countries";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AccessNotification } from "@/components/AccessNotification";
import { RegistrationStatus } from "@/components/RegistrationStatus";
import { PageBanner } from "@/components/PageBanner";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// Include outgoing/incoming 300ms fades, then display for one full second.
async function withStatusMinimum<T>(request: Promise<T>): Promise<T> {
  const minimum = pause(1600);
  try {
    return await request;
  } finally {
    await minimum;
  }
}

// mtCode: código recebido pela automação do my.telegram.org (login web)
// creds:  fallback manual — usuário cola API ID/Hash quando a automação falha
// code:   código final do MTProto (signIn)
type Step = "title" | "mtCode" | "creds" | "code";

// A pending Telegram login belongs to one client id. A restored draft may
// reuse it only when its locally stored credentials match the same account.
function recoverWizardClientId(
  draft: { clientId?: string; apiId: string; apiHash: string },
  readCreds: typeof clientData.getCreds,
): string | null {
  // API credentials identify an app and may be shared by multiple Telegram
  // accounts. An arbitrary active selection cannot identify a pending login.
  const candidateId = draft.clientId;
  if (!candidateId || !draft.apiId.trim() || !draft.apiHash.trim()) return null;
  try {
    const creds = readCreds(candidateId);
    return creds &&
      String(creds.apiId) === draft.apiId.trim() &&
      creds.apiHash.trim().toLowerCase() === draft.apiHash.trim().toLowerCase()
      ? candidateId
      : null;
  } catch {
    return null;
  }
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function fnv1a64(input: string, seed: bigint): bigint {
  const MASK = 0xffffffffffffffffn;
  const PRIME = 0x100000001b3n;
  let h = seed;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * PRIME) & MASK;
  }
  return h;
}

function toBase62(n: bigint, len: number): string {
  let v = n;
  let s = "";
  for (let i = 0; i < len; i++) {
    s = ID_ALPHABET[Number(v % 62n)] + s;
    v = v / 62n;
  }
  return s;
}

/**
 * Gera um ID único de cliente no formato `c_XXXXXXXXXXXXXXXX` (18 chars no total)
 * misturando telefone + API ID + API Hash + nonce, em base62.
 */
function makeClientId(phone: string, apiId: string, apiHash: string): string {
  const nonce = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.${
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint32Array(2)))
          .map((n) => n.toString(36))
          .join(".")
      : Math.random().toString(36).slice(2)
  }`;
  const seed = `${phone}|${apiId}|${apiHash}|${nonce}`;
  const h1 = fnv1a64(seed, 0xcbf29ce484222325n);
  const rev = seed.split("").reverse().join("");
  const h2 = fnv1a64(rev, 0x84222325cbf29ce4n);
  return "c_" + toBase62(h1, 8) + toBase62(h2, 8);
}

export const Route = createFileRoute("/dashboard/cadastro")({
  validateSearch: (s: Record<string, unknown>): { id?: string; edit?: "1" } => ({
    id: typeof s.id === "string" ? s.id : undefined,
    edit: s.edit === "1" || s.edit === 1 ? "1" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Cadastro | Senha Baixa" },
      { name: "description", content: "Cadastre e conecte uma conta ao painel Senha Baixa." },
      { property: "og:title", content: "Cadastro | Senha Baixa" },
      {
        property: "og:description",
        content: "Cadastre e conecte uma conta ao painel Senha Baixa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Cadastro | Senha Baixa" },
      {
        name: "twitter:description",
        content: "Cadastre e conecte uma conta ao painel Senha Baixa.",
      },
    ],
  }),
  component: () => <AdminLayout content={<NewClientWizard />} />,
});

function NewClientWizard() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/dashboard/cadastro" });
  const editingId = search.id;
  const isEditMode = search.edit === "1" && !!editingId;
  const leavingRef = useRef(false);
  const backTo = editingId ? "/admin/connection" : "/dashboard";

  useEffect(() => {
    void router.preloadRoute({ to: backTo }).catch(() => {});
  }, [router, backTo]);

  const [step, setStep] = useState<Step>("title");
  const [draftReady, setDraftReady] = useState(false);
  const draftRestoredRef = useRef(false);
  const [flowModal, setFlowModal] = useState<"confirm" | "sending" | "failure" | null>(null);
  const lastFlowModal = useRef<"confirm" | "sending" | "failure">("confirm");
  if (flowModal) lastFlowModal.current = flowModal;
  const displayedModal = flowModal ?? lastFlowModal.current;
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [invalidNotice, setInvalidNotice] = useState(false);
  const [confirmedPhone, setConfirmedPhone] = useState("");
  const reducedMotion = useReducedMotion();
  const fade = { duration: reducedMotion ? 0 : 0.3 };
  const countryGesture = useRef({ x: 0, y: 0, dragged: false });
  const pendingRef = useRef(false);
  const failureStep = useRef<Step>("title");

  function showInvalidCode() {
    setInvalidNotice(true);
    setError(null);
  }
  useEffect(() => {
    if (!invalidNotice) return;
    const timer = setTimeout(() => setInvalidNotice(false), 5000);
    return () => clearTimeout(timer);
  }, [invalidNotice]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [schedRas, setSchedRas] = useState("");
  const [schedFim, setSchedFim] = useState("");
  const [schedEnv, setSchedEnv] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [frequency, setFrequency] = useState<"semanal" | "quinzenal" | "mensal">("semanal");
  const [biweeklyAnchor, setBiweeklyAnchor] = useState<number | null>(null);
  const [monthlyDays, setMonthlyDays] = useState<number[]>([]);
  const [hasPreferred, setHasPreferred] = useState(false);
  const [preferredGroup, setPreferredGroup] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [ddi, setDdi] = useState("+55");
  const [phone, setPhone] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [need2fa, setNeed2fa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [credsInfo, setCredsInfo] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [codeSentAt, setCodeSentAt] = useState<number>(0);
  const [reconnectMode, setReconnectMode] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const autoSentRef = useState<{ done: boolean }>({ done: false })[0];

  // Automação my.telegram.org
  const callMtSendPassword = useServerFn(mtSendPassword);
  const callMtLogin = useServerFn(mtLogin);
  const callMtEnsureApp = useServerFn(mtEnsureApp);
  const [mtCode, setMtCode] = useState("");
  const [randomHash, setRandomHash] = useState("");
  const [mtSession, setMtSession] = useState<string | null>(null);

  // Diálogo de confirmação de cliente duplicado (telefone ou API ID/Hash já
  // cadastrados em outro cliente). O usuário pode continuar mesmo assim.
  const [dupOpen, setDupOpen] = useState(false);
  const [dupMessage, setDupMessage] = useState<string>("");
  const [dupProceed, setDupProceed] = useState<null | (() => void)>(null);

  // Se veio com um id existente, pré-popula
  useEffect(() => {
    if (!editingId) return;
    const rec = clientsStore.get(editingId);
    if (!rec) return;
    setClientId(rec.id);
    setTitle(rec.title);
    setSchedRas(rec.scheduleRas ?? "");
    setSchedFim(rec.scheduleFim ?? "");
    setSchedEnv(rec.scheduleEnv ?? "");
    setWeekdays(rec.weekdays ?? []);
    setFrequency(
      rec.frequency === "quinzenal"
        ? "quinzenal"
        : rec.frequency === "mensal"
          ? "mensal"
          : "semanal",
    );
    setBiweeklyAnchor(rec.biweeklyAnchor ?? null);
    setMonthlyDays(rec.monthlyDays ?? []);
    setHasPreferred(!!rec.preferredGroup);
    setPreferredGroup(rec.preferredGroup ?? "");
    activeClient.set(rec.id);
    try {
      const creds = storage.getCreds();
      if (creds) {
        setApiId(String(creds.apiId));
        setApiHash(creds.apiHash);
        // Reconexão: cliente já existe, com creds + telefone — pula direto
        // pro envio de código sem pedir nada.
        if (!isEditMode && rec.phone) {
          setReconnectMode(true);
          // Vai direto pro passo "code" — o sendCode roda em segundo plano.
          // Se falhar, caímos pra "title" pro usuário corrigir o número.
          setStep("code");
        } else {
          setStep(isEditMode ? "title" : "creds");
        }
      } else {
        setStep("creds");
      }
      if (rec.phone) {
        // Mantém o DDI correto (qualquer prefixo +1..+9999), em vez de
        // assumir +55, para que o sendCode use o número exato cadastrado.
        const m = rec.phone.match(/^(\+\d{1,4})(\d+)$/);
        if (m) {
          setDdi(m[1]);
          setPhone(formatPhoneInput(m[2], m[1]));
        } else {
          setPhone(formatPhoneInput(rec.phone.replace(/^\+/, ""), ddi));
        }
      }
    } catch {
      setStep("creds");
    }
  }, [editingId, isEditMode]);

  // Reconexão: dispara sendCode automaticamente uma única vez assim que o
  // wizard tem telefone + credenciais carregados. Em caso de falha, volta
  // pro passo "phone" pra o usuário confirmar/ajustar o número e tentar de
  // novo manualmente (clicando "Enviar código"), garantindo que o número
  // fica salvo na conta antes do envio.
  useEffect(() => {
    if (!reconnectMode || autoSentRef.done) return;
    if (!phone || !apiId || !apiHash) return;
    autoSentRef.done = true;
    void (async () => {
      setError(null);
      setLoading(true);
      try {
        const fullPhone = buildFullPhone();
        // Garante que o telefone usado pro envio fica persistido no cliente.
        const id = ensureClientId();
        clientsStore.update(id, { phone: fullPhone });
        const { phoneCodeHash } = await withUiTimeout(
          sendCode(fullPhone),
          "O envio do código demorou demais. Tente de novo em alguns segundos.",
        );
        setPhoneCodeHash(phoneCodeHash);
        setCodeSentAt(Date.now());
        setStep("code");
        setInfo(
          "O código foi enviado com sucesso para o Telegram do usuário. Por favor, verifique o aplicativo e insira o código para prosseguir.",
        );
        setResendCooldown(60);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        setError(`Falha ao enviar código: ${msg}. Confira o número e clique em "Enviar código".`);
        // Volta pra etapa inicial pro usuário corrigir e reenviar.
        setStep("title");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectMode, phone, apiId, apiHash]);

  // Restore once before allowing writes. In StrictMode the initial effects
  // replay with their initial render's values; writing then would replace a
  // saved draft with the empty first step before it can be restored.
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    if (editingId) {
      setDraftReady(true);
      return;
    }
    const d = wizardDraft.get();
    if (!d) {
      setDraftReady(true);
      return;
    }
    // Rascunho antigo pode ter "phone" salvo — tratar como "title" no fluxo novo.
    // Se o rascunho está em "mtCode" mas perdemos a mtSession (recarregou a
    // página), a única saída segura é voltar pra "title" e reiniciar o envio.
    const rawStep = d.step as string;
    const recoveredId = rawStep === "code" ? recoverWizardClientId(d, clientData.getCreds) : null;
    if (recoveredId) {
      setClientId(recoveredId);
      activeClient.set(recoveredId);
    }
    if (rawStep === "code" && !recoveredId) {
      setStep("creds");
      setCredsInfo(
        "A conexão anterior não pôde ser retomada. Confira as credenciais e solicite um novo código para continuar.",
      );
    } else if (rawStep === "phone") setStep("title");
    else if (rawStep === "mtCode") {
      // A sessão mt expira ao recarregar — cai no fallback manual em vez
      // de voltar pra primeira etapa, preservando o progresso do usuário.
      setStep("creds");
      setCredsInfo(
        "Não foi possível realizar a coleta automática do API ID e do API Hash. Por favor, forneça-os manualmente para prosseguir.",
      );
    } else setStep(rawStep as Step);
    setTitle(d.title);
    setSchedRas(d.schedRas);
    setSchedFim(d.schedFim);
    setSchedEnv(d.schedEnv);
    if (d.weekdays) setWeekdays(d.weekdays);
    setApiId(d.apiId);
    setApiHash(d.apiHash);
    setDdi(d.ddi || "+55");
    setPhone(d.phone);
    setPhoneCodeHash(d.phoneCodeHash);
    if (d.credsInfo && !(rawStep === "code" && !recoveredId)) setCredsInfo(d.credsInfo);
    if (d.codeSentAt) setCodeSentAt(d.codeSentAt);
    // Ao recarregar na etapa "code", o phoneCodeHash restaurado não bate
    // mais com o pool mtcute recém-criado, e o Telegram devolve
    // PHONE_CODE_EXPIRED. Se ainda estamos dentro dos 2 minutos desde o
    // envio, disparamos um resendCode silencioso pra revalidar o hash sem
    // mostrar erro ao usuário.
    if (
      rawStep === "code" &&
      recoveredId &&
      d.phoneCodeHash &&
      d.codeSentAt &&
      Date.now() - d.codeSentAt < 120_000
    ) {
      void (async () => {
        try {
          const country = COUNTRIES.find((c) => c.dial === (d.ddi || "+55")) ?? COUNTRIES[0];
          const digits = (d.phone || "").replace(/\D/g, "");
          const fullPhone = `${country.dial}${digits}`;
          const { phoneCodeHash: nh } = await resendCode(fullPhone, d.phoneCodeHash);
          setPhoneCodeHash(nh);
          setCodeSentAt(Date.now());
        } catch {
          // Silencioso: se falhar, a mensagem apropriada aparece só ao submeter.
        }
      })();
    }
    setDraftReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva rascunho a cada alteração relevante (apenas no modo de criação)
  useEffect(() => {
    if (!draftReady || editingId || leavingRef.current) return;
    wizardDraft.set({
      clientId: clientId ?? undefined,
      step,
      title,
      schedRas,
      schedFim,
      schedEnv,
      weekdays,
      apiId,
      apiHash,
      ddi,
      phone,
      phoneCodeHash,
      credsInfo: credsInfo ?? undefined,
      codeSentAt: codeSentAt || undefined,
      savedAt: Date.now(),
    });
  }, [
    draftReady,
    editingId,
    clientId,
    step,
    title,
    schedRas,
    schedFim,
    schedEnv,
    weekdays,
    apiId,
    apiHash,
    ddi,
    phone,
    phoneCodeHash,
    credsInfo,
    codeSentAt,
  ]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function buildFullPhone(): string {
    const raw = phone.trim();
    if (raw.startsWith("+")) return "+" + raw.slice(1).replace(/\D/g, "");
    let local = raw.replace(/\D/g, "").replace(/^0+/, "");
    const d = ddi.replace(/\D/g, "");
    if (d && local.startsWith(d)) local = local.slice(d.length);
    return `+${d}${local}`;
  }

  // Normaliza e formata o número conforme o usuário digita/cola.
  // Para DDI +55, aplica o formato brasileiro "DD NNNNNNNNN" (DDD + 8/9 dígitos),
  // removendo espaços, traços, parênteses, zero à esquerda do DDD e um eventual
  // prefixo "55" quando o usuário cola o número já com código do país.
  function formatPhoneInput(input: string, ddiVal: string): string {
    const country = findCountryByExactDial(ddiVal);
    let digits = input.replace(/\D/g, "").replace(/^0+/, "");
    if (country) {
      // Se colou já com o DDI (ex.: "5512..."), remove.
      if (digits.startsWith(country.dial) && digits.length > country.total) {
        digits = digits.slice(country.dial.length);
      }
      return formatByMask(digits, country.mask);
    }
    return digits;
  }

  function ensureClientId(): string {
    if (clientId) return clientId;
    // Em criação normal já temos creds preenchidas; o telefone pode estar vazio
    // (antes do passo "phone") — nesse caso usamos a string vazia, o hash final
    // mistura mesmo assim API ID + API Hash + nonce aleatório, garantindo unicidade.
    const phoneForId = (() => {
      try {
        return buildFullPhone();
      } catch {
        return "";
      }
    })();
    const id = makeClientId(phoneForId, apiId.trim(), apiHash.trim().toLowerCase());
    setClientId(id);
    activeClient.set(id);
    return id;
  }

  function resetNewClientWizard() {
    // The route is leaving: avoid rendering/resetting every field and saving
    // a fresh draft while navigation waits for the authenticated destination.
    leavingRef.current = true;
    wizardDraft.clear();
    if (!editingId && clientId) {
      const rec = clientsStore.get(clientId);
      if (rec && !rec.hasSession) {
        clientsStore.remove(clientId);
        clientsStore.wipeClientData(clientId);
      }
      resetPooledClient(clientId);
    }
    if (!editingId) activeClient.set(null);
  }

  // Compara telefone normalizado contra clientes existentes (exceto o atual em edição).
  function findDuplicateByPhone(fullPhone: string) {
    const target = fullPhone.replace(/\D/g, "");
    if (!target) return null;
    return clientsStore
      .list()
      .find(
        (c) =>
          c.id !== editingId && c.id !== clientId && (c.phone ?? "").replace(/\D/g, "") === target,
      );
  }

  // Compara API ID + API Hash contra clientes existentes.
  function findDuplicateByCreds(rawApiId: string, rawApiHash: string) {
    const id = rawApiId.trim();
    const hash = rawApiHash.trim().toLowerCase();
    if (!id || !hash) return null;
    return clientsStore.list().find((c) => {
      if (c.id === editingId || c.id === clientId) return false;
      const creds = clientData.getCreds(c.id);
      if (!creds) return false;
      return String(creds.apiId) === id && String(creds.apiHash).toLowerCase() === hash;
    });
  }

  function askDuplicate(message: string) {
    setDupMessage(message);
    setDupOpen(true);
  }

  // Detecta gênero pelo primeiro nome (heurística pt-BR): termina em "a"
  // geralmente é feminino, com algumas exceções masculinas comuns.
  function clienteArtigo(fullName: string): "O cliente" | "A cliente" {
    const first = (fullName || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!first) return "O cliente";
    const exMasc = new Set([
      "luca",
      "costa",
      "iuri",
      "ancelotti",
      "dida",
      "vagoda",
      "silva",
      "noa",
      "ezra",
      "elia",
      "issa",
      "iassua",
      "josua",
      "aca",
      "urias",
    ]);
    const exFem = new Set(["carmen", "miriam", "raquel", "isis", "cristal", "beatriz"]);
    if (exFem.has(first)) return "A cliente";
    if (exMasc.has(first)) return "O cliente";
    return /a$/.test(first) ? "A cliente" : "O cliente";
  }

  async function submitTitle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!title.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    let fullPhone: string;
    try {
      fullPhone = buildFullPhone();
      if (fullPhone.replace(/\D/g, "").length < 8) {
        setError("Número inválido. Digite o telefone com DDD.");
        return;
      }
    } catch {
      setError("Número inválido. Digite o telefone com DDD.");
      return;
    }
    const dup = findDuplicateByPhone(fullPhone);
    if (dup) {
      askDuplicate(
        `${clienteArtigo(dup.title)} "${dup.title}" já usa esse telefone (${fullPhone}). Não é possível cadastrar o mesmo número duas vezes.`,
      );
      return;
    }
    setConfirmedPhone(fullPhone);
    setFlowModal("confirm");
  }

  // Tenta a automação do my.telegram.org (send_password → login → apps).
  // Sucesso: avança pro passo "mtCode" pra o usuário digitar o código que
  // chegou no Telegram dele. Falha: cai no fallback manual "creds" com aviso.
  function showCollectionFailure(previous: Step) {
    failureStep.current = previous;
    setError(null);
    setFlowModal("failure");
  }

  async function tryAutomation(fullPhone: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLoading(true);
    setBusyStatus("Enviando código");
    setFlowModal("sending");
    setError(null);
    setInfo(null);
    try {
      const res = await withStatusMinimum(
        withUiTimeout(
          callMtSendPassword({ data: { phone: fullPhone } }),
          "O Telegram demorou para iniciar a coleta automática.",
        ),
      );
      if (leavingRef.current) return;
      if ("error" in res) {
        showCollectionFailure("title");
        return;
      }
      setRandomHash(res.randomHash);
      setMtSession(null);
      setMtCode("");
      setResendCooldown(60);
      setStep("mtCode");
      // Prepare and fade in the next form behind the fading dialog.
      await pause(300);
      setFlowModal(null);
    } catch {
      if (!leavingRef.current) showCollectionFailure("title");
    } finally {
      pendingRef.current = false;
      setBusyStatus(null);
      setLoading(false);
    }
  }

  async function submitMtCode(e: React.FormEvent) {
    e.preventDefault();
    if (pendingRef.current) return;
    setError(null);
    setInfo(null);
    setInvalidNotice(false);
    const codeTrim = mtCode.trim();
    if (!codeTrim) {
      setError("Digite o código recebido no Telegram.");
      return;
    }
    pendingRef.current = true;
    setLoading(true);
    setBusyStatus("Coletando credenciais");
    setFlowModal("sending");
    try {
      const app = await withStatusMinimum(
        (async () => {
          let session = mtSession;
          if (!session) {
            const login = await withUiTimeout(
              callMtLogin({ data: { phone: buildFullPhone(), randomHash, password: codeTrim } }),
              "O Telegram demorou para validar o código.",
            );
            if ("error" in login)
              throw new Error(
                login.error === "invalid_code" ? "INVALID_CODE" : "COLLECTION_FAILED",
              );
            session = login.mtSession;
            setMtSession(session);
          }
          const app = await withUiTimeout(
            callMtEnsureApp({
              data: { mtSession: session, clientTitle: title.trim() || "cliente" },
            }),
            "O Telegram demorou para criar ou ler o aplicativo.",
            90_000,
          );
          if ("error" in app) {
            if (app.error === "session_expired") setMtSession(null);
            throw new Error("COLLECTION_FAILED");
          }
          return app;
        })(),
      );
      if (leavingRef.current) return;
      setBusyStatus("Enviando código");
      // Wait for the outgoing status to fade before starting the minimum display interval.
      await pause(300);
      await withStatusMinimum(finishCredsAndSendCode(app.apiId, app.apiHash));
      setFlowModal(null);
    } catch (e: unknown) {
      if (leavingRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "INVALID_CODE" || msg.includes("PHONE_CODE_INVALID")) showInvalidCode();
      else showCollectionFailure("mtCode");
    } finally {
      setBusyStatus(null);
      pendingRef.current = false;
      setLoading(false);
    }
  }

  // Executa o resto do cadastro (cria/atualiza cliente, salva creds e chama
  // sendCode do MTProto). Extraído porque é reusado pelo fluxo automático
  // (após mtEnsureApp) e pelo fallback manual (submitCreds).
  async function finishCredsAndSendCode(rawApiId: string, rawApiHash: string) {
    const fullPhone = buildFullPhone();
    if (fullPhone.replace(/\D/g, "").length < 8) {
      throw new Error("Número inválido. Digite o telefone com DDD.");
    }
    setApiId(rawApiId);
    setApiHash(rawApiHash);
    // ensureClientId usa apiId/apiHash do state; como setState é assíncrono
    // e queremos usar já os valores novos aqui, montamos o id local.
    const id =
      clientId ?? makeClientId(fullPhone, rawApiId.trim(), rawApiHash.trim().toLowerCase());
    if (!clientId) setClientId(id);
    // Sempre reafirma o cliente ativo antes de gravar creds/chamar sendCode,
    // pra garantir que storage.setCreds e o pool do mtcute usem o escopo certo.
    activeClient.set(id);
    // Não persistimos o cliente no clientsStore ainda — só após o signIn na
    // etapa final. Assim, se o usuário abandonar o cadastro no meio (mtCode
    // ou code), ele NÃO aparece no dashboard como "reconectar".
    // Reconexão (cliente já existente) é a única exceção: só atualiza dados.
    if (clientsStore.get(id)) {
      clientsStore.update(id, {
        phone: fullPhone,
        title: title.trim() || clientsStore.get(id)?.title || "Cliente sem nome",
        scheduleRas: schedRas.trim() || null,
        scheduleFim: schedFim.trim() || null,
        scheduleEnv: schedEnv.trim() || null,
        weekdays: weekdays.length ? [...weekdays].sort() : null,
        frequency,
        biweeklyAnchor: frequency === "quinzenal" ? biweeklyAnchor : null,
        monthlyDays:
          frequency === "mensal" && monthlyDays.length
            ? [...monthlyDays].sort((a, b) => a - b)
            : null,
        preferredGroup: hasPreferred ? preferredGroup.trim() || null : null,
      });
    }
    storage.setCreds({ apiId: Number(rawApiId.trim()), apiHash: rawApiHash.trim().toLowerCase() });
    // Invalida qualquer client mtcute cacheado com creds antigas antes de
    // tentar o sendCode — evita reutilizar um client construído no fluxo
    // anterior com apiId/apiHash diferentes.
    resetPooledClient(id);
    const { phoneCodeHash: h } = await withUiTimeout(
      sendCode(fullPhone),
      "O envio do código demorou demais. Tente de novo em alguns segundos.",
    );
    setPhoneCodeHash(h);
    setCodeSentAt(Date.now());
    setStep("code");
    setInfo(
      "Um código foi enviado no Telegram do cliente. Ele é usado para confirmar o uso da conta.",
    );
    setResendCooldown(60);
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    const idRaw = apiId.trim();
    const hashRaw = apiHash.trim().toLowerCase();
    if (!/^\d{5,12}$/.test(idRaw)) {
      setError(
        "API ID inválido. Deve conter apenas números (5–12 dígitos), como aparece em my.telegram.org/apps.",
      );
      return;
    }
    if (!/^[a-f0-9]{32}$/.test(hashRaw)) {
      setError("API Hash inválido. Deve ter exatamente 32 caracteres hexadecimais (0–9, a–f).");
      return;
    }
    const runSend = async () => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setLoading(true);
      setError(null);
      setBusyStatus("Enviando código");
      setFlowModal("sending");
      try {
        await withStatusMinimum(finishCredsAndSendCode(idRaw, hashRaw));
        setFlowModal(null);
      } catch (e: any) {
        setFlowModal(null);
        const msg = String(e?.message ?? e);
        if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
          setError(
            "API ID ou API Hash inválidos. Verifique em my.telegram.org/apps e cole exatamente como aparece lá.",
          );
          setStep("creds");
        } else if (msg.includes("PHONE_NUMBER_INVALID")) {
          setError("Número de telefone inválido. Confira DDI e DDD.");
        } else if (msg.includes("PHONE_NUMBER_BANNED")) {
          setError("Esse número está banido pelo Telegram.");
        } else if (msg.includes("PHONE_NUMBER_FLOOD") || msg.includes("FLOOD_WAIT")) {
          setError("Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.");
        } else {
          setError(`Não foi possível enviar o código: ${msg}`);
        }
      } finally {
        setBusyStatus(null);
        pendingRef.current = false;
        setLoading(false);
      }
    };
    const dup = findDuplicateByCreds(idRaw, hashRaw);
    if (dup) {
      askDuplicate(
        `${clienteArtigo(dup.title)} "${dup.title}" já usa esse API ID e API Hash. Não é possível cadastrar as mesmas credenciais duas vezes.`,
      );
      return;
    }
    await runSend();
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const fullPhone = buildFullPhone();
      const { phoneCodeHash: nh } = await withUiTimeout(
        resendCode(fullPhone, phoneCodeHash),
        "O reenvio demorou demais. Tente de novo em alguns segundos.",
      );
      setPhoneCodeHash(nh);
      setCodeSentAt(Date.now());
      setInfo("Código reenviado.");
      setResendCooldown(60);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendMt() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const fullPhone = buildFullPhone();
      const res = await withUiTimeout(
        callMtSendPassword({ data: { phone: fullPhone } }),
        "O Telegram demorou para reenviar o código. Tente novamente.",
      );
      if ("error" in res) {
        setError("Não foi possível reenviar o código. Tente novamente em instantes.");
        return;
      }
      setRandomHash(res.randomHash);
      setMtCode("");
      setMtSession(null);
      setInfo("Código reenviado.");
      setResendCooldown(60);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (pendingRef.current) return;
    if (!clientId) {
      setError(
        "A conexão precisa ser iniciada novamente. Confira as credenciais e solicite um novo código.",
      );
      setStep("creds");
      return;
    }
    activeClient.set(clientId);
    pendingRef.current = true;
    setInvalidNotice(false);
    setError(null);
    setLoading(true);
    try {
      const fullPhone = buildFullPhone();
      await signIn({
        phone: fullPhone,
        phoneCodeHash,
        code: code.trim(),
        password: password || undefined,
      });
      const id = clientId;
      const me = storage.getMe();
      if (clientsStore.get(id)) {
        clientsStore.update(id, {
          hasSession: true,
          phone: fullPhone,
          meName: me?.firstName || me?.username || null,
          photoUrl: me?.photoUrl ?? null,
          connectedAt: Date.now(),
        });
      } else {
        // Só agora — com a sessão criada — persistimos o cliente novo.
        clientsStore.add({
          id,
          title: title.trim() || "Cliente sem nome",
          createdAt: Date.now(),
          hasSession: true,
          phone: fullPhone,
          scheduleRas: schedRas.trim() || null,
          scheduleFim: schedFim.trim() || null,
          scheduleEnv: schedEnv.trim() || null,
          weekdays: weekdays.length ? [...weekdays].sort() : null,
          frequency,
          biweeklyAnchor: frequency === "quinzenal" ? biweeklyAnchor : null,
          monthlyDays:
            frequency === "mensal" && monthlyDays.length
              ? [...monthlyDays].sort((a, b) => a - b)
              : null,
          preferredGroup: hasPreferred ? preferredGroup.trim() || null : null,
          meName: me?.firstName || me?.username || null,
          photoUrl: me?.photoUrl ?? null,
          connectedAt: Date.now(),
        } as any);
      }
      leavingRef.current = true;
      wizardDraft.clear();
      // Cadastro novo → volta pro Dashboard com toast de sucesso.
      // Edição/reconexão → mantém comportamento antigo (vai pro painel).
      if (!isEditMode && !reconnectMode) {
        const t = title.trim() || clientsStore.get(id)?.title || "Cliente";
        navigate({ to: "/dashboard", search: { added: t } as any, replace: true });
      } else if (reconnectMode) {
        navigate({ to: "/admin/connection", replace: true });
      } else {
        navigate({ to: "/dashboard/unico/$clientId", params: { clientId: id }, replace: true });
      }
    } catch (e: any) {
      if (e?.code === "2FA_REQUIRED") {
        setNeed2fa(true);
        setError("Conta com verificação em duas etapas — digite a senha de nuvem do Telegram.");
      } else {
        const raw = String(e?.message ?? e);
        if (raw.includes("PHONE_CODE_INVALID")) {
          showInvalidCode();
        } else if (raw.includes("PHONE_CODE_EXPIRED")) {
          // Se ainda estamos dentro dos 2 minutos, o hash só ficou obsoleto
          // (ex.: usuário recarregou a página) — revalidamos silenciosamente
          // via resendCode e pedimos pro usuário digitar de novo sem erro.
          if (codeSentAt && Date.now() - codeSentAt < 120_000) {
            try {
              const fullPhone = buildFullPhone();
              const { phoneCodeHash: nh } = await resendCode(fullPhone, phoneCodeHash);
              setPhoneCodeHash(nh);
              setCodeSentAt(Date.now());
              setCode("");
              setError(null);
              setInfo("Atualizamos o código, digite de novo.");
            } catch {
              setError('O código expirou. Clique em "Reenviar" para receber um novo.');
            }
          } else {
            setError('O código expirou. Clique em "Reenviar" para receber um novo.');
          }
        } else if (raw.includes("PHONE_CODE_EMPTY")) {
          setError("Preencha o código recebido no Telegram.");
        } else if (raw.includes("PHONE_NUMBER_UNOCCUPIED")) {
          setError("Esse número ainda não tem conta no Telegram. Confirme o telefone.");
        } else if (
          raw.includes("SESSION_PASSWORD_NEEDED") ||
          raw.includes("PASSWORD_HASH_INVALID")
        ) {
          setError("Senha de duas etapas incorreta. Tente novamente.");
        } else if (raw.includes("FLOOD_WAIT")) {
          setError("Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.");
        } else if (raw.includes("API_ID_INVALID") || raw.includes("API_HASH")) {
          setError("API ID ou API Hash inválidos. Verifique em my.telegram.org/apps.");
        } else {
          setError("Não foi possível autenticar agora. Verifique o código e tente de novo.");
        }
      }
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  }

  function goBackStep() {
    if (!isEditMode) resetNewClientWizard();
    void navigate({ to: backTo });
  }

  // A barra de progresso reflete 3 etapas visíveis. O passo "creds" é um
  // fallback manual quando a automação falha e reaproveita a barra da etapa 2.
  const stepIdx = useMemo(() => {
    if (step === "title") return 0;
    if (step === "mtCode" || step === "creds") return 1;
    return 2; // code
  }, [step]);

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!title.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    if (!editingId || !clientsStore.get(editingId)) {
      setError("Esta cliente não foi encontrada. Volte à lista e abra o cadastro novamente.");
      return;
    }
    clientsStore.update(editingId, {
      title: title.trim(),
      scheduleRas: schedRas.trim() || null,
      scheduleFim: schedFim.trim() || null,
      scheduleEnv: schedEnv.trim() || null,
      weekdays: weekdays.length ? [...weekdays].sort() : null,
      frequency,
      biweeklyAnchor: frequency === "quinzenal" ? biweeklyAnchor : null,
      monthlyDays:
        frequency === "mensal" && monthlyDays.length
          ? [...monthlyDays].sort((a, b) => a - b)
          : null,
      preferredGroup: hasPreferred ? preferredGroup.trim() || null : null,
    });
    setInfo("Dados atualizados.");
  }

  const currentTitle = isEditMode
    ? "Dados da cliente"
    : step === "title"
      ? "Quem vamos cadastrar?"
      : step === "creds"
        ? "Credenciais do Telegram"
        : step === "mtCode"
          ? "Autorize a conexão"
          : need2fa
            ? "Senha de duas etapas"
            : "Confirme a conta";
  const currentDescription = isEditMode
    ? "Altere o nome usado para identificar esta cliente no painel."
    : step === "title"
      ? "Informe o nome e o telefone da conta que será conectada."
      : step === "creds"
        ? "Cole o API ID e o API Hash da conta para continuar com o cadastro manual."
        : step === "mtCode"
          ? "Abra o Telegram da cliente e cole o código de autorização recebido."
          : need2fa
            ? "Esta conta também pede a senha de nuvem do Telegram."
            : "Digite o novo código recebido no Telegram para concluir o cadastro.";
  const steps = [
    { title: "Dados da cliente", description: "Nome e telefone do Telegram.", icon: UserRound },
    { title: "Autorização", description: "Permissão para conectar a conta.", icon: ShieldCheck },
    { title: "Confirmação", description: "Último código e conta conectada.", icon: MessageCircle },
  ];
  const tip = isEditMode
    ? {
        title: "Sobre os dados da conta",
        text: "O telefone e as credenciais pertencem à conta conectada. Para usar outra conta do Telegram, faça um novo cadastro.",
      }
    : step === "title"
      ? {
          title: "Deixe o Telegram por perto",
          text: "Você vai precisar acessar o Telegram da cliente para receber os códigos nas próximas etapas.",
        }
      : step === "creds"
        ? {
            title: "Onde encontro as credenciais?",
            text: "Acesse my.telegram.org/apps com o telefone desta cliente. Copie os dois campos exatamente como aparecem lá.",
          }
        : step === "mtCode"
          ? {
              title: "Este é o primeiro código",
              text: "Ele autoriza a coleta das credenciais da conta. Depois, o Telegram envia outro código para concluir a conexão.",
            }
          : {
              title: "Falta só confirmar",
              text: "Use o código mais recente recebido no Telegram. Se ele expirou, peça um novo pelo botão de reenvio.",
            };

  return (
    <main className="sb-page">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={goBackStep}
          disabled={loading}
          className="gap-2 px-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {editingId ? "Voltar às conexões" : "Voltar ao painel"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {isEditMode ? "Editar cadastro" : `Etapa ${stepIdx + 1} de 3`}
        </span>
      </div>

      <PageBanner
        eyebrow={isEditMode ? "CADASTRO" : reconnectMode ? "CONEXÃO DA CONTA" : "NOVA CLIENTE"}
        title={
          isEditMode
            ? "Cadastro da cliente"
            : reconnectMode
              ? "Reconectar Telegram"
              : "Nova cliente"
        }
        description={
          isEditMode
            ? "Confira e atualize os dados desta cliente."
            : "Preencha os dados, autorize a conexão e confirme a conta pelo Telegram."
        }
        image="/art/cat-register.svg"
        tone="peach"
        compact
      />

      <div className="sb-wizard-grid !mt-6">
        <section
          className="sb-wizard-main sb-panel min-w-0 p-5 sm:p-7"
          aria-busy={loading}
          aria-labelledby="wizard-form-title"
        >
          <div className="mb-6 border-b border-border pb-5">
            <p className="sb-eyebrow mb-3">
              {isEditMode ? "EDITAR CLIENTE" : `PASSO 0${stepIdx + 1}`}
            </p>
            <h2 id="wizard-form-title" className="text-2xl font-medium tracking-tight">
              {currentTitle}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {currentDescription}
            </p>
            {!isEditMode && step !== "title" && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="flex items-center gap-2">
                  <UserRound className="size-3.5" />
                  {title.trim() || "Cliente"}
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-3.5" />
                  {formatDisplayPhone(buildFullPhone())}
                </span>
              </div>
            )}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isEditMode ? "edit" : step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              {isEditMode ? (
                <form onSubmit={saveEdit} className="space-y-4">
                  <div>
                    <Label htmlFor="client-title" className="text-xs">
                      Nome da cliente
                    </Label>
                    <Input
                      id="client-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Ex.: Maria Silva"
                      required
                    />
                  </div>

                  <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                    <p className="text-sm font-medium sm:col-span-2">Conta do Telegram</p>
                    <div>
                      <Label className="text-xs flex items-center gap-1.5">
                        Telefone <Lock className="size-3 text-muted-foreground" />
                      </Label>
                      <Input
                        value={formatDisplayPhone(buildFullPhone())}
                        disabled
                        readOnly
                        className="bg-muted/40 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <Label className="text-xs flex items-center gap-1.5">
                        API ID <Lock className="size-3 text-muted-foreground" />
                      </Label>
                      <Input
                        value={apiId}
                        disabled
                        readOnly
                        className="bg-muted/40 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <Label className="text-xs flex items-center gap-1.5">
                        API Hash <Lock className="size-3 text-muted-foreground" />
                      </Label>
                      <Input
                        type="password"
                        value={apiHash}
                        disabled
                        readOnly
                        className="bg-muted/40 cursor-not-allowed"
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                      As credenciais não podem ser alteradas. Para usar outras, remova o cliente e
                      cadastre novamente.
                    </p>
                  </div>

                  <Button type="submit" className="w-full">
                    <Check className="size-4" /> Salvar alterações
                  </Button>
                </form>
              ) : (
                <>
                  {(step === "creds" || step === "mtCode") && (
                    <div className="mb-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setInfo(null);
                          setStep("title");
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ArrowLeft className="size-3.5" /> Voltar etapa
                      </Button>
                    </div>
                  )}
                  {step === "title" && (
                    <form onSubmit={submitTitle} className="space-y-4">
                      <div>
                        <Label htmlFor="client-title" className="text-xs">
                          Nome da cliente
                        </Label>
                        <Input
                          id="client-title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Ex.: Maria Silva"
                          required
                        />
                      </div>

                      <div>
                        <Label htmlFor="client-phone" className="text-xs">
                          Telefone
                        </Label>
                        <div className="flex gap-2">
                          {(() => {
                            const selected = findCountryByExactDial(ddi);
                            return (
                              <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    role="combobox"
                                    aria-label="País"
                                    aria-expanded={countryOpen}
                                    className="flex h-11 w-[108px] shrink-0 items-center justify-between gap-2 rounded-lg border border-input px-3 text-sm focus-visible:ring-1 focus-visible:ring-ring"
                                  >
                                    <span className="truncate" title={selected?.name}>
                                      {selected ? `+${selected.dial}` : ddi || "País"}
                                    </span>
                                    <ChevronsUpDown className="size-4 opacity-60 shrink-0" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="site-control-glass p-0 w-[320px] max-w-[calc(100vw-2rem)]"
                                  align="start"
                                  onOpenAutoFocus={(event) => event.preventDefault()}
                                >
                                  <Command
                                    disablePointerSelection
                                    className="bg-transparent"
                                    filter={(value, search) => {
                                      const s = search.toLowerCase().replace(/^\+/, "");
                                      return value.toLowerCase().includes(s) ? 1 : 0;
                                    }}
                                  >
                                    <CommandInput placeholder="Buscar país ou código…" />
                                    <CommandList
                                      className="touch-pan-y"
                                      onPointerDownCapture={(event) => {
                                        countryGesture.current = {
                                          x: event.clientX,
                                          y: event.clientY,
                                          dragged: false,
                                        };
                                      }}
                                      onPointerMoveCapture={(event) => {
                                        const gesture = countryGesture.current;
                                        if (
                                          Math.hypot(
                                            event.clientX - gesture.x,
                                            event.clientY - gesture.y,
                                          ) > 8
                                        )
                                          gesture.dragged = true;
                                      }}
                                      onPointerCancelCapture={() => {
                                        countryGesture.current.dragged = true;
                                      }}
                                      onScroll={() => {
                                        countryGesture.current.dragged = true;
                                      }}
                                      onKeyDownCapture={() => {
                                        countryGesture.current.dragged = false;
                                      }}
                                    >
                                      <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
                                      <CommandGroup>
                                        {COUNTRIES.map((c, i) => {
                                          const active =
                                            selected &&
                                            selected.name === c.name &&
                                            selected.dial === c.dial;
                                          return (
                                            <CommandItem
                                              key={`${c.dial}-${c.name}-${i}`}
                                              value={`${c.name} +${c.dial}`}
                                              className={cn(
                                                "rounded-lg border bg-transparent data-[selected=true]:bg-transparent",
                                                active ? "border-primary" : "border-transparent",
                                              )}
                                              onSelect={() => {
                                                if (countryGesture.current.dragged) return;
                                                const newDdi = `+${c.dial}`;
                                                setDdi(newDdi);
                                                // re-formata o telefone com a nova máscara
                                                setPhone(
                                                  formatByMask(phone.replace(/\D/g, ""), c.mask),
                                                );
                                                setCountryOpen(false);
                                              }}
                                            >
                                              <Check
                                                className={cn(
                                                  "mr-2 size-4",
                                                  active ? "opacity-100" : "opacity-0",
                                                )}
                                              />
                                              <span className="flex-1 truncate">{c.name}</span>
                                              <span className="font-mono text-xs text-muted-foreground ml-2">
                                                +{c.dial}
                                              </span>
                                            </CommandItem>
                                          );
                                        })}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            );
                          })()}
                          <Input
                            id="client-phone"
                            value={phone}
                            onChange={(e) => {
                              const raw = e.target.value;
                              // Se o usuário colar/digitar começando com "+", tenta trocar o país.
                              const trimmed = raw.trim();
                              if (trimmed.startsWith("+")) {
                                const digitsOnly = trimmed.slice(1).replace(/\D/g, "");
                                const c = findCountryByDial(digitsOnly);
                                if (c) {
                                  setDdi(`+${c.dial}`);
                                  const local = digitsOnly.slice(c.dial.length);
                                  setPhone(formatByMask(local, c.mask));
                                  return;
                                }
                              }
                              setPhone(formatPhoneInput(raw, ddi));
                            }}
                            placeholder={placeholderFor(findCountryByExactDial(ddi)) || "número"}
                            inputMode="tel"
                            required
                          />
                        </div>
                      </div>

                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? (
                          <>
                            <Loader2 className="size-4 animate-spin" /> Verificando…
                          </>
                        ) : (
                          "Continuar"
                        )}
                      </Button>
                    </form>
                  )}

                  {step === "creds" && (
                    <form onSubmit={submitCreds} className="space-y-4">
                      <div>
                        <Label className="text-xs">API ID</Label>
                        <Input
                          value={apiId}
                          onChange={(e) => setApiId(e.target.value.replace(/\s/g, ""))}
                          placeholder="12345678"
                          inputMode="numeric"
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-xs">API Hash</Label>
                        <Input
                          value={apiHash}
                          onChange={(e) => setApiHash(e.target.value.replace(/\s/g, ""))}
                          placeholder="aa1bcde234fg5h..."
                          required
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Obtenha em{" "}
                        <a
                          href="https://my.telegram.org/apps"
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          my.telegram.org/apps
                        </a>
                        .
                      </p>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={loading || !apiId.trim() || !apiHash.trim()}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="size-4 animate-spin" /> Enviando código…
                          </>
                        ) : (
                          "Enviar código"
                        )}
                      </Button>
                      {credsInfo && (
                        <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary font-mono">
                          {credsInfo}
                        </p>
                      )}
                    </form>
                  )}

                  {step === "mtCode" && (
                    <form onSubmit={submitMtCode} className="space-y-4">
                      <div>
                        <Label htmlFor="telegram-authorization-code" className="text-xs">
                          Código de autorização
                        </Label>
                        <Input
                          id="telegram-authorization-code"
                          value={mtCode}
                          onChange={(e) => setMtCode(e.target.value.replace(/\s/g, ""))}
                          placeholder="Ex: Ab1CdEfghIJ"
                          autoComplete="one-time-code"
                          required
                          autoFocus
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={loading || !mtCode.trim()}>
                        {loading ? (
                          <>
                            <Loader2 className="size-4 animate-spin" /> Verificando…
                          </>
                        ) : (
                          "Continuar"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={handleResendMt}
                        disabled={loading || resendCooldown > 0}
                      >
                        {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar código"}
                      </Button>
                    </form>
                  )}

                  {step === "code" && (
                    <form onSubmit={submitCode} className="space-y-4">
                      <div>
                        <Label htmlFor="telegram-confirmation-code" className="text-xs">
                          Código de confirmação
                        </Label>
                        <Input
                          id="telegram-confirmation-code"
                          key={`code-${codeSentAt || clientId || "new"}`}
                          name={`otp-${(codeSentAt || Date.now()).toString(36)}`}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="Ex: 123456"
                          inputMode="numeric"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          required
                          autoFocus
                        />
                      </div>
                      {need2fa && (
                        <div>
                          <Label htmlFor="telegram-password" className="text-xs">
                            Senha de duas etapas
                          </Label>
                          <Input
                            id="telegram-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                          />
                        </div>
                      )}
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? (
                          <>
                            <Loader2 className="size-4 animate-spin" /> Verificando…
                          </>
                        ) : (
                          "Concluir cadastro"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={handleResend}
                        disabled={loading || resendCooldown > 0}
                      >
                        {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar código"}
                      </Button>
                    </form>
                  )}
                </>
              )}

              {error && error !== "Nenhum código foi inserido" && (
                <p
                  key={error}
                  role="alert"
                  className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-danger"
                >
                  {error}
                </p>
              )}
              {info && !error && (
                <p
                  role="status"
                  className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground"
                >
                  <Check className="mt-0.5 size-4 shrink-0" />
                  {info}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </section>

        <aside className="sb-wizard-aside" aria-label="Ajuda com o cadastro">
          {!isEditMode && (
            <div className="sb-panel p-5 sm:p-6">
              <h2 className="mb-5 text-sm font-medium">Seu cadastro, passo a passo</h2>
              <ol className="sb-step-list" aria-label="Etapas do cadastro">
                {steps.map(({ title: label, description, icon: Icon }, i) => (
                  <li
                    key={label}
                    aria-current={i === stepIdx ? "step" : undefined}
                    className="flex items-start gap-3"
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full border",
                        i === stepIdx
                          ? "border-foreground bg-foreground text-background"
                          : i < stepIdx
                            ? "border-foreground/30 text-foreground"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {i < stepIdx ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span className="pt-0.5">
                      <span
                        className={cn(
                          "block text-sm font-medium",
                          i > stepIdx && "text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                      {i === stepIdx && (
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {description}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {isEditMode && (
            <div className="sb-panel p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                <UserRound className="size-4" />{" "}
                {isEditMode ? "Conta conectada" : "Resumo da cliente"}
              </div>
              <p className="break-words text-lg font-medium">{title.trim() || "Nome da cliente"}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="size-3.5 shrink-0" />{" "}
                {phone.trim()
                  ? formatDisplayPhone(buildFullPhone())
                  : "Telefone ainda não informado"}
              </p>
              <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                {isEditMode
                  ? "As alterações se aplicam a esta cliente."
                  : "A cliente aparece na sua lista depois que a conexão do Telegram for confirmada."}
              </p>
            </div>
          )}

          <div className="relative overflow-hidden rounded-xl bg-[#d8edb1] p-5 pr-24 text-[#192114] sm:p-6 sm:pr-24">
            <img
              src="/art/cat-note.svg"
              alt=""
              className="pointer-events-none absolute -right-8 bottom-0 h-28 w-32 object-cover"
            />
            <h3 className="relative text-sm font-semibold">{tip.title}</h3>
            <p className="relative mt-2 text-xs leading-relaxed text-[#34432a]">{tip.text}</p>
          </div>
        </aside>
      </div>
      <AccessNotification open={invalidNotice} title="Código inválido" />
      <Dialog
        open={flowModal !== null}
        onOpenChange={(open) => {
          if (!open && !loading) setFlowModal(null);
        }}
      >
        <DialogContent
          className="registration-modal site-control-glass w-[calc(100vw-2rem)] max-w-md rounded-xl border-foreground/20"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (loading) event.preventDefault();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          aria-describedby="registration-dialog-description"
        >
          <DialogTitle className="sr-only">
            {displayedModal === "failure"
              ? "Falha ao coletar as credenciais"
              : displayedModal === "sending"
                ? (busyStatus ?? "Enviando código")
                : "O número está correto?"}
          </DialogTitle>
          <DialogDescription id="registration-dialog-description" className="sr-only">
            Confirmação do cadastro de cliente
          </DialogDescription>
          <AnimatePresence mode="wait">
            <motion.div
              key={displayedModal}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              {displayedModal === "sending" ? (
                <RegistrationStatus text={busyStatus ?? "Enviando código"} />
              ) : displayedModal === "failure" ? (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold">Falha ao coletar as credenciais</h2>
                  <div className="flex justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStep(failureStep.current);
                        setFlowModal(null);
                      }}
                    >
                      Voltar
                    </Button>
                    <Button
                      onClick={() => {
                        window.open("https://my.telegram.org", "_blank", "noopener,noreferrer");
                        setCredsInfo(null);
                        setStep("creds");
                        setFlowModal(null);
                      }}
                    >
                      Pegar manualmente
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-3 text-center">
                    <h2 className="text-lg font-semibold">O número está correto?</h2>
                    <p className="text-lg tabular-nums text-foreground">
                      {(() => {
                        const local = confirmedPhone.slice(ddi.length).replace(/\D/g, "");
                        const areaLength =
                          ddi === "+55" ? 2 : (findCountryByExactDial(ddi)?.mask[0] ?? 2);
                        const area = local.slice(0, areaLength);
                        const number = local.slice(areaLength);
                        return `(${area}) ${number.length > 4 ? number.slice(0, -4) + "-" + number.slice(-4) : number}`;
                      })()}
                    </p>
                  </div>
                  <div className="flex justify-between gap-3">
                    <Button variant="outline" onClick={() => setFlowModal(null)}>
                      Editar
                    </Button>
                    <Button disabled={loading} onClick={() => void tryAutomation(confirmedPhone)}>
                      Continuar
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      <AlertDialog open={dupOpen} onOpenChange={setDupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cliente já cadastrado</AlertDialogTitle>
            <AlertDialogDescription>{dupMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDupOpen(false)}>Voltar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
