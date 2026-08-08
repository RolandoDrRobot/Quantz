"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiBarChart2, FiZap, FiTrendingUp, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";
import { LuListChecks, LuBrainCircuit, LuNotebookPen, LuNewspaper } from "react-icons/lu";
import AxeChart from "./AxeChart";
import BobbyPanel, { PHASE_META, Clock } from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, TradeSetup, BreakoutEvent } from "../lib/analysis";
import { MARKETS, type MarketKey } from "../lib/markets";
import RecordsModal from "./RecordsModal";
import PlaybookModal from "./PlaybookModal";
import JournalModal from "./JournalModal";
import NewsModal from "./NewsModal";
import type { NewsArticle } from "../lib/news";
import { createOpportunity, advanceOpportunity, takeTrade, enterAtMarket, closeTrade, livePnl, type Opportunity } from "../lib/opportunity";
import { playBreakoutSound, playRetestSound, playResolvedSound } from "../lib/alerts";
import { toast } from "sonner";
import { addRecord, loadRecords, getTodayRecords } from "../lib/records";
import { ACCOUNT, tradeCostFor, lotsFor } from "../lib/markets";
import { popVariants, fadeVariants, TRANSITION_BASE, TRANSITION_SHEET, TRANSITION_FAST, TRANSITION_APP } from "../lib/motionVariants";
import { fmtPrice, fmtSignedPct, fmtSignedMoney, fmtLots, fmtRatio } from "../lib/format";
import { resampleCandles, TIMEFRAMES, type Timeframe } from "../lib/candles";

const MARKET_KEYS: MarketKey[] = ["nasdaq", "dowjones", "gold", "bitcoin", "ethereum"];

const STORAGE_MARKET = "axe-market";
const storageKey = (symbol: string) => `axe-analysis-${symbol}`;
const MAX_AGE_MS = 24 * 3600 * 1000;

function saveState(symbol: string, analysis: AnalysisResult | null, opportunity: Opportunity | null) {
  try {
    if (!analysis) return;
    localStorage.setItem(storageKey(symbol), JSON.stringify({ analysis, opportunity, savedAt: Date.now() }));
  } catch { /* storage unavailable */ }
}

// In a thin/quiet session the 1m range can be smaller than the market's own
// SL distance — at that point 1m bars are just tick noise, not signal, so
// fall back to 5m for a readable chart.
function pickChartCandles(c1m: RawCandle[], c5m: RawCandle[], slPoints: number): RawCandle[] {
  if (c1m.length < 10) return c5m.slice(-500);
  const window = c1m.slice(-120);
  const range = Math.max(...window.map(c => c.high)) - Math.min(...window.map(c => c.low));
  if (range < slPoints * 0.5) return c5m.slice(-500);
  return c1m;
}

