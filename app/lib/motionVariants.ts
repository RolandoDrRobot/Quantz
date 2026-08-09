// Shared animation system — one professional, corporate feel across the
// whole app: fast, decisive, no bounce/overshoot. Expo-out easing decelerates
// hard at the end (confident, not playful); durations stay short (150-250ms)
// so nothing feels sluggish on repeated use.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const TRANSITION_FAST = { duration: 0.15, ease: EASE_OUT };
export const TRANSITION_BASE = { duration: 0.22, ease: EASE_OUT };
export const TRANSITION_SHEET = { duration: 0.32, ease: EASE_OUT };
export const TRANSITION_BACKDROP = { duration: 0.18, ease: "easeOut" as const };
// One-time app-shell entrance (first mount only, not AnimatePresence-driven).
export const TRANSITION_APP = { duration: 0.4, ease: EASE_OUT };

// Full-screen/sheet modals (currently just News) — backdrop
export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

// Modal/sheet body — same constrained fade+rise works for both the mobile
// bottom sheet and the desktop centered dialog, no per-breakpoint variant needed.
export const modalVariants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

// Plain fade — for content swaps (loading -> loaded, empty -> populated).
export const fadeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

// Fade + small rise — for cards/panels/list rows entering.
export const fadeUpVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

// Fade + small scale — for compact floating elements (badges, pills, overlays).
export const popVariants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1 },
};
