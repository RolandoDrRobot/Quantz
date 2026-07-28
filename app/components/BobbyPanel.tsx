"use client";

import { useState, useEffect, useCallback } from "react";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, type Market } from "../lib/markets";
import { livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; icon: string }> = {
  GO_LONG:  { label: "GO LONG",  color: "#00b868", bg: "rgba(0,184,104,0.07)",   border: "rgba(0,184,104,0.35)",   icon: "▲" },
  GO_SHORT: { label: "GO SHORT", color: "#cc3a3a", bg: "rgba(204,58,58,0.07)",   border: "rgba(204,58,58,0.35)",   icon: "▼" },
  WAIT:     { label: "WAIT",     color: "#b89b28", bg: "rgba(184,155,40,0.06)",  border: "rgba(184,155,40,0.3)",   icon: "◆" },
};

const PHASE_META: Record<OppPhase, { label: string; color: string; step: number }> = {
  HUNTING:       { label: "HUNTING BREAKOUT", color: "#7878a0", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT! — WAITING RETEST", color: "#c9b845", step: 1 },
  RETEST_ACTIVE: { label: "⚡ RETEST ACTIVE — GET READY", color: "#d4b83a", step: 2 },
  CONFIRMED:     { label: "RETEST HELD — TRADE LIVE", color: "#00b868", step: 3 },
  TP_HIT:        { label: "✓ TAKE PROFIT HIT", color: "#00b868", step: 4 },
  SL_HIT:        { label: "✗ STOP LOSS HIT", color: "#cc3a3a", step: 4 },
  INVALIDATED:   { label: "✗ SETUP INVALIDATED — TRAP", color: "#cc3a3a", step: 4 },
};

const STEPS = ["HUNT", "BREAK", "RETEST", "LIVE", "DONE"];

function probColor(p: number) {
  if (p >= 70) return "#00b868";
  if (p >= 45) return "#b89b28";
  return "#cc3a3a";
}
function probLabel(p: number) {
  if (p >= 70) return "HIGH";
  if (p >= 45) return "MEDIUM";
  return "LOW";
}

function Clock({ is24h }: { is24h: boolean }) {
  const [time, setTime] = useState("");
  const [statusLabel, setStatusLabel] = useState("");
  const [statusColor, setStatusColor] = useState("#6b7280");

  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-US", {
        timeZone: "America/Costa_Rica",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
      }));

      if (is24h) {
        setStatusLabel("24h Market — Open");
        setStatusColor("#00b868");
        return;
      }

      const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay();
      const totalMin = et.getHours() * 60 + et.getMinutes();
      const openMin = 9 * 60 + 30;

      if (day === 0 || day === 6) {
        setStatusLabel("Weekend — Closed"); setStatusColor("#6b7280");
      } else if (totalMin < openMin - 30) {
        setStatusLabel(`Pre-market — opens in ${openMin - totalMin}min`); setStatusColor("#f59e0b");
      } else if (totalMin < openMin) {
        setStatusLabel(`⚡ OPENS IN ${openMin - totalMin}MIN — MARK YOUR LEVELS`); setStatusColor("#b89b28");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`🔥 SETUP WINDOW — ${30 - (totalMin - openMin)}min left`); setStatusColor("#00b868");
      } else if (totalMin < 16 * 60) {
        setStatusLabel("Open — window closed"); setStatusColor("#6b7280");
      } else {
        setStatusLabel("Market closed"); setStatusColor("#6b7280");
      }
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [is24h]);

  return (
    <div className="text-right">
      <div className="text-lg font-bold tracking-widest leading-none" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>{time}</div>
      <div className="text-xs mt-1 font-semibold" style={{ color: statusColor }}>{statusLabel}</div>
    </div>
  );
}

