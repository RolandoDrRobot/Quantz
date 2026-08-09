"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { IconType } from "react-icons";
import {
  FiTrendingUp, FiTrendingDown, FiPauseCircle, FiPower, FiBarChart2,
  FiAlertTriangle, FiRefreshCw, FiZap, FiCpu, FiArrowUpRight, FiArrowDownRight, FiCheck, FiX,
} from "react-icons/fi";
import { LuBrainCircuit, LuNotebookPen, LuListChecks } from "react-icons/lu";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, tradeCostFor, type Market } from "../lib/markets";
import { livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";
import { fadeVariants, fadeUpVariants, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";
import { fmtPrice, fmtMoney, fmtMoney2, fmtSignedMoney, fmtLots } from "../lib/format";
import { buildAiAnalysisRequest, type AiTake, type AiVerdict } from "../lib/aiTake";
import { buildTraderProfileSummary, type TraderProfileSummary } from "../lib/traderProfile";
import JournalPanel from "./JournalPanel";
import PlaybookPanel from "./PlaybookPanel";
import RecordsPanel from "./RecordsPanel";

export type PanelTab = "analysis" | "journal" | "rules" | "history";

const TABS: { key: PanelTab; label: string; Icon: IconType }[] = [
  { key: "analysis", label: "ANALYSIS", Icon: LuBrainCircuit },
  { key: "journal",  label: "JOURNAL",  Icon: LuNotebookPen },
  { key: "rules",    label: "RULES",    Icon: LuListChecks },
  { key: "history",  label: "HISTORY",  Icon: FiBarChart2 },
];

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; Icon: IconType }> = {
  GO_LONG:  { label: "LONG",  color: "#1c7d4c", bg: "rgba(28,125,76,0.07)",    border: "rgba(28,125,76,0.35)",    Icon: FiTrendingUp },
  GO_SHORT: { label: "SHORT",  color: "#8a2f2a", bg: "rgba(138,47,42,0.07)",    border: "rgba(138,47,42,0.35)",    Icon: FiTrendingDown },
  WAIT:     { label: "WAIT", color: "#c23b30", bg: "rgba(194,59,48,0.07)",  border: "rgba(194,59,48,0.30)",  Icon: FiPauseCircle },
};

const AI_VERDICT_STYLE: Record<AiVerdict, { label: string; color: string; bg: string; border: string }> = {
  CONFIRM: { label: "TAYLOR CONFIRMS", color: "#1c7d4c", bg: "rgba(28,125,76,0.07)",  border: "rgba(28,125,76,0.35)" },
  CAUTION: { label: "TAYLOR: CAUTION", color: "#c23b30", bg: "rgba(194,59,48,0.07)",  border: "rgba(194,59,48,0.30)" },
  REJECT:  { label: "TAYLOR: REJECT",  color: "#8a2f2a", bg: "rgba(138,47,42,0.08)",  border: "rgba(138,47,42,0.35)" },
};

export const PHASE_META: Record<OppPhase, { label: string; color: string; step: number }> = {
  HUNTING:       { label: "HUNTING BREAKOUT",           color: "#9ba5b2", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT — AWAITING RETEST", color: "#c23b30", step: 1 },
  RETEST_ACTIVE: { label: "RETEST ACTIVE",              color: "#d9584b", step: 2 },
  CONFIRMED:     { label: "POSITION OPEN",              color: "#1c7d4c", step: 3 },
  TP_HIT:        { label: "TAKE PROFIT",                color: "#1c7d4c", step: 4 },
  SL_HIT:        { label: "STOP LOSS",                  color: "#8a2f2a", step: 4 },
  CLOSED:        { label: "MANUALLY CLOSED",            color: "#c23b30", step: 4 },
  INVALIDATED:   { label: "SETUP INVALIDATED",          color: "#8a2f2a", step: 4 },
};


function probColor(p: number) {
  if (p >= 70) return "#1c7d4c";
  if (p >= 45) return "#c23b30";
  return "#8a2f2a";
}
function probLabel(p: number) {
  if (p >= 70) return "HIGH";
  if (p >= 45) return "MEDIUM";
  return "LOW";
}

// ── Circular probability gauge ───────────────────────────────────────────────
function ProbRing({ value, adjusted }: { value: number; adjusted?: boolean }) {
  const c = probColor(value);
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={R} fill="none"
          stroke={c} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
        {adjusted && (
          <span className="flex items-center gap-0.5 mt-0.5 text-[8px] font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>
            <FiCpu size={7} /> TAYLOR
          </span>
        )}
      </div>
    </div>
  );
}

export function Clock({ is24h }: { is24h: boolean }) {
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
        setStatusColor("#1c7d4c");
        return;
      }

      const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay();
      const totalMin = et.getHours() * 60 + et.getMinutes();
      const openMin = 9 * 60 + 30;
      // Must match getMarketTiming()'s inSetupWindow in lib/analysis.ts —
      // that window starts 15min before the open, not at the open.
      const setupStart = openMin - 15;

      if (day === 0 || day === 6) {
        setStatusLabel("Weekend — Closed"); setStatusColor("#6b7280");
      } else if (totalMin < openMin - 30) {
        setStatusLabel(`Pre-market — opens in ${openMin - totalMin}min`); setStatusColor("#f59e0b");
      } else if (totalMin < setupStart) {
        setStatusLabel(`OPENS IN ${setupStart - totalMin}MIN — MARK YOUR LEVELS`); setStatusColor("#1c7d4c");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`SETUP WINDOW — ${30 - (totalMin - setupStart)}min left`); setStatusColor("#1c7d4c");
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
    <a
      href="https://www.exness.com/calendar/"
      target="_blank"
      rel="noopener noreferrer"
      title="Economic calendar (Exness)"
      className="text-right block"
    >
      <div className="text-xl font-bold tracking-widest leading-none" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>{time}</div>
      <div className="text-sm mt-1 font-semibold" style={{ color: statusColor }}>{statusLabel}</div>
    </a>
  );
}


