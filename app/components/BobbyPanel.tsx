"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { IconType } from "react-icons";
import {
  FiTrendingUp, FiTrendingDown, FiPauseCircle,
  FiAlertTriangle, FiRefreshCw, FiZap, FiCpu, FiArrowUpRight, FiArrowDownRight, FiCheck, FiX, FiSend,
  FiBarChart2, FiBookOpen, FiCheckSquare, FiHeart,
} from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, type Market } from "../lib/markets";
import { livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";
import { fadeVariants, fadeUpVariants, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";
import { fmtPrice, fmtMoney2, fmtSignedMoney, fmtLots } from "../lib/format";
import { buildAiAnalysisRequest, type AiTake, type AiVerdict } from "../lib/aiTake";
import { buildPredictionProfileSummary, type PredictionProfileSummary } from "../lib/predictionProfile";
import { glassStyle, glassChipStyle } from "../lib/glass";
import JournalPanel from "./JournalPanel";
import ChecklistPanel from "./ChecklistPanel";
import WendyPanel from "./WendyPanel";

export type PanelTab = "analysis" | "journal" | "checklist" | "wendy";
const TABS: { key: PanelTab; label: string; Icon: IconType }[] = [
  { key: "analysis",  label: "ANALYSIS",  Icon: FiBarChart2 },
  { key: "journal",   label: "JOURNAL",   Icon: FiBookOpen },
  { key: "checklist", label: "CHECKLIST", Icon: FiCheckSquare },
  { key: "wendy",     label: "WENDY",     Icon: FiHeart },
];

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; Icon: IconType }> = {
  GO_LONG:  { label: "LONG",  color: "#1c7d4c", bg: "rgba(28,125,76,0.07)",    border: "rgba(28,125,76,0.35)",    Icon: FiTrendingUp },
  GO_SHORT: { label: "SHORT",  color: "#8a2f2a", bg: "rgba(138,47,42,0.07)",    border: "rgba(138,47,42,0.35)",    Icon: FiTrendingDown },
  WAIT:     { label: "WAIT", color: "#f2f5f8", bg: "rgba(255,255,255,0.06)",  border: "rgba(255,255,255,0.24)",  Icon: FiPauseCircle },
};

const AI_VERDICT_STYLE: Record<AiVerdict, { label: string; color: string; bg: string; border: string }> = {
  CONFIRM: { label: "TAYLOR CONFIRMS", color: "#1c7d4c", bg: "rgba(28,125,76,0.07)",  border: "rgba(28,125,76,0.35)" },
  CAUTION: { label: "TAYLOR: CAUTION", color: "#f2f5f8", bg: "rgba(255,255,255,0.06)",  border: "rgba(255,255,255,0.24)" },
  REJECT:  { label: "TAYLOR: REJECT",  color: "#8a2f2a", bg: "rgba(138,47,42,0.08)",  border: "rgba(138,47,42,0.35)" },
};

// One message in Taylor's chat thread. `verdict` is only set on the
// auto-generated "take" message (from the CONFIRM/CAUTION/REJECT button) so
// it can borrow the same color coding as before; free-form Q&A replies have
// no verdict and render in a neutral color.
interface ChatMessage {
  id: string;
  role: "user" | "taylor";
  text: string;
  verdict?: AiVerdict;
}

function composeTakeMessage(take: AiTake, profile: PredictionProfileSummary | null): string {
  const delta = take.confidenceDelta !== 0 ? ` (${take.confidenceDelta > 0 ? "+" : ""}${take.confidenceDelta})` : "";
  const risk = take.keyRisk ? `\n\nKey risk: ${take.keyRisk}` : "";
  // hasHistory only means "at least one prediction was ever logged" — with
  // everything still PENDING (resolvedCount 0) there's nothing to report yet,
  // and "0 resolved calls · 0% hit rate" reads as a bad track record instead
  // of just an empty one.
  const record = profile?.hasHistory && profile.resolvedCount > 0
    ? `\n\nTaylor's record: ${profile.resolvedCount} resolved calls · ${profile.hitRate}% hit rate${profile.invalidatedRate > 0 ? ` · ${profile.invalidatedRate}% invalidated` : ""}`
    : "";
  return `${AI_VERDICT_STYLE[take.verdict].label}${delta} — ${take.note}${risk}${record}`;
}

export const PHASE_META: Record<OppPhase, { label: string; color: string }> = {
  HUNTING:       { label: "HUNTING BREAKOUT",           color: "#9ba5b2" },
  AWAIT_RETEST:  { label: "BREAKOUT — AWAITING RETEST", color: "#f2f5f8" },
  RETEST_ACTIVE: { label: "RETEST ACTIVE",              color: "#ffffff" },
  CONFIRMED:     { label: "TRACKING LIVE",              color: "#1c7d4c" },
  TP_HIT:        { label: "TAKE PROFIT",                color: "#1c7d4c" },
  SL_HIT:        { label: "STOP LOSS",                  color: "#8a2f2a" },
  INVALIDATED:   { label: "SETUP INVALIDATED",          color: "#8a2f2a" },
};


function probLabel(p: number) {
  if (p >= 70) return "HIGH";
  if (p >= 45) return "MEDIUM";
  return "LOW";
}

function formatElapsed(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

// ── Circular probability gauge — colored by the signal's own direction
//    (LONG/SHORT/WAIT), not by how high the probability is, so it always
//    reads as "which way" at a glance instead of "how confident". ─────────
function ProbRing({ value, adjusted, color }: { value: number; adjusted?: boolean; color: string }) {
  const c = color;
  const R = 26;
  const CIRC = 2 * Math.PI * R;
  return (
    <div className="relative w-[64px] h-[64px] shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={R} fill="none"
          stroke={c} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
        {adjusted && (
          <span className="flex items-center gap-0.5 mt-0.5 text-[7px] font-bold tracking-wider" style={{ color: "var(--text-muted)" }}>
            <FiCpu size={6} /> TAYLOR
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


// ── The opportunity card — everything about the tracked call in one place ────
// No trade is ever taken in-app — this tracks whether Taylor's call (TP
// before SL) would have played out. RISK/SPREAD/LOTS and the live $ figure
// stay, on purpose: reference numbers for placing the trade manually.
function OpportunityCard({
  opp, price, lots, onCheckOpportunity, checking,
}: {
  opp: Opportunity;
  price: number | null;
  lots: number;
  onCheckOpportunity: () => void;
  checking: boolean;
}) {
  // Values come from the LIVE opportunity — it can re-anchor to closer levels
  const reward = Math.round((Math.abs(opp.tp - opp.entry) / opp.slPoints) * ACCOUNT.riskPerTrade);
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#1c7d4c" : "#8a2f2a";
  const dist = price !== null ? Math.abs(price - opp.level) : null;

  const pnl = (() => {
    if (opp.phase === "CONFIRMED" && price !== null) return livePnl(opp, price);
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
      statusLine = "Price at the level — holding the candle decides it.";
      break;
    case "CONFIRMED":
      statusLine = `Retest held — tracking live · spread ${fmtMoney2(opp.cost ?? 0)}`;
      break;
    case "TP_HIT":
      statusLine = `Target hit at ${fmtPrice(opp.tp)}. Called it.`;
      break;
    case "SL_HIT":
      statusLine = `Stopped at ${fmtPrice(opp.sl)} — the call was wrong on this one.`;
      break;
    case "INVALIDATED":
      statusLine = "Price reversed before confirming — no call made.";
      break;
  }

  const cardGlass = glassStyle(meta.color);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        ...cardGlass,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33, ${cardGlass.boxShadow}` : cardGlass.boxShadow,
      }}
    >
      {/* Header: phase + resolved-outcome badge + check button + direction pill */}
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: meta.color }} />}
          {isTerminal && (
            <span className="flex items-center justify-center w-4 h-4 rounded-full shrink-0" style={{ background: `${meta.color}22`, color: meta.color }}>
              {opp.phase === "TP_HIT" ? <FiCheck size={11} /> : opp.phase === "SL_HIT" ? <FiX size={11} /> : <FiAlertTriangle size={10} />}
            </span>
          )}
          <span className="font-black text-lg lg:text-base tracking-wider truncate" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isTerminal && (
            <button
              onClick={onCheckOpportunity}
              disabled={checking}
              title="Check current opportunity"
              className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150"
              style={{
                ...glassChipStyle(),
                color: "var(--text-secondary)",
                cursor: checking ? "not-allowed" : "pointer",
              }}
            >
              <FiRefreshCw size={12} className={checking ? "animate-spin" : ""} />
            </button>
          )}
          <span
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] lg:text-[12px] font-black tracking-wider whitespace-nowrap"
            style={{ ...glassChipStyle(dirColor), color: dirColor, fontFamily: "var(--font-display)" }}
          >
            {opp.direction === "long" ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
            {opp.direction === "long" ? "▲ LONG" : "▼ SHORT"} · {fmtLots(lots)} LOTS
          </span>
        </div>
      </div>

      {/* Status + P/L */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-[16px] lg:text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-3xl font-black leading-none" style={{ color: pnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
              {fmtSignedMoney(pnl)}
            </div>
            <div className="text-[12px] lg:text-[11px] font-bold tracking-widest mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {opp.phase === "CONFIRMED" ? "LIVE P/L" : "RESULT"}
            </div>
            {/* Nothing is ever placed by the app — this line exists so the big
                dollar figure never reads as "a transaction just happened". */}
            <div className="text-[10px] lg:text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {opp.phase === "CONFIRMED" ? "reference only — not a placed trade" : "tracked outcome — no trade executed"}
            </div>
          </div>
        )}
      </div>

      {/* Live TP/SL progress — the visual heartbeat of the card: moves with
          every price tick from the moment the retest confirms, so the trader
          can see the call actually playing out instead of a frozen snapshot. */}
      {(opp.phase === "CONFIRMED" || opp.phase === "TP_HIT" || opp.phase === "SL_HIT") && (() => {
        const dirUp = opp.direction === "long";
        const trackPrice = opp.phase === "TP_HIT" ? opp.tp : opp.phase === "SL_HIT" ? opp.sl : (price ?? opp.entry);
        const lo = dirUp ? opp.sl : opp.tp;
        const hi = dirUp ? opp.tp : opp.sl;
        const range = hi - lo || 1;
        const dotPct = Math.max(0, Math.min(100, ((trackPrice - lo) / range) * 100));
        const entryPct = Math.max(0, Math.min(100, ((opp.entry - lo) / range) * 100));
        const toTargetPct = Math.round(Math.max(-100, Math.min(100,
          dirUp ? ((trackPrice - opp.entry) / (opp.tp - opp.entry)) * 100 : ((opp.entry - trackPrice) / (opp.entry - opp.tp)) * 100
        )));
        const dotColor = pnl !== null && pnl >= 0 ? "#1c7d4c" : "#8a2f2a";
        return (
          <div className="px-5 pb-4">
            <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, #8a2f2a55 0%, #8a2f2a22 45%, #1c7d4c22 55%, #1c7d4c55 100%)" }}>
              <div className="absolute top-1/2 w-px h-3.5 -translate-y-1/2" style={{ left: `${entryPct}%`, background: "#d4a72c" }} />
              <div
                className="absolute top-1/2 rounded-full transition-all duration-500"
                style={{ left: `${dotPct}%`, width: 11, height: 11, marginLeft: -5.5, transform: "translateY(-50%)", background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[11px] lg:text-[10px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>
              <span>SL</span>
              <span style={{ color: toTargetPct >= 0 ? "#1c7d4c" : "#8a2f2a" }}>{toTargetPct >= 0 ? toTargetPct : Math.abs(toTargetPct)}% {toTargetPct >= 0 ? "to target" : "toward stop"}</span>
              <span>TP</span>
            </div>
          </div>
        );
      })()}

      {/* Entry / SL / TP strip — live values from the opportunity */}
      <div className="grid grid-cols-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-5 py-3.5">
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#d4a72c" }}>E</div>
          <div className="text-xl lg:text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.entry)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#8a2f2a" }}>SL · {fmtSignedMoney(-ACCOUNT.riskPerTrade)}</div>
          <div className="text-xl lg:text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.sl)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#1c7d4c" }}>TP · {fmtSignedMoney(reward)}</div>
          <div className="text-xl lg:text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.tp)}</div>
        </div>
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
  onCheckOpportunity: () => void;
  checkingOpportunity: boolean;
  onClose?: () => void;
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  onCheckOpportunity, checkingOpportunity, onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>("analysis");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Ticks the "entry-time read · Xm ago" caption forward without calling
  // Date.now() during render (React forbids impure calls mid-render).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // When the current `result` object last changed — used as the "entry-time
  // read" caption's fallback timestamp when there's no opportunity yet (pure
  // WAIT, nothing to anchor to opportunity.startedAt).
  const result = analysis; // analysis state lives in Dashboard (persisted across reloads)

  // AI second-opinion layer — purely advisory, never gates a trade. Tracks
  // the CURRENT opportunity: once generated, a take persists (survives tab
  // switches, live price ticks, phase transitions, even switching to another
  // market and back — cached per symbol below) and only retires when a fresh
  // "New Analysis" supersedes it with a new opportunity for that market.
  const [aiTake, setAiTake] = useState<AiTake | null>(null);
  const [aiProfile, setAiProfile] = useState<PredictionProfileSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // Holds the message to show, not just a flag — lets a rate-limited/
  // overloaded response ("try again shortly") read differently from a
  // harder failure, instead of every kind of AI failure collapsing into one
  // generic "unavailable" string.
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);

  // Taylor's chat thread — starts with the "take" message (same analysis the
  // button always ran, just shown as the first chat bubble instead of a
  // standalone card) and grows with whatever the trader types below. Cached
  // per market the same way aiTake is, cleared on a fresh "New Analysis"
  // since a new opportunity makes the old conversation's context stale.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Last candles fetched by either analyze() or generateComment() — reused
  // for chat replies so every message doesn't need its own market fetch;
  // "good enough" recency for a follow-up question about the same setup.
  const lastCandlesRef = useRef<RawCandle[]>([]);

  // Per-market cache (session-only, not localStorage) so switching over to
  // check another instrument and back restores the take instead of losing
  // it. Refs can't be read or written during render, so both the mirror
  // below and the swap-on-market-change logic live in effects.
  const aiCacheRef = useRef<Record<string, { take: AiTake; profile: PredictionProfileSummary | null }>>({});
  const currentTakeRef = useRef<{ take: AiTake; profile: PredictionProfileSummary | null } | null>(null);
  useEffect(() => {
    currentTakeRef.current = aiTake ? { take: aiTake, profile: aiProfile } : null;
  }, [aiTake, aiProfile]);

  const chatCacheRef = useRef<Record<string, ChatMessage[]>>({});
  const currentChatRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    currentChatRef.current = chatMessages;
  }, [chatMessages]);

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
    setAiUnavailable(null);

    if (currentChatRef.current.length > 0) chatCacheRef.current[prevSymbol] = currentChatRef.current;
    else delete chatCacheRef.current[prevSymbol];
    setChatMessages(chatCacheRef.current[market.symbol] ?? []);

    prevSymbolForCacheRef.current = market.symbol;
  }, [market.symbol]);

  // Fire-and-forget from analyze() — runs after the deterministic engine
  // already has a result, so the "NEW ANALYSIS" spinner clears on its own
  // timing and the AI take pops into its card whenever it lands.
  const fetchAiTake = useCallback(async (fresh: AnalysisResult, candles: RawCandle[], requestSymbol: string) => {
    setAiLoading(true);
    setAiUnavailable(null);
    // Free, synchronous localStorage read — captured once here so the request
    // payload and whatever the UI later shows ("Your record: ...") are always
    // the exact same snapshot, never two different reads that could disagree.
    const profile = buildPredictionProfileSummary();
    try {
      const payload = buildAiAnalysisRequest(fresh, market, candles, profile);
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (marketSymbolRef.current !== requestSymbol) return; // user switched markets — discard
      if (!res.ok) {
        let retryable = false;
        try { retryable = (await res.json())?.retryable === true; } catch { /* body wasn't JSON */ }
        setAiUnavailable(retryable ? "Taylor's overloaded right now — try again in a bit." : "Taylor's not available this round.");
        return;
      }
      const take: AiTake = await res.json();
      setAiTake(take);
      setAiProfile(profile);
      aiCacheRef.current[requestSymbol] = { take, profile };
      lastCandlesRef.current = candles;
      setChatMessages(prev => {
        const next = [...prev, { id: `take-${Date.now()}`, role: "taylor" as const, text: composeTakeMessage(take, profile), verdict: take.verdict }];
        chatCacheRef.current[requestSymbol] = next;
        return next;
      });
    } catch {
      if (marketSymbolRef.current === requestSymbol) setAiUnavailable("Taylor's not available this round.");
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
    setAiUnavailable(null);
    delete aiCacheRef.current[requestSymbol];
    // A fresh setup means the old conversation was about a call that no
    // longer exists — retire the whole thread along with the take.
    setChatMessages([]);
    delete chatCacheRef.current[requestSymbol];
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
      lastCandlesRef.current = analysisCandles;

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
    setAiUnavailable(null);
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
        setAiUnavailable("Taylor's not available this round.");
        setAiLoading(false);
      }
    }
  }, [result, market, loading, aiLoading, fetchAiTake]);

  // Free-form follow-up in the chat bar — separate from the take/comment
  // flows above (still exactly one Claude call per send, only ever
  // triggered by the trader hitting Enter/Send, never automatically).
  // Reuses the last known analysis + candles rather than re-fetching market
  // data on every message, so replies stay fast.
  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !result || chatSending || aiLoading) return;
    const requestSymbol = market.symbol;
    setChatInput("");
    setAiUnavailable(null);
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text };
    const historyForRequest = chatMessages.map(m => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.text }));
    setChatMessages(prev => {
      const next = [...prev, userMsg];
      chatCacheRef.current[requestSymbol] = next;
      return next;
    });
    setChatSending(true);
    try {
      const profile = buildPredictionProfileSummary();
      const context = buildAiAnalysisRequest(result, market, lastCandlesRef.current, profile);
      const res = await fetch("/api/taylor-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, history: historyForRequest, message: text }),
      });
      if (marketSymbolRef.current !== requestSymbol) return; // user switched markets — discard
      if (!res.ok) {
        let retryable = false;
        try { retryable = (await res.json())?.retryable === true; } catch { /* body wasn't JSON */ }
        setAiUnavailable(retryable ? "Taylor's overloaded right now — try again in a bit." : "Taylor's not available this round.");
        return;
      }
      const data: { reply: string } = await res.json();
      setChatMessages(prev => {
        const next = [...prev, { id: `t-${Date.now()}`, role: "taylor" as const, text: data.reply }];
        chatCacheRef.current[requestSymbol] = next;
        return next;
      });
    } catch {
      if (marketSymbolRef.current === requestSymbol) setAiUnavailable("Taylor's not available this round.");
    } finally {
      if (marketSymbolRef.current === requestSymbol) setChatSending(false);
    }
  }, [chatInput, chatMessages, result, market, chatSending, aiLoading]);

  // Auto-scroll the chat thread into view as new messages land.
  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, aiLoading, chatSending]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const lots = lotsFor(market);

  // Display-only blend — never touches result.probability itself, which is
  // what the daily-limit/opportunity-gating logic upstream already consumed
  // synchronously before this AI response could even arrive.
  const displayProbability = result && aiTake
    ? Math.max(0, Math.min(100, result.probability + aiTake.confidenceDelta))
    : result?.probability ?? 0;
  const isBlended = !!(result && aiTake && aiTake.confidenceDelta !== 0);

  // Nearest level to live price, for the "watching" strip — keeps the no-setup
  // state showing something that actually moves (live price + live distance)
  // instead of a flat sentence, even though there's no formal Opportunity yet.
  const nearestLevel = result && livePrice !== null && result.levels.length > 0
    ? result.levels.reduce((a, b) => Math.abs(b.price - livePrice) < Math.abs(a.price - livePrice) ? b : a)
    : null;

  // Shared controls (compact analyze/take buttons + Taylor chat bar) — placed
  // differently depending on where BobbyPanel is mounted: pinned to the
  // bottom on the mobile sheet (thumb reach), inline right under Taylor's
  // chat thread on the desktop aside (onClose is only ever passed on mobile,
  // so it doubles as the mobile/desktop switch here).
  const footerControls = (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={analyze}
          disabled={loading || aiLoading}
          className="flex-1 px-3 py-3.5 rounded-md font-black text-xs sm:text-sm tracking-tight transition-all duration-150"
          style={{
            ...glassChipStyle(),
            color: "var(--text-primary)",
            cursor: loading || aiLoading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            {loading ? <FiRefreshCw size={15} className="animate-spin shrink-0" /> : <FiRefreshCw size={15} className="shrink-0" />}
            {loading ? "LOADING..." : "NEW ANALYSIS"}
          </span>
        </button>
        <button
          onClick={generateComment}
          disabled={!result || loading || aiLoading}
          title={result ? "Ask Taylor for a live read on this setup" : "Run an analysis first"}
          className="flex-1 px-3 py-3.5 rounded-md font-black text-xs sm:text-sm tracking-tight transition-all duration-150"
          style={{
            ...glassChipStyle(),
            color: "var(--text-primary)",
            cursor: !result || loading || aiLoading ? "not-allowed" : "pointer",
            opacity: !result ? 0.5 : 1,
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            {aiLoading ? <FiCpu size={15} className="animate-pulse shrink-0" /> : <FiCpu size={15} className="shrink-0" />}
            {aiLoading ? "THINKING..." : "TAYLOR'S TAKE"}
          </span>
        </button>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          disabled={!result || chatSending || aiLoading}
          placeholder={result ? "Ask Taylor about this setup…" : "Run an analysis first"}
          className="flex-1 min-w-0 px-4 py-4 rounded-md text-base lg:text-sm outline-none"
          style={{
            ...glassChipStyle(),
            color: "var(--text-primary)",
            opacity: !result ? 0.6 : 1,
          }}
        />
        <button
          type="submit"
          disabled={!chatInput.trim() || !result || chatSending || aiLoading}
          title="Send"
          className="flex items-center justify-center w-14 h-14 rounded-md shrink-0 transition-all duration-150"
          style={{
            ...glassChipStyle(),
            color: "var(--text-primary)",
            cursor: !chatInput.trim() || !result || chatSending || aiLoading ? "not-allowed" : "pointer",
            opacity: !chatInput.trim() || !result ? 0.5 : 1,
          }}
        >
          <FiSend size={20} />
        </button>
      </form>
    </>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--ambient-gradient)" }}>

      {/* Logo + close button — mobile sheet only; the analyze/generate-comment buttons used
          to live in this same row, but on narrow screens their tracked-out labels wrapped to
          two lines, so they now live in a footer row pinned to the bottom (thumb reach). On
          desktop lg:order-first pulls that footer back up to where this row used to be, and
          this row hides there since onClose is only passed for the mobile sheet. */}
      {onClose && (
        <div
          className="flex items-center justify-between px-6 py-3 shrink-0 lg:hidden"
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))",
            borderBottom: "1px solid var(--glass-border)",
            backdropFilter: "blur(var(--glass-blur))",
            WebkitBackdropFilter: "blur(var(--glass-blur))",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static PWA header mark, no benefit from next/image's server-side pipeline */}
          <img src="/quantz-logo-header.png" alt="Quantz" className="h-6 w-auto" />
          <button
            onClick={onClose}
            className="p-2.5 rounded-md shrink-0"
            style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: "pointer" }}
          >
            <FiX size={18} />
          </button>
        </div>
      )}

      {/* Tab bar — Analysis (Taylor's read + chat), Journal (manual, editable trade
          ledger — separate from the automatic prediction log), Checklist (pre-trade
          ritual against the actual strategy rules), Wendy (psychology check-in, not
          market analysis). Always visible on both mobile and desktop. */}
      <div
        className="flex items-center gap-1.5 px-4 py-2.5 shrink-0"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
          borderBottom: "1px solid var(--glass-border)",
          backdropFilter: "blur(var(--glass-blur))",
          WebkitBackdropFilter: "blur(var(--glass-blur))",
        }}
      >
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] font-black tracking-wide transition-all duration-150"
              style={{
                ...glassChipStyle(active ? "#f2f5f8" : undefined),
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
              }}
            >
              <tab.Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && (
      <div className="flex-1 overflow-y-auto">
      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="mx-6 mt-5 p-4 rounded-md text-lg lg:text-base"
            style={{ ...glassStyle("#8a2f2a"), color: "#8a2f2a" }}
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
                <OpportunityCard
                  opp={opportunity}
                  price={livePrice}
                  lots={lots}
                  onCheckOpportunity={onCheckOpportunity}
                  checking={checkingOpportunity}
                />
              </motion.div>
            ) : (
              <motion.div
                key="no-setup"
                className="rounded-lg overflow-hidden"
                style={glassStyle()}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                <div className="flex items-center gap-2 px-5 pt-4">
                  <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "#9ba5b2" }} />
                  <span className="font-black text-lg lg:text-base tracking-wider" style={{ color: "#9ba5b2", fontFamily: "var(--font-display)" }}>
                    NO SETUP YET
                  </span>
                </div>
                <div className="px-5 py-3.5 text-[16px] lg:text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {nearestLevel
                    ? `Watching ${nearestLevel.type} at ${fmtPrice(nearestLevel.price)} · ${fmtPrice(Math.abs(livePrice! - nearestLevel.price))} pts away`
                    : "No tradeable setup — run a new analysis once the market moves."}
                </div>
                {livePrice !== null && (
                  <div className="flex items-center gap-1.5 px-5 pb-4 text-[12px] lg:text-[11px] font-bold tracking-widest" style={{ color: "var(--text-secondary)" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#1c7d4c" }} />
                    LIVE · {fmtPrice(livePrice)}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Signal + probability gauge — the verdict itself is a snapshot (see the
              "entry-time read" caption below), but the box is never just sitting
              there: the live price + elapsed-time caption both tick every update. */}
          <div className="rounded-lg px-4 py-3" style={glassStyle(sig.color)}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <sig.Icon size={18} color={sig.color} />
                <span className="text-xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              {livePrice !== null && (
                <div className="flex items-center gap-1.5 text-[12px] lg:text-[11px] font-bold tracking-widest shrink-0" style={{ color: "var(--text-secondary)" }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#1c7d4c" }} />
                  LIVE · {fmtPrice(livePrice)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <ProbRing value={displayProbability} adjusted={isBlended} color={sig.color} />
              <div className="flex-1">
                <div className="text-base lg:text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {probLabel(displayProbability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factors
                  {result.penalties.length > 0 && ` · ${result.penalties.length} penalt${result.penalties.length > 1 ? "ies" : "y"}`}
                </div>
                {isBlended && aiTake && (
                  <div className="text-sm lg:text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Engine {result.probability}% · Taylor {aiTake.confidenceDelta > 0 ? "+" : ""}{aiTake.confidenceDelta}
                  </div>
                )}
                {/* This verdict is a snapshot from when the analysis ran — it never
                    recomputes on its own. The opportunity card (or the watching strip
                    above, before one exists) is the live piece that ticks with price. */}
                {opportunity && (
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Entry-time read · {formatElapsed(now - opportunity.startedAt)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
            <div className="rounded-lg px-5 py-3 text-lg lg:text-base" style={{ ...glassStyle(), color: "var(--text-secondary)" }}>
              Setup window opens in {result.minutesToOpen} min — this is the pre-open bias.
            </div>
          )}

          {/* Taylor's chat thread — the "take" (from the button) lands as the first
              bubble, then whatever the trader types in the footer bar keeps the
              conversation going. Everything here is grounded in the same market
              context the take used (see buildAiAnalysisRequest in sendChatMessage). */}
          {(chatMessages.length > 0 || aiLoading || chatSending || aiUnavailable) && (
            <div className="flex flex-col gap-3">
              {chatMessages.map(m => (
                <motion.div
                  key={m.id}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                  variants={fadeUpVariants} initial="hidden" animate="visible" transition={TRANSITION_FAST}
                >
                  <div
                    className="rounded-lg px-4 py-3 max-w-[88%] whitespace-pre-wrap text-lg lg:text-sm leading-relaxed"
                    style={
                      m.role === "user"
                        ? { ...glassChipStyle(), color: "var(--text-secondary)" }
                        : { ...glassChipStyle(m.verdict ? AI_VERDICT_STYLE[m.verdict].color : undefined), color: "var(--text-secondary)" }
                    }
                  >
                    {m.role === "taylor" && (
                      <div
                        className="flex items-center gap-1.5 mb-1 text-sm lg:text-xs font-black tracking-[0.15em]"
                        style={{ color: m.verdict ? AI_VERDICT_STYLE[m.verdict].color : "var(--text-muted)" }}
                      >
                        <FiCpu size={11} /> {m.verdict ? AI_VERDICT_STYLE[m.verdict].label : "TAYLOR"}
                      </div>
                    )}
                    {m.text}
                  </div>
                </motion.div>
              ))}

              <AnimatePresence>
                {(aiLoading || chatSending) && (
                  <motion.div
                    key="taylor-typing"
                    className="flex justify-start"
                    variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
                  >
                    <div className="rounded-lg px-4 py-3 flex items-center gap-2.5" style={glassChipStyle()}>
                      <FiCpu size={14} className="animate-pulse" style={{ color: "var(--text-muted)" }} />
                      <span className="text-lg lg:text-base" style={{ color: "var(--text-muted)" }}>
                        {aiLoading ? "Taylor's taking a look…" : "Taylor's typing…"}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {aiUnavailable && !aiLoading && !chatSending && (
                <div className="px-2 text-base lg:text-sm" style={{ color: "var(--text-muted)" }}>{aiUnavailable}</div>
              )}

              <div ref={chatScrollRef} />
            </div>
          )}

          {/* Desktop only (no onClose = the desktop aside, not the mobile sheet) — the
              analyze/take buttons + chat bar sit right under Taylor's thread instead of
              pinned to the panel edge, since there's no thumb-reach constraint here. */}
          {!onClose && (
            <div className="rounded-lg px-5 py-4 flex flex-col gap-3" style={glassStyle()}>
              {footerControls}
            </div>
          )}

        </motion.div>
      ) : !loading && !error ? (
        <motion.div key="empty" className="flex-1 flex flex-col items-center justify-center px-5 text-center" style={{ color: "var(--text-secondary)" }} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_BASE}>
          <FiZap size={48} className="mb-4 opacity-15" />
          <p className="text-xl lg:text-lg">Press <strong style={{ color: "var(--gold)" }}>New Analysis</strong> to analyze {market.label}.</p>
          <p className="text-lg lg:text-base mt-2 opacity-70">Signal, probability, levels, and live trade tracking.</p>
        </motion.div>
      ) : null}
      </AnimatePresence>

      </div>
      )}

      {activeTab === "journal" && (
        <div className="flex-1 overflow-y-auto">
          <JournalPanel />
        </div>
      )}

      {activeTab === "checklist" && (
        <div className="flex-1 overflow-y-auto">
          <ChecklistPanel />
        </div>
      )}

      {activeTab === "wendy" && (
        <div className="flex-1 overflow-hidden">
          <WendyPanel />
        </div>
      )}

      {/* Mobile only — pinned to the bottom so the controls stay in thumb reach.
          Desktop renders the same footerControls inline, right under Taylor's
          thread instead (see the block right before the Warnings section).
          Analysis tab only — Journal/Checklist have their own in-content controls,
          Wendy carries her own input bar inside WendyPanel. */}
      {onClose && activeTab === "analysis" && (
        <div
          className="flex flex-col gap-2 px-4 py-3 shrink-0"
          style={{
            background: "linear-gradient(0deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))",
            borderTop: "1px solid var(--glass-border)",
            backdropFilter: "blur(var(--glass-blur))",
            WebkitBackdropFilter: "blur(var(--glass-blur))",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {footerControls}
        </div>
      )}
    </div>
  );
}
