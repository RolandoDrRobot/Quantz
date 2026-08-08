import Dashboard from "./components/Dashboard";

export default function Home() {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      {/* Desktop-only — the mobile layout owns the full viewport itself
          (absolutely-positioned overlays + a full-screen Taylor sheet sized
          to 100dvh), so stacking this header above it on mobile pushed the
          total height past the screen and clipped the bottom overlay. */}
      <header className="hidden lg:flex items-center justify-between px-7 py-4 shrink-0" style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--gold-border)" }}>
        <div className="flex items-center gap-4">
          <span className="font-black text-2xl tracking-[0.3em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>QUANTZ</span>
          <span className="text-sm tracking-[0.2em] hidden sm:block" style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>PRIVATE TRADING HUB</span>
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#1c7d4c" }}></span>
          <span className="tracking-wider">EN VIVO</span>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}
