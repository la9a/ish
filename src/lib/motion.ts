// Presets de movimento inspirados no site do Claude Code.
// Easing "expo out" longo, durações confortáveis, stagger cascata.
import type { Transition, Variants, Easing } from "motion/react";

export const easeClaude: Easing = [0.22, 1, 0.36, 1];

export const dur = {
  fast: 0.25,
  base: 0.55,
  slow: 0.85,
} as const;

export const baseTransition: Transition = {
  duration: dur.base,
  ease: easeClaude,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: baseTransition },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: baseTransition },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: baseTransition },
};

export const staggerContainer = (stagger = 0.07, delayChildren = 0.05): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

export const staggerItem: Variants = fadeUp;

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.22, ease: easeClaude } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: easeClaude } },
};