function TimeframeSelector({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) {
  return (
    <div className="flex items-center rounded-md overflow-hidden shrink-0" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
      {TIMEFRAMES.map(tf => (
        <button
          key={tf.key}
          onClick={() => onChange(tf.key)}
          className="px-2.5 py-1.5 text-[11px] font-black tracking-wider"
          style={{
            background: value === tf.key ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
            color: value === tf.key ? "var(--text-primary)" : "var(--text-muted)",
            fontFamily: "var(--font-display)",
            cursor: "pointer",
          }}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}

// Tailwind's `lg:hidden` / `hidden lg:flex` only toggle CSS display — React
// still mounts both layout trees regardless of viewport, which used to mean
// two live AxeChart instances (two WebSocket connections, two chart engines
// doing live-tick work) and two BobbyPanel instances running at all times,
// one of them permanently invisible. This renders only the layout that's
// actually showing. Returns null until the first effect runs (no `window`
// during SSR), so there's one blank frame on load — a fair trade for not
// running a full invisible second app in the background all session.
function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)"); // matches Tailwind's `lg:` breakpoint
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  return isDesktop;
}

export default function Dashboard() {
  const isDesktop = useIsDesktop();
  const [market, setMarket] = useState<MarketKey>("nasdaq");
  const [rawCandles1m, setRawCandles1m] = useState<RawCandle[]>([]);
  const [rawCandles5m, setRawCandles5m] = useState<RawCandle[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [botMode, setBotMode] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsTicker, setNewsTicker] = useState<NewsArticle[]>([]);
  const [taylorOpen, setTaylorOpen] = useState(false);
  const [checkingOpportunity, setCheckingOpportunity] = useState(false);
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [isStale, setIsStale] = useState(false);

  const cfg = MARKETS[market];
  const analysisRef = useRef<AnalysisResult | null>(null);
  const symbolRef = useRef(cfg.symbol);
  const botModeRef = useRef(botMode);
  const marketShortRef = useRef<string>(cfg.short);
  const livePriceRef = useRef<number | null>(null);
  // Mirrors AxeChart's own "no WS source" check — a market with neither
  // (currently only Gold) already runs its own 5s poll to this same
  // /api/tick endpoint as its PRIMARY feed. Duplicating that from the
  // safety-net poll below doubles the request rate for no added coverage.
  const hasOwnTickPollRef = useRef(!cfg.coinbaseProduct && !cfg.tdSymbol);
  // Every live price — WS tick, Gold's poll, the safety-net poll, a manual
  // check — funnels through advancePrice(), so "time since the last call"
  // is a single, source-agnostic staleness signal. Every poller in this app
  // used to fail silently (a dead feed just stopped updating with zero
  // on-screen sign); this is what turns that into something visible.
  // 0, not Date.now() — the market-load effect below (which also runs on
  // mount) sets the real value inside its own effect body; a literal here
  // keeps this a pure render instead of an impure call on every re-render.
  const lastTickAtRef = useRef(0);

  // Callbacks (handleTick, recordTrade, etc.) read these refs instead of
  // closing over state, so they always see the latest value without being
  // recreated every render — synced here rather than during render.
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
  useEffect(() => { symbolRef.current = cfg.symbol; }, [cfg.symbol]);
  useEffect(() => { botModeRef.current = botMode; }, [botMode]);
  useEffect(() => { marketShortRef.current = cfg.short; }, [cfg.short]);
  useEffect(() => { hasOwnTickPollRef.current = !cfg.coinbaseProduct && !cfg.tdSymbol; }, [cfg.coinbaseProduct, cfg.tdSymbol]);
  useEffect(() => { livePriceRef.current = livePrice; }, [livePrice]);

  // News ticker feed — scoped to the selected market, so switching markets
  // reloads it. The server keeps one shared cache of all 5 markets' news
  // underneath (see /api/news), so this reload is cheap — it never triggers
  // a fresh Finnhub fetch on its own, just a re-filter of already-cached data.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setNewsTicker([]);
    const load = () => {
      fetch(`/api/news?market=${market}`, { cache: "no-store" })
        .then(r => r.json())
        .then(data => { if (!cancelled && Array.isArray(data.articles)) setNewsTicker(data.articles); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [market]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const opportunityRef = useRef<Opportunity | null>(null);
  const updateOpportunity = useCallback((next: Opportunity | null) => {
    opportunityRef.current = next;
    setOpportunity(next);
  }, []);

  const recordTrade = useCallback((opp: Opportunity, outcome: "TP" | "SL" | "MANUAL", exit: number) => {
    const pnl = livePnl(opp, exit);
    addRecord({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: Date.now(),
      market: marketShortRef.current,
      direction: opp.direction,
      entry: opp.entry,
      exit,
      outcome,
      pnl,
      rMultiple: parseFloat((pnl / ACCOUNT.riskPerTrade).toFixed(2)),
      probability: opp.analysisProbability,
    });
    setRecordsVersion(v => v + 1);
  }, []);

  // Playbook rules #19 ("1-2 trades a day") and #24 ("stop after two losses")
  // used to be honor-system checklist text only — nothing actually stopped a
  // third trade or a third loss from happening. This enforces them: the bot
  // won't auto-confirm a retest, and the manual entry buttons refuse, once
  // either limit is hit for the day (Costa Rica local day).
  const DAILY_TRADE_LIMIT = 2;
  const DAILY_LOSS_LIMIT = 2;
  const todayStats = useMemo(() => {
    const today = getTodayRecords(loadRecords());
    return { count: today.length, losses: today.filter(r => r.pnl < 0).length };
  }, [recordsVersion]);
  const dailyLimitReason = todayStats.count >= DAILY_TRADE_LIMIT
    ? `Daily limit reached — ${todayStats.count} trades today. That's the plan, not a suggestion.`
    : todayStats.losses >= DAILY_LOSS_LIMIT
      ? `Daily stop reached — ${todayStats.losses} losses today. Protect the account, come back tomorrow.`
      : null;
  const dailyLimitReasonRef = useRef<string | null>(null);
  useEffect(() => { dailyLimitReasonRef.current = dailyLimitReason; }, [dailyLimitReason]);

  // Reading localStorage during the initial render (e.g. a useState
  // initializer) would desync the static server-prerendered HTML from the
  // client's first paint. Applying the saved value post-mount is what avoids
  // that hydration mismatch, so this intentionally sets state from an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MARKET) as MarketKey | null;
      if (saved && MARKETS[saved]) setMarket(saved);
      const bot = localStorage.getItem("axe-bot-mode");
      if (bot !== null) setBotMode(bot === "true");
    } catch { /* storage unavailable */ }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Resets chart/analysis state whenever the selected market changes, then
  // loads that market's data — the reset has to run as a side effect since it
  // depends on cfg.symbol changing, not just on mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setRawCandles1m([]);
    setRawCandles5m([]);
    setAnalysis(null);
    updateOpportunity(null);
    setLivePrice(null);
    setChartLoading(true);
    lastTickAtRef.current = Date.now(); // don't flag stale mid-switch before the new feed connects
    setIsStale(false);
    let cancelled = false;

    fetch(`/api/market?symbol=${encodeURIComponent(cfg.symbol)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const c1m: RawCandle[] = data.candles1m ?? [];
        const c5m: RawCandle[] = data.candles5m ?? [];
        setRawCandles1m(c1m);
        setRawCandles5m(c5m);
        try {
          const raw = localStorage.getItem(storageKey(cfg.symbol));
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.analysis && Date.now() - (saved.savedAt ?? 0) < MAX_AGE_MS) {
              setAnalysis(saved.analysis);
              updateOpportunity(saved.opportunity ?? null);
            }
          }
        } catch { /* corrupt entry */ }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChartLoading(false); });

    return () => { cancelled = true; };
  }, [cfg.symbol, cfg.slPoints, updateOpportunity]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAnalysis = useCallback((result: AnalysisResult, c5m: RawCandle[], c1m: RawCandle[]) => {
    setRawCandles1m(c1m);
    setRawCandles5m(c5m);
    setAnalysis(result);
    const opp = createOpportunity(result, MARKETS[market].slPoints, tradeCostFor(MARKETS[market]));
    updateOpportunity(opp);
    saveState(MARKETS[market].symbol, result, opp);
    const sig = result.signal === "GO_LONG" ? "▲ long" : result.signal === "GO_SHORT" ? "▼ short" : "wait";
    toast(`taylor · ${sig} · ${result.probability}%`, { duration: 3000 });
  }, [market, updateOpportunity]);

  // Shared by both the live WS tick stream and the manual "check opportunity"
  // button, so a manual check goes through exactly the same state machine —
  // announce is only set for the manual path, to report back even when
  // nothing changed (the WS path stays silent unless the phase moves).
  const advancePrice = useCallback((price: number, announce = false) => {
    lastTickAtRef.current = Date.now();
    setLivePrice(price);
    livePriceRef.current = price;
    const prev = opportunityRef.current;
    if (!prev) {
      if (announce) toast(`Price updated · ${fmtPrice(price)}`, { duration: 2500 });
      return;
    }
    const next = advanceOpportunity(prev, price, botModeRef.current && !dailyLimitReasonRef.current, analysisRef.current?.levels ?? []);
    opportunityRef.current = next;
    const levelChanged = next.level !== prev.level;
    const transitioned = next.phase !== prev.phase || levelChanged;
    if (transitioned) {
      setOpportunity(next);
      if (levelChanged) playBreakoutSound();
      else if (next.phase === "AWAIT_RETEST" && prev.phase === "HUNTING") {
        playBreakoutSound();
        toast(`breakout ${next.direction === "long" ? "▲" : "▼"} ${fmtPrice(next.level)} — awaiting retest`, { duration: 5000 });
      }
      else if (next.phase === "RETEST_ACTIVE") {
        playRetestSound();
        toast.warning(`retest active · ${fmtPrice(next.level)}`, { duration: 6000 });
      }
      else if (next.phase === "TP_HIT") {
        playResolvedSound(true);
        recordTrade(next, "TP", next.tp);
        toast.success(`tp · ${fmtPrice(next.tp)}`, { duration: 4000 });
      }
      else if (next.phase === "SL_HIT") {
        playResolvedSound(false);
        recordTrade(next, "SL", next.sl);
        toast.error(`sl · ${fmtPrice(next.sl)}`, { duration: 4000 });
      }
      saveState(symbolRef.current, analysisRef.current, next);
    }
    if (announce && !transitioned) {
      const pnl = next.phase === "CONFIRMED" ? livePnl(next, price) : null;
      const pnlPart = pnl !== null ? ` · ${fmtSignedMoney(pnl)}` : "";
      toast(`No change · ${PHASE_META[next.phase].label} · ${fmtPrice(price)}${pnlPart}`, { duration: 3500 });
    }
  }, [recordTrade]);

  const handleTick = useCallback((price: number) => advancePrice(price), [advancePrice]);

  const handleCheckOpportunity = useCallback(async () => {
    // Captured up front so a slow response can detect the user switched
    // markets while it was in flight and bail instead of applying a
    // wrong-market price to the current opportunity.
    const requestSymbol = symbolRef.current;
    setCheckingOpportunity(true);
    try {
      const res = await fetch(`/api/market?symbol=${encodeURIComponent(requestSymbol)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      if (symbolRef.current !== requestSymbol) return;
      if (typeof data.currentPrice === "number") {
        advancePrice(data.currentPrice, true);
      } else {
        toast.error("Invalid market response — try again");
      }
    } catch {
      if (symbolRef.current === requestSymbol) toast.error("Network error while checking");
    } finally {
      setCheckingOpportunity(false);
    }
  }, [advancePrice]);

  // Automatic safety-net poll: the opportunity already advances on every
  // live WS tick (handleTick -> advancePrice, silent), but that only helps
  // while the tick stream itself is healthy. This is a second, independent
  // price source (the lightweight /api/tick proxy, ~1KB/~200ms) that keeps
  // nudging the state machine even if a market's WS/poll feed stalls or
  // disconnects — so the opportunity never goes stale and "check opportunity"
  // never has to be pressed manually just to keep things moving.
  useEffect(() => {
    const id = setInterval(async () => {
      if (hasOwnTickPollRef.current) return; // already covered by AxeChart's own poll
      const requestSymbol = symbolRef.current;
      try {
        const res = await fetch(`/api/tick?symbol=${encodeURIComponent(requestSymbol)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (symbolRef.current !== requestSymbol) return; // market changed mid-flight
        if (typeof data.price === "number" && isFinite(data.price)) {
          advancePrice(data.price, false);
        }
      } catch { /* skip — retried on the next interval tick */ }
    }, 3000);
    return () => clearInterval(id);
  }, [advancePrice]);

  // Surfaces the staleness that used to be invisible — every tick source can
  // fail silently, so this is what tells the user their price feed actually
  // died instead of letting the chart just quietly stop moving. 20s is a
  // generous margin above the fastest normal cadence (crypto WS ~1s, the
  // safety-net/Gold polls 3-5s) so a genuinely quiet moment doesn't false-fire.
  const STALE_MS = 20000;
  useEffect(() => {
    const id = setInterval(() => {
      setIsStale(Date.now() - lastTickAtRef.current > STALE_MS);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const handleMarketChange = useCallback((key: MarketKey) => {
    setMarket(key);
    try { localStorage.setItem(STORAGE_MARKET, key); } catch { /* ignore */ }
  }, []);

  const chartSetup: TradeSetup | null = useMemo(() => {
    if (!opportunity) return analysis?.tradeSetup ?? null;
    const tpPoints = Math.abs(opportunity.tp - opportunity.entry);
    const rrRatio = parseFloat((tpPoints / opportunity.slPoints).toFixed(2));
    return {
      direction: opportunity.direction,
      entryPrice: opportunity.entry,
      stopLoss: opportunity.sl,
      takeProfit: opportunity.tp,
      slPoints: opportunity.slPoints,
      tpPoints,
      rrRatio,
      rewardAmount: Math.round(100 * rrRatio),
    };
  }, [opportunity, analysis]);

  const chartBreakout: BreakoutEvent | null = useMemo(() => {
    if (!opportunity) return analysis?.breakout ?? null;
    if (opportunity.phase !== "AWAIT_RETEST" && opportunity.phase !== "RETEST_ACTIVE") return null;
    return {
      level: opportunity.level,
      direction: opportunity.direction,
      breakoutTime: opportunity.updatedAt,
      strength: analysis?.breakout?.strength ?? 1,
      retestZone: opportunity.retestZone,
    };
  }, [opportunity, analysis]);

  // Functional update — two rapid clicks reading botModeRef.current (only
  // synced post-commit by its own effect) could otherwise both compute the
  // same "next" value and net out to zero real toggles.
  const handleToggleBot = useCallback(() => {
    setBotMode(prev => !prev);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("axe-bot-mode", String(botMode)); } catch { /* ignore */ }
  }, [botMode]);

  const handleTakeTrade = useCallback(() => {
    if (dailyLimitReasonRef.current) { toast.error(dailyLimitReasonRef.current); return; }
    const prev = opportunityRef.current;
    if (!prev || livePriceRef.current === null) return;
    const next = takeTrade(prev, livePriceRef.current);
    if (next === prev) return;
    updateOpportunity(next);
    saveState(symbolRef.current, analysisRef.current, next);
  }, [updateOpportunity]);

  const handleMarketEntry = useCallback(() => {
    if (dailyLimitReasonRef.current) { toast.error(dailyLimitReasonRef.current); return; }
    const prev = opportunityRef.current;
    if (!prev || livePriceRef.current === null) return;
    const next = enterAtMarket(prev, livePriceRef.current, analysisRef.current?.levels ?? []);
    if (next === prev) return;
    updateOpportunity(next);
    saveState(symbolRef.current, analysisRef.current, next);
  }, [updateOpportunity]);

  const handleCloseTrade = useCallback(() => {
    const prev = opportunityRef.current;
    if (!prev || livePriceRef.current === null) return;
    const exit = livePriceRef.current;
    const next = closeTrade(prev, exit);
    if (next === prev || next.phase !== "CLOSED") return;
    updateOpportunity(next);
    playResolvedSound(livePnl(next, exit) >= 0);
    recordTrade(next, "MANUAL", exit);
    saveState(symbolRef.current, analysisRef.current, next);
  }, [recordTrade, updateOpportunity]);

  // ── Derived display values ───────────────────────────────────────────────────
  const displayPrice = livePrice ?? analysis?.currentPrice ?? null;
  const priceUp = (analysis?.priceChange ?? 0) >= 0;
  const trendDir = analysis?.trend.direction ?? null;

  // Chart display candles — purely visual, independent of the analysis
  // engine (which always runs on 1m data regardless of what's on screen).
  // "1m" keeps the existing quiet-market fallback to 5m; "5m"/"10m" use the
  // API's own 5m feed (30 days of history) directly or resampled, since
  // that's far richer than resampling from 1m's ~25h window.
  const chartCandles = useMemo(() => {
    if (timeframe === "5m") return rawCandles5m;
    if (timeframe === "10m") return resampleCandles(rawCandles5m, 600);
    return pickChartCandles(rawCandles1m, rawCandles5m, cfg.slPoints);
  }, [timeframe, rawCandles1m, rawCandles5m, cfg.slPoints]);

  // ── Mobile ticker: the opportunity at a glance, no need to open Taylor ──────
  const tickerItems: { text: string; color: string }[] = useMemo(() => {
    if (!analysis) return [];
    const items: { text: string; color: string }[] = [];
    const sigColor = analysis.signal === "GO_LONG" ? "#1c7d4c" : analysis.signal === "GO_SHORT" ? "#8a2f2a" : "#c23b30";
    const sigLabel = analysis.signal === "GO_LONG" ? "LONG" : analysis.signal === "GO_SHORT" ? "SHORT" : "WAIT";
    items.push({ text: `${sigLabel} · ${analysis.probability}% PROB`, color: sigColor });
    if (opportunity) {
      const meta = PHASE_META[opportunity.phase];
      items.push({ text: meta.label, color: meta.color });
      items.push({ text: `${opportunity.direction === "long" ? "▲" : "▼"} ENTRY ${fmtPrice(opportunity.entry)}`, color: "var(--text-secondary)" });
      items.push({ text: `SL ${fmtPrice(opportunity.sl)}`, color: "#8a2f2a" });
      items.push({ text: `TP ${fmtPrice(opportunity.tp)}`, color: "#1c7d4c" });
    }
    items.push({ text: `${fmtLots(lotsFor(cfg))} LOTS`, color: "var(--text-secondary)" });
    if (analysis.tradeSetup) {
      items.push({ text: `R:R ${fmtRatio(analysis.tradeSetup.rrRatio)}`, color: "var(--text-secondary)" });
    }
    if (analysis.warnings.length > 0) {
      items.push({ text: `${analysis.warnings.length} WARNING${analysis.warnings.length > 1 ? "S" : ""}`, color: "#c23b30" });
    }
    return items;
  }, [analysis, opportunity, cfg]);

  // Marquee speed scales with content so reading pace stays comfortable
  // regardless of how many items are loaded — a fixed-duration loop reads
  // fine with a handful of items but races by unreadably once there are 50+
  // news headlines queued up.
  const oppTickerDuration = Math.max(15, tickerItems.length * 3.5);
  const newsMarqueeDuration = Math.max(40, newsTicker.length * 6);

  // ── Shared chart block ───────────────────────────────────────────────────────
  const chartBlock = (
    <div className="relative w-full h-full">
      {chartCandles.length > 0 ? (
        <>
          <AxeChart
            candles={chartCandles}
            levels={analysis?.levels ?? []}
            ma20={analysis?.trend.ma20 ?? 0}
            tradeSetup={chartSetup}
            breakout={chartBreakout}
            accentColor={cfg.color}
            symbol={cfg.symbol}
            tdSymbol={cfg.tdSymbol}
            coinbaseProduct={cfg.coinbaseProduct}
            onTick={handleTick}
            stale={isStale}
          />
          <AnimatePresence>
            {opportunity?.phase === "RETEST_ACTIVE" && (
              <motion.div
                className="absolute left-4 right-4 rounded-lg p-4 z-10"
                style={{
                  top: "3.5rem",
                  background: "rgba(5,14,26,0.96)",
                  border: `2px solid ${opportunity.direction === "long" ? "#c23b30" : "#8a2f2a"}`,
                  boxShadow: `0 0 28px ${opportunity.direction === "long" ? "rgba(28,125,76,0.35)" : "rgba(138,47,42,0.35)"}`,
                  backdropFilter: "blur(8px)",
                }}
                variants={popVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_BASE}
              >
                <div className="flex items-center gap-2 font-black text-lg tracking-wider" style={{ color: opportunity.direction === "long" ? "#c23b30" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                  <FiZap size={16} /> RETEST ACTIVE — {fmtPrice(opportunity.level)}
                </div>
                <div className="text-sm mt-0.5" style={{ color: "#9ba5b2" }}>
                  {opportunity.direction === "long" ? "▲ LONG" : "▼ SHORT"} · Confirm the candle before entering
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          {chartLoading ? (
            <>
              <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
              <p className="text-base" style={{ color: "var(--text-muted)" }}>Loading {cfg.label}...</p>
            </>
          ) : (
            <>
              <FiTrendingUp size={40} className="opacity-10" style={{ color: "var(--text-muted)" }} />
              <p className="text-base" style={{ color: "var(--text-muted)" }}>Error loading {cfg.label}</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <RecordsModal open={recordsOpen} onClose={() => setRecordsOpen(false)} refreshToken={recordsVersion} />
      <PlaybookModal open={playbookOpen} onClose={() => setPlaybookOpen(false)} />
      <JournalModal open={journalOpen} onClose={() => setJournalOpen(false)} />
      <NewsModal open={newsOpen} onClose={() => setNewsOpen(false)} market={market} />

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE LAYOUT  (< lg) — chart a pantalla completa
      ════════════════════════════════════════════════════════════════════════ */}
      {isDesktop === false && (
      <motion.div
        className="lg:hidden relative overflow-hidden"
        style={{ height: "100dvh" }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TRANSITION_APP}
      >

        {/* ── Chart — cubre toda la pantalla ── */}
        <div className="absolute inset-0">
          {chartBlock}
        </div>

        {/* ── Overlay superior: título + mercados + historial ── */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex flex-col gap-2 px-4 pb-5"
          style={{
            background: "linear-gradient(to bottom, rgba(5,14,26,0.88) 60%, transparent 100%)",
            // Clears the notch/Dynamic Island on iOS PWA installs — "pt-safe"
            // isn't a real Tailwind utility in this project, it resolved to
            // nothing, so the safe-area inset was never actually applied.
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
          }}
        >
          <div className="flex items-center justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element -- static PWA header mark, no benefit from next/image's server-side pipeline */}
            <img src="/quantz-logo-header.png" alt="Quantz" className="h-7 w-auto" />
            <Clock is24h={cfg.is24h} />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-2 flex-1">
              {MARKET_KEYS.map(key => {
                const m = MARKETS[key];
                const active = key === market;
                return (
                  <button
                    key={key}
                    onClick={() => handleMarketChange(key)}
                    className="flex-1 py-4 rounded-md text-base font-black tracking-wider transition-all duration-200"
                    style={{
                      background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
                      color: active ? "var(--text-primary)" : "var(--text-muted)",
                      border: `1px solid ${active ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                      boxShadow: active ? "0 0 14px rgba(255,255,255,0.18)" : "none",
                      fontFamily: "var(--font-display)",
                      cursor: "pointer",
                    }}
                  >
                    {m.short}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setRecordsOpen(true)}
              className="flex items-center gap-1 px-3 py-2.5 rounded-md text-sm font-bold"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
              }}
            >
              <FiBarChart2 size={13} />
            </button>
          </div>

          {/* Timeframe selector + news marquee — tap the marquee to open the full feed */}
          <div className="flex items-center gap-2">
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
            <AnimatePresence>
            {newsTicker.length > 0 && (
              <motion.button
                onClick={() => setNewsOpen(true)}
                className="overflow-hidden rounded-md flex items-center gap-2 px-3 py-2 flex-1 min-w-0"
                style={{ background: "rgba(5,14,26,0.7)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                <LuNewspaper size={14} className="shrink-0" style={{ color: "var(--gold)" }} />
                <div className="overflow-hidden flex-1">
                  <div className="flex w-max animate-marquee" style={{ animationDuration: `${newsMarqueeDuration}s` }}>
                    {[...newsTicker, ...newsTicker].map((a, i) => (
                      <span key={i} className="flex items-center shrink-0 text-sm font-bold pl-4" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-display)" }}>
                        {a.headline}
                        <span className="pl-4 opacity-25">•</span>
                      </span>
                    ))}
                  </div>
                </div>
              </motion.button>
            )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Overlay inferior: precio + botón Taylor + ticker de oportunidad ── */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-3 px-5 pt-16"
          style={{
            background: "linear-gradient(to top, rgba(5,14,26,0.92) 50%, transparent 100%)",
            // Clears the home-indicator gesture bar on notched iOS devices —
            // no extra fixed padding on top, the ticker row already gives
            // this section enough bottom breathing room.
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
        <div className="flex items-end justify-between">
          {/* Precio en vivo */}
          <div>
            <AnimatePresence mode="wait">
              {displayPrice !== null ? (
                <motion.div key="price" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
                  <div className="text-4xl font-black text-white leading-none" style={{ fontFamily: "var(--font-display)" }}>
                    {fmtPrice(displayPrice)}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {analysis && (
                      <span className="text-base font-bold" style={{ color: priceUp ? "#1c7d4c" : "#8a2f2a" }}>
                        {fmtSignedPct(analysis.priceChangePct)}
                      </span>
                    )}
                    <AnimatePresence>
                      {trendDir && (
                        <motion.span
                          key={trendDir}
                          className="flex items-center gap-0.5 text-sm font-semibold"
                          style={{ color: trendDir === "bullish" ? "#1c7d4c" : trendDir === "bearish" ? "#8a2f2a" : "var(--text-muted)" }}
                          variants={popVariants}
                          initial="hidden"
                          animate="visible"
                          exit="hidden"
                          transition={TRANSITION_FAST}
                        >
                          {trendDir === "bullish" ? <FiArrowUpRight size={11} /> : trendDir === "bearish" ? <FiArrowDownRight size={11} /> : null}
                          {trendDir === "bullish" ? "BULLISH" : trendDir === "bearish" ? "BEARISH" : "NEUTRAL"}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ) : (
                <motion.span key="label" className="text-base" style={{ color: "var(--text-muted)" }} variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
                  {cfg.label}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Botones Journal + Playbook + Taylor */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setJournalOpen(true)}
              className="flex items-center justify-center w-14 h-14 rounded-md transition-all duration-150 active:scale-95"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
              }}
              title="Journal — log your trades"
            >
              <LuNotebookPen size={20} />
            </button>
            <button
              onClick={() => setPlaybookOpen(true)}
              className="flex items-center justify-center w-14 h-14 rounded-md transition-all duration-150 active:scale-95"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
              }}
              title="Playbook — the 40 rules"
            >
              <LuListChecks size={20} />
            </button>
            <button
              onClick={() => setTaylorOpen(true)}
              className="flex items-center justify-center w-14 h-14 rounded-md transition-all duration-150 active:scale-95"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--text-primary)",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
              }}
              title="Taylor — open analysis"
            >
              <LuBrainCircuit size={20} />
            </button>
          </div>
        </div>

          {/* Ticker — resumen de la oportunidad, sin abrir Taylor */}
          <AnimatePresence>
            {tickerItems.length > 0 && (
              <motion.div
                className="overflow-hidden rounded-md"
                style={{ background: "rgba(5,14,26,0.7)", border: "1px solid rgba(255,255,255,0.08)" }}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                <div className="flex w-max py-2 animate-marquee" style={{ animationDuration: `${oppTickerDuration}s` }}>
                  {[...tickerItems, ...tickerItems].map((item, i) => (
                    <span
                      key={i}
                      className="flex items-center shrink-0 text-sm font-bold pl-4"
                      style={{ color: item.color, fontFamily: "var(--font-display)" }}
                    >
                      {item.text}
                      <span className="pl-4 opacity-25" style={{ color: "var(--text-secondary)" }}>•</span>
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Taylor sheet — cubre pantalla completa ── */}
        <motion.div
          className="absolute inset-0 z-50 flex flex-col"
          style={{
            background: "var(--bg-panel)",
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
          animate={{ y: taylorOpen ? "0%" : "100%" }}
          initial={false}
          transition={TRANSITION_SHEET}
        >
          {/* Contenido scrollable */}
          <div className="flex-1 overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2.5rem)" }}>
            <BobbyPanel
              market={MARKETS[market]}
              analysis={analysis}
              onAnalysis={handleAnalysis}
              opportunity={opportunity}
              livePrice={livePrice}
              botMode={botMode}
              onToggleBot={handleToggleBot}
              onTakeTrade={handleTakeTrade}
              onMarketEntry={handleMarketEntry}
              onCloseTrade={handleCloseTrade}
              onCheckOpportunity={handleCheckOpportunity}
              checkingOpportunity={checkingOpportunity}
              tradeBlockedReason={dailyLimitReason}
              onClose={() => setTaylorOpen(false)}
            />
          </div>
        </motion.div>
      </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          DESKTOP LAYOUT  (>= lg)
      ════════════════════════════════════════════════════════════════════════ */}
      {isDesktop === true && (
      <motion.div
        className="hidden lg:flex lg:flex-col lg:flex-1 overflow-hidden"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TRANSITION_APP}
      >

        {/* ── Header: título + reloj ── */}
        <div
          className="flex items-center justify-between px-7 py-4 shrink-0"
          style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--gold-border)" }}
        >
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- static PWA header mark, no benefit from next/image's server-side pipeline */}
            <img src="/quantz-logo-header.png" alt="Quantz" className="h-9 w-auto" />
            <span className="text-sm tracking-[0.2em] hidden sm:block" style={{ color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>PRIVATE TRADING HUB</span>
          </div>
          <Clock is24h={cfg.is24h} />
        </div>

        {/* ── Top bar ── */}
        <div
          className="flex items-center gap-2 px-6 py-3 shrink-0 overflow-x-auto"
          style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--gold-border)" }}
        >
          {MARKET_KEYS.map(key => {
            const m = MARKETS[key];
            const active = key === market;
            return (
              <button
                key={key}
                onClick={() => handleMarketChange(key)}
                className="px-4 py-2 rounded-md text-sm font-bold tracking-wider transition-all duration-150 whitespace-nowrap"
                style={{
                  background: active ? "rgba(255,255,255,0.10)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  border: `1px solid ${active ? "rgba(255,255,255,0.5)" : "transparent"}`,
                  boxShadow: active ? "0 0 14px rgba(255,255,255,0.18)" : "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-display)",
                }}
              >
                {m.short}
              </button>
            );
          })}
          <span className="ml-3 text-[11px] whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{cfg.description}</span>
          <button
            onClick={() => setJournalOpen(true)}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-bold tracking-wider whitespace-nowrap shrink-0"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <LuNotebookPen size={13} /> JOURNAL
          </button>
          <button
            onClick={() => setPlaybookOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-bold tracking-wider whitespace-nowrap shrink-0"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <LuListChecks size={13} /> RULES
          </button>
          <button
            onClick={() => setRecordsOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-bold tracking-wider whitespace-nowrap shrink-0"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiBarChart2 size={13} /> HISTORY
          </button>
        </div>

        {/* ── Timeframe selector + news marquee ── */}
        <div className="w-full flex items-center gap-3 px-6 py-2 shrink-0" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--gold-border)" }}>
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          <AnimatePresence>
          {newsTicker.length > 0 && (
            <motion.button
              onClick={() => setNewsOpen(true)}
              className="flex-1 min-w-0 overflow-hidden flex items-center gap-2"
              style={{ cursor: "pointer" }}
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={TRANSITION_FAST}
            >
              <LuNewspaper size={14} className="shrink-0" style={{ color: "var(--gold)" }} />
              <div className="overflow-hidden flex-1">
                <div className="flex w-max animate-marquee" style={{ animationDuration: `${newsMarqueeDuration}s` }}>
                  {[...newsTicker, ...newsTicker].map((a, i) => (
                    <span key={i} className="flex items-center shrink-0 text-sm font-bold pl-4" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-display)" }}>
                      {a.headline}
                      <span className="pl-4 opacity-25">•</span>
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          )}
          </AnimatePresence>
        </div>

        {/* ── Main body ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chart — ocupa todo el alto */}
          <div className="flex-1 min-w-0 relative">
            {chartBlock}
          </div>

          {/* Taylor + Bobby panel */}
          <aside
            className="shrink-0 overflow-y-auto flex flex-col"
            style={{ width: "46%", borderLeft: "1px solid rgba(28,125,76,0.2)" }}
          >
            <BobbyPanel
              market={MARKETS[market]}
              analysis={analysis}
              onAnalysis={handleAnalysis}
              opportunity={opportunity}
              livePrice={livePrice}
              botMode={botMode}
              onToggleBot={handleToggleBot}
              onTakeTrade={handleTakeTrade}
              onMarketEntry={handleMarketEntry}
              onCloseTrade={handleCloseTrade}
              onCheckOpportunity={handleCheckOpportunity}
              checkingOpportunity={checkingOpportunity}
              tradeBlockedReason={dailyLimitReason}
            />
          </aside>
        </div>
      </motion.div>
      )}
    </>
  );
}