// ── The Trade card — everything about the position in one place ──────────────
function TradeCard({
  opp, price, bot, lots, onTakeTrade, onMarketEntry, onCloseTrade, onCheckOpportunity, checking, onToggleBot, blockedReason,
}: {
  opp: Opportunity;
  price: number | null;
  bot: boolean;
  lots: number;
  onTakeTrade: () => void;
  onMarketEntry: () => void;
  onCloseTrade: () => void;
  onCheckOpportunity: () => void;
  checking: boolean;
  onToggleBot: () => void;
  blockedReason: string | null;
}) {
  // Values come from the LIVE opportunity — it can re-anchor to closer levels
  const reward = Math.round((Math.abs(opp.tp - opp.entry) / opp.slPoints) * ACCOUNT.riskPerTrade);
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "CLOSED", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#1c7d4c" : "#8a2f2a";
  const dist = price !== null ? Math.abs(price - opp.level) : null;

  const pnl = (() => {
    if (opp.phase === "CONFIRMED" && price !== null) return livePnl(opp, price);
    if (opp.phase === "CLOSED" && opp.exitPrice != null) return livePnl(opp, opp.exitPrice);
    if (opp.phase === "TP_HIT") return livePnl(opp, opp.tp);
    if (opp.phase === "SL_HIT") return livePnl(opp, opp.sl);
    return null;
  })();

  let statusLine = "";
  switch (opp.phase) {
    case "HUNTING":
      statusLine = dist !== null ? `Waiting for break of ${fmtPrice(opp.level)} · ${fmtPrice(dist)} pts away` : `Waiting for break of ${fmtPrice(opp.level)}`;
      break;
    case "AWAIT_RETEST":
      statusLine = dist !== null ? `Level broke — awaiting retest · ${fmtPrice(dist)} pts away` : "Level broke — awaiting retest";
      break;
    case "RETEST_ACTIVE":
      statusLine = bot ? "Price at the level — bot enters if the candle holds" : "Price at the level — your call. Take it or skip it.";
      break;
    case "CONFIRMED":
      statusLine = `${bot ? "Bot entered" : "Position open"} · spread ${fmtMoney2(opp.cost ?? 0)}`;
      break;
    case "TP_HIT":
      statusLine = `Target hit at ${fmtPrice(opp.tp)}. That's how it's done.`;
      break;
    case "SL_HIT":
      statusLine = `Stopped at ${fmtPrice(opp.sl)} — controlled loss, next one up.`;
      break;
    case "CLOSED":
      statusLine = `Closed at ${opp.exitPrice != null ? fmtPrice(opp.exitPrice) : "—"} by your call.`;
      break;
    case "INVALIDATED":
      statusLine = "Price reversed — trap avoided.";
      break;
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${meta.color}55`,
        background: `linear-gradient(180deg, ${meta.color}0d 0%, transparent 40%), var(--bg-panel)`,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33` : "none",
      }}
    >
      {/* Header: phase + verify button + direction pill */}
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: meta.color }} />}
          <span className="font-black text-base tracking-wider truncate" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isTerminal && (
            <>
              <button
                onClick={onToggleBot}
                title={bot ? "Bot: on — click to turn off" : "Bot: off — click to turn on"}
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150"
                style={{
                  background: bot ? "rgba(28,125,76,0.15)" : "var(--bg-elevated)",
                  color: bot ? "#1c7d4c" : "var(--text-secondary)",
                  border: `1px solid ${bot ? "rgba(28,125,76,0.4)" : "rgba(255,255,255,0.1)"}`,
                  cursor: "pointer",
                }}
              >
                <FiCpu size={12} />
              </button>
              <button
                onClick={onCheckOpportunity}
                disabled={checking}
                title="Check current opportunity"
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: checking ? "not-allowed" : "pointer",
                }}
              >
                <FiRefreshCw size={12} className={checking ? "animate-spin" : ""} />
              </button>
            </>
          )}
          <span
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-black tracking-wider whitespace-nowrap"
            style={{ background: `${dirColor}1a`, color: dirColor, border: `1px solid ${dirColor}44`, fontFamily: "var(--font-display)" }}
          >
            {opp.direction === "long" ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
            {opp.direction === "long" ? "▲ LONG" : "▼ SHORT"} · {fmtLots(lots)} LOTS
          </span>
        </div>
      </div>

      {/* Status + P/L */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-[14px] leading-snug" style={{ color: "var(--text-primary)" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-3xl font-black leading-none" style={{ color: pnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
              {fmtSignedMoney(pnl)}
            </div>
            <div className="text-[11px] font-bold tracking-widest mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {opp.phase === "CONFIRMED" ? "LIVE P/L" : "RESULT"}
            </div>
          </div>
        )}
      </div>

      {/* Entry / SL / TP strip — live values from the opportunity */}
      <div className="grid grid-cols-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-5 py-3.5">
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#d4a72c" }}>E</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.entry)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#8a2f2a" }}>SL · {fmtSignedMoney(-ACCOUNT.riskPerTrade)}</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.sl)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#1c7d4c" }}>TP · {fmtSignedMoney(reward)}</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.tp)}</div>
        </div>
      </div>

      {/* Contextual actions */}
      {!bot && (opp.phase === "RETEST_ACTIVE" || opp.phase === "AWAIT_RETEST") && (
        blockedReason ? (
          <div className="mx-5 mb-4 mt-2 px-4 py-3 rounded-md text-sm" style={{ background: "rgba(138,47,42,0.1)", color: "#8a2f2a" }}>
            {blockedReason}
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 pt-2">
          <button
            onClick={onTakeTrade}
            className="flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: opp.phase === "RETEST_ACTIVE" ? "#1c7d4c" : "rgba(28,125,76,0.1)",
              color: opp.phase === "RETEST_ACTIVE" ? "#050e1a" : "#1c7d4c",
              border: "1px solid rgba(28,125,76,0.45)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiCheck size={16} /> TAKE TRADE
          </button>
          <button
            onClick={onMarketEntry}
            disabled={price === null}
            className="flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: "rgba(28,125,76,0.1)",
              color: "#c23b30",
              border: "1px solid rgba(28,125,76,0.45)",
              cursor: price === null ? "not-allowed" : "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiZap size={15} /> {price !== null ? `MARKET @ ${fmtPrice(price)}` : "MARKET ENTRY"}
          </button>
        </div>
        )
      )}

      {opp.phase === "CONFIRMED" && (
        <div className="px-5 pb-4 pt-2">
          <button
            onClick={onCloseTrade}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: "rgba(138,47,42,0.1)",
              color: "#8a2f2a",
              border: "1px solid rgba(138,47,42,0.4)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiPower size={15} /> CLOSE POSITION {price !== null && pnl !== null ? `@ ${fmtPrice(price)} (${fmtSignedMoney(pnl)})` : ""}
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
  onMarketEntry: () => void;
  onCloseTrade: () => void;
  onCheckOpportunity: () => void;
  checkingOpportunity: boolean;
  tradeBlockedReason: string | null;
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  recordsVersion: number;
  onClose?: () => void;
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  botMode, onToggleBot, onTakeTrade, onMarketEntry, onCloseTrade, onCheckOpportunity, checkingOpportunity, tradeBlockedReason,
  activeTab, onTabChange, recordsVersion, onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const result = analysis; // analysis state lives in Dashboard (persisted across reloads)

  // AI second-opinion layer — purely advisory, never gates a trade. Tracks
  // the CURRENT opportunity: once generated, a take persists (survives tab
  // switches, live price ticks, phase transitions, even switching to another
  // market and back — cached per symbol below) and only retires when a fresh
  // "New Analysis" supersedes it with a new opportunity for that market.
  const [aiTake, setAiTake] = useState<AiTake | null>(null);
  const [aiProfile, setAiProfile] = useState<TraderProfileSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  // Per-market cache (session-only, not localStorage) so switching over to
  // check another instrument and back restores the take instead of losing
  // it. Refs can't be read or written during render, so both the mirror
  // below and the swap-on-market-change logic live in effects.
  const aiCacheRef = useRef<Record<string, { take: AiTake; profile: TraderProfileSummary | null }>>({});
  const currentTakeRef = useRef<{ take: AiTake; profile: TraderProfileSummary | null } | null>(null);
  useEffect(() => {
    currentTakeRef.current = aiTake ? { take: aiTake, profile: aiProfile } : null;
  }, [aiTake, aiProfile]);

  // Clear a stale error from the previous market as soon as the market
  // changes, without waiting for a post-render effect.
  const [prevMarket, setPrevMarket] = useState(market);
  if (market !== prevMarket) {
    setPrevMarket(market);
    setError("");
  }

  // Tracks which symbol is currently selected so an in-flight analyze()
  // request from a market the user has since switched away from can detect
  // it's stale and bail instead of overwriting the new market's state.
  const marketSymbolRef = useRef(market.symbol);
  useEffect(() => { marketSymbolRef.current = market.symbol; }, [market.symbol]);

  // Swaps Taylor's take to/from the per-market cache when the selected
  // market changes — a layout effect so the swap lands before paint and the
  // previous market's take never flashes on screen against the new market's
  // chart/probability.
  const prevSymbolForCacheRef = useRef(market.symbol);
  useLayoutEffect(() => {
    const prevSymbol = prevSymbolForCacheRef.current;
    if (prevSymbol === market.symbol) return;
    if (currentTakeRef.current) aiCacheRef.current[prevSymbol] = currentTakeRef.current;
    else delete aiCacheRef.current[prevSymbol];
    const cached = aiCacheRef.current[market.symbol];
    setAiTake(cached?.take ?? null);
    setAiProfile(cached?.profile ?? null);
    setAiUnavailable(false);
    prevSymbolForCacheRef.current = market.symbol;
  }, [market.symbol]);

  // Fire-and-forget from analyze() — runs after the deterministic engine
  // already has a result, so the "NEW ANALYSIS" spinner clears on its own
  // timing and the AI take pops into its card whenever it lands.
  const fetchAiTake = useCallback(async (fresh: AnalysisResult, candles: RawCandle[], requestSymbol: string) => {
    setAiLoading(true);
    setAiUnavailable(false);
    // Free, synchronous localStorage read — captured once here so the request
    // payload and whatever the UI later shows ("Your record: ...") are always
    // the exact same snapshot, never two different reads that could disagree.
    const profile = buildTraderProfileSummary();
    try {
      const payload = buildAiAnalysisRequest(fresh, market, candles, profile);
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (marketSymbolRef.current !== requestSymbol) return; // user switched markets — discard
      if (!res.ok) {
        setAiUnavailable(true);
        return;
      }
      const take: AiTake = await res.json();
      setAiTake(take);
      setAiProfile(profile);
      aiCacheRef.current[requestSymbol] = { take, profile };
    } catch {
      if (marketSymbolRef.current === requestSymbol) setAiUnavailable(true);
    } finally {
      if (marketSymbolRef.current === requestSymbol) setAiLoading(false);
    }
  }, [market]);

  const analyze = useCallback(async () => {
    // Don't stomp an in-flight Taylor comment (analyze() clears aiTake/
    // aiProfile below, which would otherwise race a generateComment() call).
    if (loading || aiLoading) return;
    const requestSymbol = market.symbol;
    setLoading(true);
    setError("");
    // A fresh analysis means a new opportunity for this market — the old
    // take was about the setup that's now gone, so it retires here (and
    // only here, besides an explicit generateComment() overwrite).
    setAiTake(null);
    setAiProfile(null);
    setAiUnavailable(false);
    delete aiCacheRef.current[requestSymbol];
    try {
      const res = await fetch(`/api/market?symbol=${encodeURIComponent(market.symbol)}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to fetch market data");
      }
      const data = await res.json();

      // Scalping runs the analysis engine (levels, trend, breakout) on 1min
      // candles — much faster reads than the old 5min basis. Falls back to
      // 5min only if 1min data is too thin to trust (e.g. a gappy session).
      const candles1m: RawCandle[] = data.candles1m ?? [];
      const analysisCandles = candles1m.length >= 60 ? candles1m : data.candles5m;

      const { runAnalysis } = await import("../lib/analysis");
      const fresh = runAnalysis(
        analysisCandles,
        data.currentPrice,
        data.prevClose,
        market.is24h,
        market.slPoints,
        market.label
      );
      if (marketSymbolRef.current !== requestSymbol) return; // user switched markets — discard
      onAnalysis(fresh, data.candles5m, candles1m);
    } catch (e: unknown) {
      if (marketSymbolRef.current !== requestSymbol) return;
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      // Always clear the spinner for this component instance — only the
      // analysis/error *data* is guarded against staleness above.
      setLoading(false);
    }
  }, [market, onAnalysis, loading, aiLoading]);

  // Separate, explicit trigger for Taylor's comment — decoupled from
  // analyze() so a Claude call only happens when the user asks for it, not
  // on every "New Analysis" tap. Re-fetches live market data itself (so the
  // comment reflects price action right now) but reuses the current
  // deterministic `result` rather than re-running the analysis engine.
  const generateComment = useCallback(async () => {
    if (!result || loading || aiLoading) return;
    const requestSymbol = market.symbol;
    setAiLoading(true);
    setAiUnavailable(false);
    setAiTake(null);
    setAiProfile(null);
    delete aiCacheRef.current[requestSymbol]; // avoid resurrecting a stale take if this attempt fails
    try {
      const res = await fetch(`/api/market?symbol=${encodeURIComponent(market.symbol)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch market data");
      const data = await res.json();
      const candles1m: RawCandle[] = data.candles1m ?? [];
      const candles = candles1m.length >= 60 ? candles1m : data.candles5m;
      if (marketSymbolRef.current !== requestSymbol) { setAiLoading(false); return; }
      await fetchAiTake(result, candles, requestSymbol);
    } catch {
      if (marketSymbolRef.current === requestSymbol) {
        setAiUnavailable(true);
        setAiLoading(false);
      }
    }
  }, [result, market, loading, aiLoading, fetchAiTake]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const lots = lotsFor(market);

  // Display-only blend — never touches result.probability itself, which is
  // what the daily-limit/opportunity-gating logic upstream already consumed
  // synchronously before this AI response could even arrive.
  const displayProbability = result && aiTake
    ? Math.max(0, Math.min(100, result.probability + aiTake.confidenceDelta))
    : result?.probability ?? 0;
  const isBlended = !!(result && aiTake && aiTake.confidenceDelta !== 0);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-panel)" }}>

      {/* Tab bar — the panel's own menu, replaces separate modals for Journal/Rules/History.
          On mobile it sits like a bottom nav bar (order-3, last); on desktop it stays on top. */}
      <div
        className="flex items-center justify-between gap-2 px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-3 overflow-x-auto shrink-0 order-3 lg:order-1"
        style={{ borderTop: "1px solid var(--gold-border)", borderBottom: "1px solid var(--gold-border)", background: "var(--bg-panel)" }}
      >
        <div className="flex items-center gap-2">
          {TABS.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-black tracking-wider whitespace-nowrap transition-all duration-150"
                style={{
                  background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  border: `1px solid ${active ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                  boxShadow: active ? "0 0 14px rgba(255,255,255,0.18)" : "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-display)",
                }}
              >
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded shrink-0" style={{ color: "var(--text-secondary)", cursor: "pointer" }}>
            <FiX size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto order-1 lg:order-2">
      <AnimatePresence mode="wait">
      {activeTab === "journal" ? (
        <motion.div key="journal" className="p-6" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
          <JournalPanel refreshToken={recordsVersion} />
        </motion.div>
      ) : activeTab === "rules" ? (
        <motion.div key="rules" className="p-6" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
          <PlaybookPanel />
        </motion.div>
      ) : activeTab === "history" ? (
        <motion.div key="history" className="p-6" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
          <RecordsPanel refreshToken={recordsVersion} />
        </motion.div>
      ) : (
      <motion.div key="analysis" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>

      {/* Header: analyze + generate-comment buttons — 50/50 width so both stay reachable on mobile */}
      <div className="flex items-center gap-2 px-6 py-4" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <button
          onClick={analyze}
          disabled={loading || aiLoading}
          className="flex-1 px-5 py-2.5 rounded-md font-black text-sm tracking-widest transition-all duration-150"
          style={{
            background: "rgba(255,255,255,0.10)",
            color: "var(--text-primary)",
            border: "1px solid rgba(255,255,255,0.5)",
            boxShadow: "0 0 14px rgba(255,255,255,0.18)",
            cursor: loading || aiLoading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center justify-center gap-2">
            {loading ? <FiRefreshCw size={13} className="animate-spin" /> : <FiRefreshCw size={13} />}
            {loading ? "LOADING..." : "NEW ANALYSIS"}
          </span>
        </button>
        <button
          onClick={generateComment}
          disabled={!result || loading || aiLoading}
          title={result ? "Ask Taylor for a live read on this setup" : "Run an analysis first"}
          className="flex-1 px-5 py-2.5 rounded-md font-black text-sm tracking-widest transition-all duration-150"
          style={{
            background: "rgba(255,255,255,0.10)",
            color: "var(--text-primary)",
            border: "1px solid rgba(255,255,255,0.5)",
            boxShadow: "0 0 14px rgba(255,255,255,0.18)",
            cursor: !result || loading || aiLoading ? "not-allowed" : "pointer",
            opacity: !result ? 0.5 : 1,
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center justify-center gap-2">
            {aiLoading ? <FiCpu size={13} className="animate-pulse" /> : <FiCpu size={13} />}
            {aiLoading ? "TAYLOR THINKING..." : "TAYLOR'S TAKE"}
          </span>
        </button>
      </div>

      {/* Account chips — only market-variable values */}
      <div className="flex items-center gap-2.5 px-6 py-3 overflow-x-auto" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        {[
          ["SL", market.slLabel, "#f2f5f8"],
          ["LOTS", fmtLots(lots), "#f2f5f8"],
          ["SPREAD", `~${fmtMoney2(tradeCostFor(market))}`, "#c23b30"],
          ["RISK", fmtMoney(ACCOUNT.riskPerTrade), "#8a2f2a"],
        ].map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap"
            style={{ background: "var(--bg-elevated)" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: c, fontFamily: "var(--font-display)" }}>{v}</span>
          </span>
        ))}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="mx-6 mt-5 p-4 rounded-md text-base"
            style={{ background: "rgba(138,47,42,0.1)", color: "#8a2f2a" }}
            variants={fadeUpVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={TRANSITION_BASE}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
      {result && sig ? (
        <motion.div key="result" className="p-6 flex flex-col gap-5" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_BASE}>

          <AnimatePresence mode="wait">
            {opportunity ? (
              <motion.div key={opportunity.phase} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
                <TradeCard
                  opp={opportunity}
                  price={livePrice}
                  bot={botMode}
                  lots={lots}
                  onTakeTrade={onTakeTrade}
                  onMarketEntry={onMarketEntry}
                  onCloseTrade={onCloseTrade}
                  onCheckOpportunity={onCheckOpportunity}
                  checking={checkingOpportunity}
                  onToggleBot={onToggleBot}
                  blockedReason={tradeBlockedReason}
                />
              </motion.div>
            ) : (
              <motion.div
                key="no-setup"
                className="rounded-lg px-5 py-4 text-base"
                style={{ background: "var(--bg-panel)", color: "var(--text-primary)" }}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                No tradeable setup — run a new analysis once the market moves.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Signal + probability gauge */}
          <div className="rounded-lg flex items-center gap-5 px-5 py-4" style={{ background: "var(--bg-panel)" }}>
            <ProbRing value={displayProbability} adjusted={isBlended} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <sig.Icon size={26} color={sig.color} />
                <span className="text-3xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              <div className="text-base mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {probLabel(displayProbability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factors
                {result.penalties.length > 0 && ` · ${result.penalties.length} penalt${result.penalties.length > 1 ? "ies" : "y"}`}
              </div>
              {isBlended && aiTake && (
                <div className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Engine {result.probability}% · Taylor {aiTake.confidenceDelta > 0 ? "+" : ""}{aiTake.confidenceDelta}
                </div>
              )}
            </div>
          </div>

          {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
            <div className="rounded-lg px-5 py-3 text-base" style={{ background: "var(--bg-panel)", color: "var(--text-secondary)" }}>
              Setup window opens in {result.minutesToOpen} min — this is the pre-open bias.
            </div>
          )}

          <AnimatePresence mode="wait">
            {aiLoading ? (
              <motion.div
                key="ai-loading"
                className="rounded-lg px-5 py-4 flex items-center gap-2.5"
                style={{ background: "rgba(255,255,255,0.03)" }}
                variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
              >
                <FiCpu size={14} className="animate-pulse" style={{ color: "var(--text-muted)" }} />
                <span className="text-base" style={{ color: "var(--text-muted)" }}>Taylor&apos;s taking a look…</span>
              </motion.div>
            ) : aiTake ? (
              <motion.div
                key="ai-take"
                className="rounded-lg px-5 py-4"
                style={{ background: AI_VERDICT_STYLE[aiTake.verdict].bg }}
                variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-sm font-black tracking-[0.2em]" style={{ color: AI_VERDICT_STYLE[aiTake.verdict].color }}>
                    <FiCpu size={13} /> {AI_VERDICT_STYLE[aiTake.verdict].label}
                  </div>
                  {aiTake.confidenceDelta !== 0 && (
                    <span className="text-sm font-black" style={{ color: AI_VERDICT_STYLE[aiTake.verdict].color, fontFamily: "var(--font-display)" }}>
                      {aiTake.confidenceDelta > 0 ? "+" : ""}{aiTake.confidenceDelta}
                    </span>
                  )}
                </div>
                <p className="text-lg leading-relaxed" style={{ color: "var(--text-primary)" }}>{aiTake.note}</p>
                {aiTake.keyRisk && (
                  <div className="mt-2 pt-2 text-base" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                    Key risk: {aiTake.keyRisk}
                  </div>
                )}
                {aiProfile?.hasHistory && (
                  <div className="mt-2 pt-2 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
                    Your record: {aiProfile.totalTrades} trades · {aiProfile.winRate}% win rate
                    {aiProfile.planAdherenceRate !== null && ` · ${aiProfile.planAdherenceRate}% plan adherence`}
                  </div>
                )}
              </motion.div>
            ) : aiUnavailable ? (
              <motion.div
                key="ai-unavailable"
                className="px-2 text-sm"
                style={{ color: "var(--text-muted)" }}
                variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
              >
                Taylor&apos;s not available this round.
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Warnings — solo si existen */}
          <AnimatePresence>
            {result.warnings.length > 0 && (
              <motion.div
                className="rounded-lg overflow-hidden"
                variants={fadeUpVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_BASE}
              >
                <div className="flex items-center gap-1.5 py-2.5 text-sm font-black tracking-widest" style={{ background: "rgba(138,47,42,0.1)", color: "var(--text-primary)" }}>
                  <FiAlertTriangle size={13} color="#8a2f2a" /> WARNINGS — READ BEFORE ENTERING
                </div>
                <div className="flex flex-col">
                  {result.warnings.map((w, i) => (
                    <motion.div
                      key={i}
                      className="flex gap-2.5 py-3"
                      style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", background: "var(--bg-elevated)" }}
                      variants={fadeUpVariants}
                      initial="hidden"
                      animate="visible"
                      transition={{ ...TRANSITION_FAST, delay: i * 0.04 }}
                    >
                      <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.severity === "high" ? "#8a2f2a" : "#c23b30" }} />
                      <div className="text-[16px] leading-snug">
                        <span className="font-bold" style={{ color: w.severity === "high" ? "#8a2f2a" : "#c23b30" }}>{w.title}: </span>
                        <span style={{ color: "var(--text-primary)" }}>{w.detail}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      ) : !loading && !error ? (
        <motion.div key="empty" className="flex-1 flex flex-col items-center justify-center px-5 text-center" style={{ color: "var(--text-primary)" }} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_BASE}>
          <FiZap size={48} className="mb-4 opacity-15" />
          <p className="text-lg">Press <strong style={{ color: "var(--gold)" }}>New Analysis</strong> to analyze {market.label}.</p>
          <p className="text-base mt-2 opacity-70">Signal, probability, levels, and live trade tracking.</p>
        </motion.div>
      ) : null}
      </AnimatePresence>

      </motion.div>
      )}
      </AnimatePresence>
      </div>
    </div>
  );
}
