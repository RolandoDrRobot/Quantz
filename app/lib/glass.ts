import type { CSSProperties } from "react";

// "Nosedive" frosted glass (Black Mirror's social-rating app) — soft gradient
// sheen + blurred translucency + a faint bright edge, built from this app's
// own navy/red palette instead of Nosedive's pastel one. `accent` (a hex
// color, e.g. a phase/verdict/signal color already used elsewhere) tints the
// sheen and border for state-colored surfaces; omit it for the neutral
// default. Relies on globals.css's ambient background gradient to actually
// have something behind it to blur — over a flat color, backdrop-filter is
// invisible.
export function glassStyle(accent?: string): CSSProperties {
  const tint = accent ? `${accent}26` : "rgba(255,255,255,0.08)";
  const edge = accent ? `${accent}40` : "var(--glass-border)";
  return {
    background: `linear-gradient(155deg, ${tint} 0%, rgba(255,255,255,0.03) 35%, rgba(8,26,44,0.55) 100%)`,
    border: `1px solid ${edge}`,
    boxShadow: "var(--glass-shadow)",
    backdropFilter: "blur(var(--glass-blur))",
    WebkitBackdropFilter: "blur(var(--glass-blur))",
  };
}

// Lighter weight — for small pills/chips/buttons where the full card shadow
// would be too heavy.
export function glassChipStyle(accent?: string): CSSProperties {
  const tint = accent ? `${accent}22` : "rgba(255,255,255,0.07)";
  const edge = accent ? `${accent}3a` : "var(--glass-border)";
  return {
    background: `linear-gradient(155deg, ${tint} 0%, rgba(8,26,44,0.45) 100%)`,
    border: `1px solid ${edge}`,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };
}
