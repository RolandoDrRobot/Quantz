import type { CSSProperties } from "react";

// Flat, sober, corporate surfaces — solid panel color, no border, no
// gradient sheen, no blur, no glow. This replaced an earlier "Nosedive"
// frosted-glass treatment; kept the function names since they're called in
// ~50 places across the app and a rename would touch every one of those
// call sites for zero behavioral gain. `accent` is now unused by both
// functions (borders were the only thing it tinted) but kept in the
// signature so none of those call sites need to change.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function glassStyle(accent?: string): CSSProperties {
  return {
    background: "var(--bg-elevated)",
  };
}

// Slightly lighter surface — for small pills/chips/buttons, one step up in
// contrast from glassStyle so nested controls stay visually distinct from
// their card.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function glassChipStyle(accent?: string): CSSProperties {
  return {
    background: "var(--bg-card)",
  };
}
