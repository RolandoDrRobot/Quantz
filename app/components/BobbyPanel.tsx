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
  HUNTING:       { label: "HUNTING BREAKOUT", color: "#6f9a7e", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT — WAITING RETEST", color: "#c9b845", step: 1 },
  RETEST_ACTIVE: { label: "⚡ RETEST ACTIVE", color: "#d4b83a", step: 2 },
  CONFIRMED:     { label: "POSITION OPEN", color: "#00b868", step: 3 },
  TP_HIT:        { label: "TAKE PROFIT HIT", color: "#00b868", step: 4 },
  SL_HIT:        { label: "STOP LOSS HIT", color: "#cc3a3a", step: 4 },
  CLOSED:        { label: "CLOSED MANUALLY", color: "#b89b28", step: 4 },
  INVALIDATED:   { label: "SETUP INVALIDATED", color: "#cc3a3a", step: 4 },
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

// ── Circular probability gauge ───────────────────────────────────────────────
function ProbRing({ value }: { value: number }) {
  const c = probColor(value);
  const R = 30;
  const CIRC = 2 * Math.PI * R;
  return (
    <div className="relative w-[76px] h-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="38" cy="38" r={R} fill="none"
          stroke={c} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
      </div>
    </div>
  );
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

function SectionHeader({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-1">
      <span className="text-[11px] font-black tracking-[0.25em] shrink-0" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "rgba(184,155,40,0.15)" }} />
      {right}
    </div>
  );
}

