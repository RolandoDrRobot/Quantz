"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { IconType } from "react-icons";
import {
  FiTrendingUp, FiTrendingDown, FiPauseCircle,
  FiAlertTriangle, FiRefreshCw, FiZap, FiCpu, FiArrowUpRight, FiArrowDownRight, FiCheck, FiX, FiSend,
  FiBarChart2, FiBookOpen, FiHeart, FiClock,
} from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, type Market } from "../lib/markets";
import type { Opportunity, OppPhase } from "../lib/opportunity";
import { fadeVariants, fadeUpVariants, TRANSITION_BASE, TRANSITION_FAST } from "../lib/motionVariants";
import { fmtPrice, fmtMoney2, fmtSignedMoney, fmtLots } from "../lib/format";
import { buildAiAnalysisRequest, type AiTake, type AiVerdict } from "../lib/aiTake";
import { buildPredictionProfileSummary, type PredictionProfileSummary } from "../lib/predictionProfile";
import { glassStyle, glassChipStyle } from "../lib/glass";
import { getSessionInfo, sessionColor } from "../lib/sessions";
import JournalPanel from "./JournalPanel";
import WendyPanel from "./WendyPanel";

export type PanelTab = "analysis" | "journal" | "wendy";
const TABS: { key: PanelTab; label: string; Icon: IconType }[] = [
  { key: "analysis", label: "ANALYSIS", Icon: FiBarChart2 },
  { key: "journal",  label: "JOURNAL",  Icon: FiBookOpen },
  { key: "wendy",    label: "WENDY",    Icon: FiHeart },
];

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; Icon: IconType }> = {
  GO_LONG:  { label: "LONG",  color: "#1c7d4c", Icon: FiTrendingUp },
  GO_SHORT: { label: "SHORT",  color: "#8a2f2a", Icon: FiTrendingDown },
  WAIT:     { label: "WAIT", color: "#f2f5f8", Icon: FiPauseCircle },
};

