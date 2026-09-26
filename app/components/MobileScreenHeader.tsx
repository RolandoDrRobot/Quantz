import type { ReactNode } from "react";
import type { IconType } from "react-icons";

// Title bar for the full-screen mobile tabs (Taylor, Axe) — same look as
// NewsFeed's header, so every mobile screen opens the same way. `right` holds
// the screen's primary action, top-right like an iOS nav bar.
export default function MobileScreenHeader({ Icon, title, subtitle, right }: {
  Icon: IconType;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-black text-base tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
          <Icon size={18} /> {title}
        </div>
        {subtitle && <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
