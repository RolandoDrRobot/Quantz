import Dashboard from "./components/Dashboard";

export default function Home() {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      {/* The QUANTZ header (desktop + mobile) now lives inside Dashboard —
          it needs the selected market's is24h to render the clock, which
          only Dashboard has. Stacking a second header here on mobile also
          used to push the 100dvh mobile layout past the screen. */}
      <Dashboard />
    </div>
  );
}
