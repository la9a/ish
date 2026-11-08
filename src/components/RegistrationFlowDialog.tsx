import { BannerArtwork } from "@/components/BannerArtwork";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDisplayPhone } from "@/lib/countries";

type RegistrationFlowState = "confirm" | "sending" | "failure";

const stateArtwork: Record<RegistrationFlowState, string> = {
  confirm: "/art/cat-code.svg",
  sending: "/art/cat-code-sending.svg",
  failure: "/art/cat-code-failure.svg",
};

type Props = {
  open: boolean;
  state: RegistrationFlowState;
  busyStatus: string | null;
  loading: boolean;
  clientTitle: string;
  phone: string;
  onOpenChange: (open: boolean) => void;
  onEditPhone: () => void;
  onConfirm: () => void;
  onBack: () => void;
  onManual: () => void;
};

/** One dialog stays mounted throughout confirmation, the request and failure. */
export function RegistrationFlowDialog({
  open,
  state,
  busyStatus,
  loading,
  clientTitle,
  phone,
  onOpenChange,
  onEditPhone,
  onConfirm,
  onBack,
  onManual,
}: Props) {
  const reducedMotion = useReducedMotion();
  const title =
    state === "confirm"
      ? "Confira o número."
      : state === "sending"
        ? busyStatus || "Enviando código"
        : "Não foi possível continuar.";
  const description =
    state === "confirm"
      ? "Vamos pedir um código de autorização para esta conta. Confira o telefone antes de enviar."
      : state === "sending"
        ? busyStatus === "Coletando credenciais"
          ? "Estamos aguardando o Telegram para preparar a conexão desta conta. Mantenha esta janela aberta."
          : "Estamos solicitando o código ao Telegram. Quando ele for enviado, a próxima etapa aparecerá aqui."
        : "Não conseguimos coletar as credenciais automaticamente. Você pode voltar e tentar de novo ou informar o API ID e o API Hash manualmente.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-flow-state={state}
        className="registration-modal sb-flow-modal w-[calc(100vw-2rem)] max-w-[640px] max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl border border-white/15 bg-[#171717] p-0 text-[#f5f4ee] shadow-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state}
            className="sb-flow-panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
          >
            <div className="sb-flow-header">
              <BannerArtwork image={stateArtwork[state]} className="sb-flow-art" />
              <div className="sb-flow-copy">
                <p className="mb-5 text-[9px] font-semibold tracking-[0.14em] sm:text-[10px]">
                  CONEXÃO TELEGRAM
                </p>
                <DialogTitle className="break-words text-[27px] font-medium leading-[1.1] tracking-[-0.045em] sm:text-[34px]">
                  {title}
                </DialogTitle>
              </div>
            </div>

            <div className="sb-flow-body p-5 sm:p-8">
              <DialogDescription className="sb-flow-description text-sm leading-relaxed text-[#bbb9bf]">
                {description}
              </DialogDescription>

              <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-[#202020] px-4 py-4 sm:gap-4 sm:px-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a] text-[#d8c5f4]">
                  <Phone className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-[#bbb9bf]">
                    {clientTitle.trim() || "Cliente"}
                  </p>
                  <p className="mt-1 break-words text-lg font-medium tracking-tight tabular-nums sm:text-xl">
                    {formatDisplayPhone(phone)}
                  </p>
                </div>
              </div>

              <div className="sb-flow-actions">
                {state === "sending" ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 px-4 py-4 text-sm text-[#d8d5dd]"
                  >
                    <Loader2
                      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Aguardando a resposta do Telegram
                  </div>
                ) : state === "failure" ? (
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onBack}
                      disabled={loading}
                      className="h-11 gap-2 rounded-lg border-white/20 bg-transparent text-[#f5f4ee] hover:bg-white/5"
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" /> Voltar
                    </Button>
                    <Button
                      type="button"
                      onClick={onManual}
                      disabled={loading}
                      className="h-11 gap-2 rounded-lg bg-[#f5f4ee] text-[#171717] hover:bg-[#deddd6]"
                    >
                      Informar manualmente <ExternalLink className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="mt-4 text-xs leading-relaxed text-[#aaa6b0]">
                      Deixe o Telegram desta cliente por perto para receber o código.
                    </p>
                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onEditPhone}
                        disabled={loading}
                        className="h-11 rounded-lg border-white/20 bg-transparent text-[#f5f4ee] hover:bg-white/5"
                      >
                        Editar número
                      </Button>
                      <Button
                        type="button"
                        onClick={onConfirm}
                        disabled={loading}
                        className="h-11 gap-2 rounded-lg bg-[#f5f4ee] text-[#171717] hover:bg-[#deddd6]"
                      >
                        Enviar código <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
