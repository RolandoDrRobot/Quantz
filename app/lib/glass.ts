import type { CSSProperties } from "react";

// Flat, sober, corporate surfaces — solid panel color + a thin neutral (or
// lightly accent-tinted) border, no gradient sheen, no blur, no glow. This
// replaced an earlier "Nosedive" frosted-glass treatment; kept the function
// names since they're called in ~50 places across the app and a rename
// would touch every one of those call sites for zero behavioral gain.
// `accent` (a hex color, e.g. a phase/verdict/signal color already used
// elsewhere) only tints the border, giving a quiet state cue without
// reintroducing decoration.
export function glassStyle(accent?: string): CSSProperties {
  return {
    background: "var(--bg-elevated)",
    border: `1px solid ${accent ? `${accent}40` : "var(--glass-border)"}`,
  };
}

// Lighter surface — for small pills/chips/buttons, one step up in contrast
// from glassStyle so nested controls stay visually distinct from their card.
export function glassChipStyle(accent?: string): CSSProperties {
  return {
    background: "var(--bg-card)",
    border: `1px solid ${accent ? `${accent}40` : "var(--glass-border)"}`,
  };
}