const AI_VERDICT_STYLE: Record<AiVerdict, { label: string; color: string }> = {
  CONFIRM: { label: "TAYLOR CONFIRMS", color: "#1c7d4c" },
  CAUTION: { label: "TAYLOR: CAUTION", color: "#f2f5f8" },
  REJECT:  { label: "TAYLOR: REJECT",  color: "#8a2f2a" },
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


// ── Shared probability row — the ring + factor breakdown, small and secondary
//    now that it lives inside the same card as the phase/direction header
//    instead of its own separate box. `showSignalLabel` skips repeating
//    LONG/SHORT/WAIT when a direction pill is already shown elsewhere on
//    the same card (the opportunity header) — only the no-setup card (no
//    direction pill of its own) needs the label here to know the bias.
function ProbRow({
  sig, displayProbability, isBlended, aiTake, result, opportunity, now, showSignalLabel,
}: {
  sig: { label: string; color: string; Icon: IconType };
  displayProbability: number;
  isBlended: boolean;
  aiTake: AiTake | null;
  result: AnalysisResult;
  opportunity: Opportunity | null;
  now: number;
  showSignalLabel: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <ProbRing value={displayProbability} adjusted={isBlended} color={sig.color} />
      <div className="flex-1 min-w-0">
        {showSignalLabel && (
          <div className="flex items-center gap-1.5">
            <sig.Icon size={14} color={sig.color} />
            <span className="text-sm font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
          </div>
        )}
        <div className="text-sm lg:text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          {probLabel(displayProbability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factors
          {result.penalties.length > 0 && ` · ${result.penalties.length} penalt${result.penalties.length > 1 ? "ies" : "y"}`}
        </div>
        {isBlended && aiTake && (
          <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Engine {result.probability}% · Taylor {aiTake.confidenceDelta > 0 ? "+" : ""}{aiTake.confidenceDelta}
          </div>
        )}
        {/* This verdict is a snapshot from when the analysis ran — it never
            recomputes on its own; the rest of this card is the live piece
            that ticks with price. */}
        {opportunity && (
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Entry-time read · {formatElapsed(now - opportunity.startedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── The opportunity card — everything about the tracked call in one place ────
// No trade is ever taken in-app — this tracks whether Taylor's call (TP
// before SL) would have played out. RISK/SPREAD/LOTS and the live $ figure
// stay, on purpose: reference numbers for placing the trade manually. Also
// folds in the probability/signal read (ProbRow) — that used to be its own
// separate card right below this one; merged so the whole picture for this
// setup lives in one compact surface instead of two.
function OpportunityCard({
  opp, price, lots, onCheckOpportunity, checking, sig, displayProbability, isBlended, aiTake, result, now,
}: {
  opp: Opportunity;
  price: number | null;
  lots: number;
  onCheckOpportunity: () => void;
  checking: boolean;
  sig: { label: string; color: string; Icon: IconType };
  displayProbability: number;
  isBlended: boolean;
  aiTake: AiTake | null;
  result: AnalysisResult;
  now: number;
}) {
  // Values come from the LIVE opportunity — it can re-anchor to closer levels
  const reward = Math.round((Math.abs(opp.tp - opp.entry) / opp.slPoints) * ACCOUNT.riskPerTrade);
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#1c7d4c" : "#8a2f2a";
  const dist = price !== null ? Math.abs(price - opp.level) : null;

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

  return (
    <div
      className="rounded-md overflow-hidden"
      style={glassStyle(meta.color)}
    >
      {/* Header: phase + resolved-outcome badge + check button + direction pill */}
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: meta.color }} />}
          {isTerminal && (
            <span className="flex items-center justify-center w-4 h-4 rounded-md shrink-0" style={{ background: `${meta.color}22`, color: meta.color }}>
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
              className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150"
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
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[13px] lg:text-[12px] font-black tracking-wider whitespace-nowrap"
            style={{ ...glassChipStyle(dirColor), color: dirColor, fontFamily: "var(--font-display)" }}
          >
            {opp.direction === "long" ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
            {opp.direction === "long" ? "▲ LONG" : "▼ SHORT"} · {fmtLots(lots)} LOTS
          </span>
        </div>
      </div>

      {/* Status */}
      <div className="px-5 pt-3">
        <p className="text-[16px] lg:text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>{statusLine}</p>
      </div>

      {/* Probability read — no signal label here, the direction pill above
          already says LONG/SHORT/WAIT. */}
      <ProbRow
        sig={sig} displayProbability={displayProbability} isBlended={isBlended} aiTake={aiTake}
        result={result} opportunity={opp} now={now} showSignalLabel={false}
      />

      {/* Entry / SL / TP strip — live values from the opportunity */}
      <div className="grid grid-cols-3">
        <div className="px-5 py-3.5">
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#d4a72c" }}>E</div>
          <div className="text-base lg:text-sm font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.entry)}</div>
        </div>
        <div className="px-5 py-3.5">
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#8a2f2a" }}>SL · {fmtSignedMoney(-ACCOUNT.riskPerTrade)}</div>
          <div className="text-base lg:text-sm font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.sl)}</div>
        </div>
        <div className="px-5 py-3.5">
          <div className="text-[11px] lg:text-[10px] font-bold tracking-[0.2em]" style={{ color: "#1c7d4c" }}>TP · {fmtSignedMoney(reward)}</div>
          <div className="text-base lg:text-sm font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{fmtPrice(opp.tp)}</div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  market: Market;
  analysis: AnalysisResult | null;
  opportunity: Opportunity | null;
  livePrice: number | null;
  onCheckOpportunity: () => void;
  checkingOpportunity: boolean;
  onClose?: () => void;
}

export default function BobbyPanel({
  market, analysis, opportunity, livePrice,
  onCheckOpportunity, checkingOpportunity, onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>("analysis");

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

  // AI second-opinion layer — purely advisory, never gates a trade, and
  // always manually triggered ("TAYLOR'S TAKE" button below) — the engine's
  // own auto-analysis re-runs every couple seconds as price moves, but never
  // calls the AI on its own. A take persists (survives tab switches, live
  // price ticks, phase transitions, even switching to another market and
  // back — cached per symbol below) until asked for again on this market.
  const [aiTake, setAiTake] = useState<AiTake | null>(null);
  const [aiProfile, setAiProfile] = useState<PredictionProfileSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // Holds the message to show, not just a flag — lets a rate-limited/
  // overloaded response ("try again shortly") read differently from a
  // harder failure, instead of every kind of AI failure collapsing into one
  // generic "unavailable" string.
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);

  // Taylor's chat thread — starts with the "take" message (same read the
  // button always ran, just shown as the first chat bubble instead of a
  // standalone card) and grows with whatever the trader types below. Cached
  // per market the same way aiTake is (see the swap effect below).
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Last candles fetched by generateComment() — reused for chat replies so
  // every message doesn't need its own market fetch;
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

  // Tracks which symbol is currently selected so an in-flight fetch
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

  // Fire-and-forget from generateComment() (the "TAYLOR'S TAKE" button) —
  // the take pops into its card, and the chat thread, whenever it lands.
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

  // Separate, explicit trigger for Taylor's comment — a Claude call only
  // happens when the user asks for it, never automatically as the engine's
  // own auto-analysis re-runs. Re-fetches live market data itself (so the
  // comment reflects price action right now) but reuses the current
  // deterministic `result` rather than re-running the analysis engine.
  const generateComment = useCallback(async () => {
    if (!result || aiLoading) return;
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
  }, [result, market, aiLoading, fetchAiTake]);

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

  // Shared controls (Taylor's Take button + chat bar) — placed differently
  // depending on where BobbyPanel is mounted: pinned to the bottom on the
  // mobile sheet (thumb reach), inline right under Taylor's chat thread on
  // the desktop aside (onClose is only ever passed on mobile, so it doubles
  // as the mobile/desktop switch here).
  const footerControls = (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          disabled={!result || chatSending || aiLoading}
          placeholder={result ? "Ask Taylor about this setup…" : "Waiting for the market to load…"}
          className="flex-1 min-w-0 px-4 py-4 rounded text-base lg:text-sm outline-none"
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
          className="flex items-center justify-center w-14 h-14 rounded shrink-0 transition-all duration-150"
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

      <button
        onClick={generateComment}
        disabled={!result || aiLoading}
        title={result ? "Ask Taylor for a live read on this setup" : "Waiting for the market to load…"}
        className="w-full px-3 py-3.5 rounded font-black text-xs sm:text-sm tracking-tight transition-all duration-150"
        style={{
          ...glassChipStyle(),
          color: "var(--text-primary)",
          cursor: !result || aiLoading ? "not-allowed" : "pointer",
          opacity: !result ? 0.5 : 1,
          fontFamily: "var(--font-display)",
        }}
      >
        <span className="flex items-center justify-center gap-1.5 whitespace-nowrap">
          {aiLoading ? <FiCpu size={15} className="animate-pulse shrink-0" /> : <FiCpu size={15} className="shrink-0" />}
          {aiLoading ? "THINKING..." : "TAYLOR'S TAKE"}
        </span>
      </button>
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
          style={{ background: "var(--bg-panel)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static PWA header mark, no benefit from next/image's server-side pipeline */}
          <img src="/quantz-logo-header.png" alt="Quantz" className="h-6 w-auto" />
          <button
            onClick={onClose}
            className="p-2.5 rounded shrink-0"
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
        style={{ background: "var(--bg-panel)" }}
      >
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 flex flex-row items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-black tracking-wide transition-all duration-150"
              style={{
                ...glassChipStyle(active ? "#f2f5f8" : undefined),
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
              }}
            >
              <tab.Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && (
      <div className="flex-1 overflow-y-auto">
      <AnimatePresence mode="wait">
      {result && sig ? (
        <motion.div key="result" className="p-6 flex flex-col gap-5" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_BASE}>

          {/* Session intelligence — specific to this exact instrument, not a
              generic world-clock. `now` (ticking every 30s) is what keeps this
              re-rendering; getSessionInfo() itself reads the real clock fresh
              on every call. */}
          {(() => {
            void now; // re-render dependency only — getSessionInfo reads the clock itself
            const session = getSessionInfo(market.key);
            const color = sessionColor(session.quality);
            return (
              <div className="rounded-md px-5 py-3.5" style={glassStyle(session.quality === "good" ? color : undefined)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FiClock size={15} style={{ color }} className="shrink-0" />
                    <span className="font-black text-sm tracking-wider truncate" style={{ color, fontFamily: "var(--font-display)" }}>
                      {session.label}
                    </span>
                  </div>
                  {session.nextLabel && (
                    <span className="text-[11px] font-bold tracking-wide shrink-0" style={{ color: "var(--text-muted)" }}>
                      {session.nextLabel}
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>{session.note}</p>
              </div>
            );
          })()}

          {/* Opportunity + signal read, merged into one compact card — this used to
              be two separate boxes stacked on top of each other (the tracked-call
              card and a standalone probability gauge). ProbRow folds the ring/
              factor breakdown into whichever card is showing. */}
          <AnimatePresence mode="wait">
            {opportunity ? (
              <motion.div key={opportunity.phase} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
                <OpportunityCard
                  opp={opportunity}
                  price={livePrice}
                  lots={lots}
                  onCheckOpportunity={onCheckOpportunity}
                  checking={checkingOpportunity}
                  sig={sig}
                  displayProbability={displayProbability}
                  isBlended={isBlended}
                  aiTake={aiTake}
                  result={result}
                  now={now}
                />
              </motion.div>
            ) : (
              <motion.div
                key="no-setup"
                className="rounded-md overflow-hidden"
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
                <div className="px-5 pt-3 text-[16px] lg:text-[14px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {nearestLevel
                    ? `Watching ${nearestLevel.type} at ${fmtPrice(nearestLevel.price)} · ${fmtPrice(Math.abs(livePrice! - nearestLevel.price))} pts away`
                    : "No tradeable setup — run a new analysis once the market moves."}
                </div>
                <ProbRow
                  sig={sig} displayProbability={displayProbability} isBlended={isBlended} aiTake={aiTake}
                  result={result} opportunity={null} now={now} showSignalLabel
                />
                {livePrice !== null && (
                  <div className="flex items-center gap-1.5 px-5 pb-4 text-[12px] lg:text-[11px] font-bold tracking-widest" style={{ color: "var(--text-secondary)" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#1c7d4c" }} />
                    LIVE · {fmtPrice(livePrice)}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
            <div className="rounded-md px-5 py-3 text-lg lg:text-base" style={{ ...glassStyle(), color: "var(--text-secondary)" }}>
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
                    className="rounded-md px-4 py-3 max-w-[88%] whitespace-pre-wrap text-lg lg:text-sm leading-relaxed"
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
                    <div className="rounded-md px-4 py-3 flex items-center gap-2.5" style={glassChipStyle()}>
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
              take button + chat bar sit right under Taylor's thread instead of pinned
              to the panel edge, since there's no thumb-reach constraint here. */}
          {!onClose && (
            <div className="rounded-md px-5 py-4 flex flex-col gap-3" style={glassStyle()}>
              {footerControls}
            </div>
          )}

        </motion.div>
      ) : (
        <motion.div key="empty" className="flex-1 flex flex-col items-center justify-center px-5 pt-10 text-center" style={{ color: "var(--text-secondary)" }} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_BASE}>
          <FiZap size={48} className="mb-4 opacity-15 animate-pulse" />
          <p className="text-xl lg:text-lg">Reading {market.label}…</p>
          <p className="text-lg lg:text-base mt-2 opacity-70">Signal, probability, and levels update automatically as price moves.</p>
        </motion.div>
      )}
      </AnimatePresence>

      </div>
      )}

      {activeTab === "journal" && (
        <div className="flex-1 overflow-y-auto">
          <JournalPanel />
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
            background: "var(--bg-panel)",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {footerControls}
        </div>
      )}
    </div>
  );
}