// Live opportunity tracker — the heart of the panel once a setup exists
function OpportunityTracker({ opp, price }: { opp: Opportunity; price: number | null }) {
  const meta = PHASE_META[opp.phase];
  const isTerminal = opp.phase === "TP_HIT" || opp.phase === "SL_HIT" || opp.phase === "INVALIDATED";
  const isWin = opp.phase === "TP_HIT";
  const dirColor = opp.direction === "long" ? "#00b868" : "#cc3a3a";

  const dist = price !== null ? Math.abs(price - opp.level) : null;
  const pnl = price !== null && (opp.phase === "CONFIRMED") ? livePnl(opp, price) : null;

  let statusLine = "";
  if (price !== null) {
    switch (opp.phase) {
      case "HUNTING":
        statusLine = `Waiting for price to break ${opp.level.toFixed(2)} — ${dist!.toFixed(2)} pts away`;
        break;
      case "AWAIT_RETEST":
        statusLine = `Level broke! Waiting for price to come back to ${opp.level.toFixed(2)} — ${dist!.toFixed(2)} pts away`;
        break;
      case "RETEST_ACTIVE":
        statusLine = `Price is AT the level right now. Watch the candle — if it holds, that's your entry.`;
        break;
      case "CONFIRMED":
        statusLine = `Retest held. Tracking the move → TP ${opp.tp.toFixed(2)} / SL ${opp.sl.toFixed(2)}`;
        break;
      case "TP_HIT":
        statusLine = `Target reached at ${opp.tp.toFixed(2)}. That's how it's done.`;
        break;
      case "SL_HIT":
        statusLine = `Stopped at ${opp.sl.toFixed(2)}. −$${ACCOUNT.riskPerTrade} — controlled loss, next.`;
        break;
      case "INVALIDATED":
        statusLine = `Price pushed back through the level — trap avoided. Run a new analysis.`;
        break;
    }
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${meta.color}66`, background: "var(--bg-card)" }}>
      {/* Phase header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: `${meta.color}14` }}>
        <span className="font-black text-sm tracking-wider" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
          {meta.label}
        </span>
        <span className="flex items-center gap-2 text-xs font-bold" style={{ color: dirColor }}>
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse inline-block" style={{ background: meta.color }} />}
          {opp.direction === "long" ? "▲ LONG" : "▼ SHORT"} @ {opp.level.toFixed(2)}
        </span>
      </div>

      {/* Step pipeline */}
      <div className="flex items-center gap-1 px-4 pt-3">
        {STEPS.map((s, i) => {
          const active = i === meta.step;
          const done = i < meta.step;
          const failColor = isTerminal && !isWin && i === 4;
          const c = failColor ? "#cc3a3a" : active || done ? meta.color : "rgba(255,255,255,0.12)";
          return (
            <div key={s} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-1 rounded-full" style={{ background: c, opacity: done ? 0.5 : 1 }} />
              <span className="text-[10px] font-bold tracking-wider" style={{ color: active ? c : "var(--text-muted)" }}>{s}</span>
            </div>
          );
        })}
      </div>

      {/* Live status */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <p className="text-[13px]" style={{ color: "#d5e8db" }}>{statusLine || "Waiting for live data..."}</p>
        {pnl !== null && (
          <div className="text-xl font-black shrink-0" style={{ color: pnl >= 0 ? "#00b868" : "#cc3a3a", fontFamily: "var(--font-display)" }}>
            {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(0)}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  market: Market;
  analysis: AnalysisResult | null;
  onAnalysis: (result: AnalysisResult, candles5m: RawCandle[], candles1m: RawCandle[]) => void;
  opportunity: Opportunity | null;
  livePrice: number | null;
}

export default function BobbyPanel({ market, analysis, onAnalysis, opportunity, livePrice }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const result = analysis; // analysis state lives in Dashboard (persisted across reloads)

  const analyze = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/market?symbol=${encodeURIComponent(market.symbol)}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to fetch market data");
      }
      const data = await res.json();

      const { runAnalysis } = await import("../lib/analysis");
      const fresh = runAnalysis(
        data.candles5m,
        data.currentPrice,
        data.prevClose,
        market.is24h,
        market.slPoints,
        market.label
      );
      onAnalysis(fresh, data.candles5m, data.candles1m ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [market, onAnalysis]);

  // Clear errors when market changes — analysis only runs on button press
  useEffect(() => {
    setError("");
  }, [market]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const pc = result ? probColor(result.probability) : "#6b7280";
  const hasOpp = !!opportunity;
  const lots = lotsFor(market);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-panel)" }}>

      {/* Header: title + clock */}
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <div>
          <div className="font-black text-base tracking-[0.25em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>BOBBY&apos;S COUNCIL</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{market.label}</div>
        </div>
        <Clock is24h={market.is24h} />
      </div>

      {/* Account strip */}
      <div className="flex items-center gap-4 px-5 py-2 text-xs font-semibold" style={{ borderBottom: "1px solid var(--gold-border)", color: "var(--text-secondary)" }}>
        <span>ACCOUNT <span style={{ color: "#eeeef8" }}>${ACCOUNT.balance.toLocaleString()}</span></span>
        <span>RISK <span style={{ color: "#cc3a3a" }}>${ACCOUNT.riskPerTrade}/trade</span></span>
        <span>SL <span style={{ color: "#eeeef8" }}>{market.slLabel}</span></span>
        <span>SIZE <span style={{ color: "#eeeef8" }}>{lots} lots</span></span>
      </div>

      {/* Price strip + action button */}
      <div className="flex items-center justify-between gap-4 px-5 py-3" style={{ borderBottom: "1px solid var(--gold-border)", background: "var(--bg-elevated)" }}>
        {livePrice !== null || result ? (
          <div className="flex items-baseline gap-3">
            <span className="font-black text-2xl text-white leading-none" style={{ fontFamily: "var(--font-display)" }}>
              {(livePrice ?? result!.currentPrice).toFixed(2)}
            </span>
            {result && (
              <>
                <span className="font-bold text-base" style={{ color: result.priceChange >= 0 ? "#00b868" : "#cc3a3a" }}>
                  {result.priceChange >= 0 ? "+" : ""}{result.priceChangePct.toFixed(2)}%
                </span>
                <span className="text-xs font-semibold" style={{ color: result.trend.direction === "bullish" ? "#00b868" : result.trend.direction === "bearish" ? "#cc3a3a" : "var(--text-secondary)" }}>
                  {result.trend.direction === "bullish" ? "▲ BULLISH" : result.trend.direction === "bearish" ? "▼ BEARISH" : "→ NEUTRAL"}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>No analysis yet</span>
        )}
        <button
          onClick={analyze}
          disabled={loading}
          className="px-6 py-2.5 rounded font-black text-sm tracking-widest transition-all duration-150 shrink-0"
          style={{
            background: loading ? "rgba(184,155,40,0.08)" : hasOpp ? "transparent" : "#b89b28",
            color: loading ? "#b89b28" : hasOpp ? "#b89b28" : "#030b06",
            border: "1px solid rgba(184,155,40,0.5)",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          {loading ? "LOADING..." : hasOpp ? "↻ NEW ANALYSIS" : "ASK BOBBY"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 p-3 rounded text-sm" style={{ background: "rgba(204,58,58,0.1)", border: "1px solid rgba(204,58,58,0.35)", color: "#d64848" }}>
          {error}
        </div>
      )}

      {result && sig && (
        <div className="p-4 flex flex-col gap-3">

          {/* Live opportunity tracker — always on top when it exists */}
          {opportunity && <OpportunityTracker opp={opportunity} price={livePrice} />}

          {/* Signal + Probability side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 flex flex-col items-center justify-center" style={{ background: sig.bg, border: `2px solid ${sig.border}` }}>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.icon}</span>
                <span className="text-xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
            </div>

            <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-card)", border: `1px solid ${pc}44` }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-bold tracking-widest" style={{ color: "var(--text-secondary)" }}>PROBABILITY</span>
                <span className="text-[10px] font-black" style={{ color: pc }}>{probLabel(result.probability)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-3xl font-black leading-none" style={{ color: pc, fontFamily: "var(--font-display)" }}>
                  {result.probability}%
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${result.probability}%`, background: pc }} />
                </div>
              </div>
            </div>
          </div>

          {/* Warnings — the context that changes your decision */}
          {result.warnings.length > 0 ? (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(204,58,58,0.35)" }}>
              <div className="px-3 py-1.5 text-[10px] font-black tracking-widest" style={{ background: "rgba(204,58,58,0.1)", color: "#d64848" }}>
                ⚠ WARNINGS — READ BEFORE ENTERING
              </div>
              <div className="flex flex-col">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2.5 px-3 py-1.5" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", background: "var(--bg-card)" }}>
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: w.severity === "high" ? "#cc3a3a" : "#c68428" }}
                    />
                    <div className="text-[13px] leading-snug">
                      <span className="font-bold" style={{ color: w.severity === "high" ? "#d64848" : "#c68428" }}>{w.title}: </span>
                      <span style={{ color: "#b5ccbc" }}>{w.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "rgba(0,184,104,0.06)", border: "1px solid rgba(0,184,104,0.25)", color: "#00b868" }}>
              ✓ No red flags — clean conditions for this setup
            </div>
          )}

          {/* Trade setup: 3-column grid */}
          {result.tradeSetup && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg px-2 py-2 text-center" style={{ background: "var(--bg-card)", border: "1px solid rgba(201,184,69,0.3)" }}>
                <div className="text-[10px] font-bold tracking-widest" style={{ color: "#c9b845" }}>ENTRY</div>
                <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.entryPrice.toFixed(2)}</div>
                <div className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {result.tradeSetup.direction === "long" ? "▲ LONG" : "▼ SHORT"} · {lots} lots
                </div>
              </div>
              <div className="rounded-lg px-2 py-2 text-center" style={{ background: "var(--bg-card)", border: "1px solid rgba(194,48,48,0.3)" }}>
                <div className="text-[10px] font-bold tracking-widest" style={{ color: "#cc3a3a" }}>STOP LOSS</div>
                <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.stopLoss.toFixed(2)}</div>
                <div className="text-[11px] font-bold" style={{ color: "#cc3a3a" }}>−${ACCOUNT.riskPerTrade}</div>
              </div>
              <div className="rounded-lg px-2 py-2 text-center" style={{ background: "var(--bg-card)", border: "1px solid rgba(0,184,104,0.3)" }}>
                <div className="text-[10px] font-bold tracking-widest" style={{ color: "#00b868" }}>TAKE PROFIT</div>
                <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.takeProfit.toFixed(2)}</div>
                <div className="text-[11px] font-bold" style={{ color: "#00b868" }}>+${result.tradeSetup.rewardAmount} · R:R {result.tradeSetup.rrRatio}</div>
              </div>
            </div>
          )}

          {/* Probability factors */}
          <div className="rounded-lg px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[10px] font-bold tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>SCORE FACTORS</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {result.probFactors.map((f, i) => {
                const full = f.points === f.max;
                const zero = f.points === 0;
                return (
                  <div key={i} className="flex items-center justify-between text-[13px]">
                    <span style={{ color: "#c2d8ca" }}>{f.label}</span>
                    <span className="font-bold shrink-0 ml-2" style={{ color: full ? "#00b868" : zero ? "#cc3a3a" : "#b89b28", fontFamily: "var(--font-display)" }}>
                      {f.points}/{f.max}
                    </span>
                  </div>
                );
              })}
              {result.penalties.map((p, i) => (
                <div key={`p${i}`} className="flex items-center justify-between text-[13px]">
                  <span style={{ color: "#c2d8ca" }}>⚠ {p.label}</span>
                  <span className="font-bold shrink-0 ml-2" style={{ color: "#cc3a3a", fontFamily: "var(--font-display)" }}>
                    {p.points}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bobby's message */}
          <div className="rounded-lg px-4 py-3" style={{ background: sig.bg, border: `1px solid ${sig.border}` }}>
            <p className="text-[13px] leading-relaxed" style={{ color: "#d5e8db" }}>{result.message}</p>
            {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
              <div className="mt-2 pt-2 text-xs" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                Setup window opens in {result.minutesToOpen} min — this is the pre-open bias.
              </div>
            )}
          </div>

        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center px-5 text-center" style={{ color: "var(--text-muted)" }}>
          <div className="text-5xl mb-4 opacity-15">⚡</div>
          <p className="text-base">Press <strong style={{ color: "var(--gold)" }}>Ask Bobby</strong> to analyze {market.label}.</p>
          <p className="text-sm mt-2 opacity-70">Signal, probability, levels and live trade tracking.</p>
        </div>
      )}
    </div>
  );
}
