/**
 * Efeitos de ponteiro (brilho, inclinação e botões magnéticos) por delegação:
 * um único listener para o site inteiro. Desligado em toque, aparelhos fracos
 * e quando o sistema pede movimento reduzido.
 */
export function installEffects(): () => void {
  const root = document.documentElement;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const weak =
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    nav.connection?.saveData === true;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (weak || reduce) root.dataset.lite = "";

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!finePointer || reduce) return () => {};

  let frame = 0;
  let last: PointerEvent | null = null;
  let tilted: HTMLElement | null = null;
  let magnet: HTMLElement | null = null;

  const apply = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    const target = e.target instanceof Element ? e.target : null;

    const spot = target?.closest<HTMLElement>(".spotlight");
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${e.clientX - r.left}px`);
      spot.style.setProperty("--my", `${e.clientY - r.top}px`);
    }

    const tilt = target?.closest<HTMLElement>(".tilt") ?? null;
    if (tilted && tilted !== tilt) {
      tilted.style.removeProperty("--rx");
      tilted.style.removeProperty("--ry");
    }
    tilted = tilt;
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty("--rx", `${(-py * 5).toFixed(2)}deg`);
      tilt.style.setProperty("--ry", `${(px * 6).toFixed(2)}deg`);
    }

    const mag = target?.closest<HTMLElement>("[data-magnetic]") ?? null;
    if (magnet && magnet !== mag) magnet.style.transform = "";
    magnet = mag;
    if (mag) {
      const r = mag.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      mag.style.transform = `translate(${dx * 0.15}px, ${dy * 0.2}px)`;
    }
  };

  const onMove = (e: PointerEvent) => {
    last = e;
    if (!frame) frame = requestAnimationFrame(apply);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    window.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