// ── The Trade card — everything about the position in one place ──────────────
function TradeCard({
  opp, price, bot, setup, lots, onTakeTrade, onSkipTrade, onCloseTrade,
}: {
  opp: Opportunity;
  price: number | null;
  bot: boolean;
  setup: NonNullable<AnalysisResult["tradeSetup"]> | null;
  lots: number;
  onTakeTrade: () => void;
  onSkipTrade: () => void;
  onCloseTrade: () => void;
}) {
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "CLOSED", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#00b868" : "#cc3a3a";
  const dist = price !== null ? Math.abs(price - opp.level) : null;

  const pnl = (() => {
    if (opp.phase === "CONFIRMED" && price !== null) return livePnl(opp, price);
    if (opp.phase === "CLOSED" && opp.exitPrice != null) return livePnl(opp, opp.exitPrice);
    if (opp.phase === "TP_HIT") return livePnl(opp, opp.tp);
    if (opp.phase === "SL_HIT") return -ACCOUNT.riskPerTrade;
    return null;
  })();

  let statusLine = "";
  switch (opp.phase) {
    case "HUNTING":
      statusLine = dist !== null ? `Waiting for the break of ${opp.level.toFixed(2)} · ${dist.toFixed(2)} pts away` : `Waiting for the break of ${opp.level.toFixed(2)}`;
      break;
    case "AWAIT_RETEST":
      statusLine = dist !== null ? `Level broke — waiting for the retest · ${dist.toFixed(2)} pts away` : "Level broke — waiting for the retest";
      break;
    case "RETEST_ACTIVE":
      statusLine = bot ? "Price at the level — bot enters if the candle holds" : "Price at the level — your call. Take it or skip it.";
      break;
    case "CONFIRMED":
      statusLine = `${bot ? "Bot entered" : "You're in"} @ ${opp.entry.toFixed(2)} · targeting ${opp.tp.toFixed(2)}`;
      break;
    case "TP_HIT":
      statusLine = `Target hit at ${opp.tp.toFixed(2)}. That's how it's done.`;
      break;
    case "SL_HIT":
      statusLine = `Stopped at ${opp.sl.toFixed(2)} — controlled loss, on to the next.`;
      break;
    case "CLOSED":
      statusLine = `Closed at ${opp.exitPrice?.toFixed(2)} by your call.`;
      break;
    case "INVALIDATED":
      statusLine = "Price pushed back through the level — trap avoided.";
      break;
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${meta.color}55`,
        background: `linear-gradient(180deg, ${meta.color}0d 0%, transparent 40%), var(--bg-card)`,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33` : "none",
      }}
    >
      {/* Header: phase + direction pill */}
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: meta.color }} />}
          <span className="font-black text-sm tracking-wider" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
            {meta.label}
          </span>
        </div>
        <span
          className="px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wider"
          style={{ background: `${dirColor}1a`, color: dirColor, border: `1px solid ${dirColor}44`, fontFamily: "var(--font-display)" }}
        >
          {opp.direction === "long" ? "▲ LONG" : "▼ SHORT"} · {lots} LOTS
        </span>
      </div>

      {/* Pipeline */}
      <div className="flex items-center gap-1 px-4 pt-3">
        {STEPS.map((s, i) => {
          const active = i === meta.step;
          const done = i < meta.step;
          const isFailEnd = isTerminal && (opp.phase === "SL_HIT" || opp.phase === "INVALIDATED") && i === 4;
          const c = isFailEnd ? "#cc3a3a" : active || done ? meta.color : "rgba(255,255,255,0.1)";
          return (
            <div key={s} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-[3px] rounded-full" style={{ background: c, opacity: done ? 0.45 : 1 }} />
              <span className="text-[9px] font-bold tracking-widest" style={{ color: active ? c : "var(--text-muted)" }}>{s}</span>
            </div>
          );
        })}
      </div>

      {/* Status + P/L */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-[13px] leading-snug" style={{ color: "#d5e8db" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-2xl font-black leading-none" style={{ color: pnl >= 0 ? "#00b868" : "#cc3a3a", fontFamily: "var(--font-display)" }}>
              {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(0)}
            </div>
            <div className="text-[10px] font-bold tracking-widest mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {opp.phase === "CONFIRMED" ? "LIVE P/L" : "RESULT"}
            </div>
          </div>
        )}
      </div>

      {/* Entry / SL / TP strip */}
      {setup && (
        <div className="grid grid-cols-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-2.5">
            <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#c9b845" }}>ENTRY</div>
            <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{setup.entryPrice.toFixed(2)}</div>
          </div>
          <div className="px-4 py-2.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#cc3a3a" }}>STOP · −${ACCOUNT.riskPerTrade}</div>
            <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{setup.stopLoss.toFixed(2)}</div>
          </div>
          <div className="px-4 py-2.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#00b868" }}>TARGET · +${setup.rewardAmount}</div>
            <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{setup.takeProfit.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Contextual actions */}
      {!bot && (opp.phase === "RETEST_ACTIVE" || opp.phase === "AWAIT_RETEST") && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-1">
          <button
            onClick={onTakeTrade}
            className="py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: opp.phase === "RETEST_ACTIVE" ? "#00b868" : "rgba(0,184,104,0.1)",
              color: opp.phase === "RETEST_ACTIVE" ? "#030b06" : "#00b868",
              border: "1px solid rgba(0,184,104,0.45)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            ✓ TAKE TRADE
          </button>
          <button
            onClick={onSkipTrade}
            className="py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(204,58,58,0.08)",
              color: "#d64848",
              border: "1px solid rgba(204,58,58,0.35)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            ✕ SKIP SETUP
          </button>
        </div>
      )}

      {opp.phase === "CONFIRMED" && (
        <div className="px-4 pb-3 pt-1">
          <button
            onClick={onCloseTrade}
            className="w-full py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(204,58,58,0.1)",
              color: "#d64848",
              border: "1px solid rgba(204,58,58,0.4)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            ⏻ CLOSE POSITION {price !== null && pnl !== null ? `@ ${price.toFixed(2)} (${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  market: Market;
  analysis: AnalysisResult | null;
  onAnalysis: (result: AnalysisResult, candles5m: RawCandle[], candles1m: RawCandle[]) => void;
  opportunity: Opportunity | null;
  livePrice: number | null;
  botMode: boolean;
  onToggleBot: () => void;
  onTakeTrade: () => void;
  onSkipTrade: () => void;
  onCloseTrade: () => void;
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  botMode, onToggleBot, onTakeTrade, onSkipTrade, onCloseTrade,
}: Props) {
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

  useEffect(() => {
    setError("");
  }, [market]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
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

      {/* Account chips */}
      <div className="flex items-center gap-2 px-5 py-2 overflow-x-auto" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        {[
          ["ACCOUNT", `$${ACCOUNT.balance.toLocaleString()}`, "#e8f5ec"],
          ["RISK", `$${ACCOUNT.riskPerTrade}/trade`, "#cc3a3a"],
          ["SL", market.slLabel, "#e8f5ec"],
          ["SIZE", `${lots} lots`, "#e8f5ec"],
        ].map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: c, fontFamily: "var(--font-display)" }}>{v}</span>
          </span>
        ))}
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
          className="px-6 py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150 shrink-0"
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
        <div className="mx-5 mt-4 p-3 rounded-lg text-sm" style={{ background: "rgba(204,58,58,0.1)", border: "1px solid rgba(204,58,58,0.35)", color: "#d64848" }}>
          {error}
        </div>
      )}

      {result && sig && (
        <div className="p-4 flex flex-col gap-3">

          {/* ═══ THE TRADE ═══ */}
          <SectionHeader
            label="THE TRADE"
            right={
              <button
                onClick={onToggleBot}
                className="flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-black tracking-wider transition-all duration-150"
                style={{
                  background: botMode ? "rgba(0,184,104,0.12)" : "rgba(255,255,255,0.04)",
                  color: botMode ? "#00b868" : "var(--text-secondary)",
                  border: `1px solid ${botMode ? "rgba(0,184,104,0.4)" : "rgba(255,255,255,0.12)"}`,
                  cursor: "pointer",
                  fontFamily: "var(--font-display)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: botMode ? "#00b868" : "#6b7280" }} />
                {botMode ? "TRADE BOT: ON" : "TRADE BOT: OFF — MANUAL"}
              </button>
            }
          />

          {opportunity ? (
            <TradeCard
              opp={opportunity}
              price={livePrice}
              bot={botMode}
              setup={result.tradeSetup}
              lots={lots}
              onTakeTrade={onTakeTrade}
              onSkipTrade={onSkipTrade}
              onCloseTrade={onCloseTrade}
            />
          ) : (
            <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
              No tradeable setup right now — run a new analysis when the market moves.
            </div>
          )}

          {/* ═══ THE ANALYSIS ═══ */}
          <SectionHeader label="THE ANALYSIS" />

          {/* Signal + probability gauge */}
          <div className="rounded-xl flex items-center gap-4 px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <ProbRing value={result.probability} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.icon}</span>
                <span className="text-xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              <div className="text-xs mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {probLabel(result.probability)} PROBABILITY · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factors aligned
                {result.penalties.length > 0 && ` · ${result.penalties.length} ${result.penalties.length === 1 ? "penalty" : "penalties"}`}
              </div>
            </div>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 ? (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(204,58,58,0.35)" }}>
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
            <div className="rounded-xl px-3 py-2 text-[13px] font-semibold" style={{ background: "rgba(0,184,104,0.06)", border: "1px solid rgba(0,184,104,0.25)", color: "#00b868" }}>
              ✓ No red flags — clean conditions for this setup
            </div>
          )}

          {/* Score factors with mini bars */}
          <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="text-[10px] font-bold tracking-widest mb-2.5" style={{ color: "var(--text-secondary)" }}>SCORE BREAKDOWN</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {result.probFactors.map((f, i) => {
                const pct = f.max > 0 ? (f.points / f.max) * 100 : 0;
                const c = pct === 100 ? "#00b868" : pct === 0 ? "#cc3a3a" : "#b89b28";
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span style={{ color: "#c2d8ca" }}>{f.label}</span>
                      <span className="font-bold" style={{ color: c, fontFamily: "var(--font-display)" }}>{f.points}/{f.max}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
                    </div>
                  </div>
                );
              })}
              {result.penalties.map((p, i) => (
                <div key={`p${i}`}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span style={{ color: "#c2d8ca" }}>⚠ {p.label}</span>
                    <span className="font-bold" style={{ color: "#cc3a3a", fontFamily: "var(--font-display)" }}>{p.points}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(204,58,58,0.25)" }}>
                    <div className="h-full rounded-full" style={{ width: "100%", background: "rgba(204,58,58,0.5)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ BOBBY'S TAKE ═══ */}
          <SectionHeader label="BOBBY'S TAKE" />

          <div className="rounded-xl px-4 py-3" style={{ background: sig.bg, border: `1px solid ${sig.border}` }}>
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
