import Dashboard from "./components/Dashboard";

export default function Home() {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      <header className="flex items-center justify-between px-6 py-2.5 shrink-0" style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--gold-border)" }}>
        <div className="flex items-center gap-4">
          <span className="font-black text-xl tracking-[0.3em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>QUANTZ</span>
          <span className="text-xs tracking-[0.2em] hidden sm:block" style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>PRIVATE TRADING HUB</span>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#3dc85c" }}></span>
          <span className="tracking-wider">EN VIVO</span>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}
