"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiZap, FiTrendingUp, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";
import { LuNewspaper } from "react-icons/lu";
import {
  PiChartLineUpLight, PiChartLineUpFill, PiSparkleLight, PiSparkleFill,
  PiNotebookLight, PiNotebookFill, PiNotebook, PiNewspaperLight, PiNewspaperFill, PiNewspaper,
} from "react-icons/pi";
import type { IconType } from "react-icons";
import AxeChart from "./AxeChart";
import BobbyPanel, { PHASE_META, Clock } from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import { runAnalysis, type AnalysisResult, type TradeSetup, type BreakoutEvent, type Level } from "../lib/analysis";
import { MARKETS, type Market, type MarketKey } from "../lib/markets";
import NewsModal, { NewsFeed } from "./NewsModal";
import JournalPanel from "./JournalPanel";
import MobileScreenHeader from "./MobileScreenHeader";
import type { NewsArticle } from "../lib/news";
import { createOpportunity, advanceOpportunity, livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";
import { playBreakoutSound, playRetestSound, playResolvedSound } from "../lib/alerts";
import { toast } from "sonner";
import { addPrediction, resolvePrediction, updatePredictionLevels } from "../lib/predictions";
import { tradeCostFor, lotsFor } from "../lib/markets";
import { popVariants, fadeVariants, TRANSITION_BASE, TRANSITION_FAST, TRANSITION_APP } from "../lib/motionVariants";
import { fmtPrice, fmtSignedPct, fmtSignedMoney, fmtLots, fmtRatio } from "../lib/format";
import { resampleCandles, TIMEFRAMES, type Timeframe } from "../lib/candles";
import { glassStyle, glassChipStyle } from "../lib/glass";

const MARKET_KEYS: MarketKey[] = ["nasdaq", "dowjones", "gold", "bitcoin"];

// Mirrors the exact condition AxeChart.tsx uses to decide whether its Twelve
// Data WS branch can actually run — a market with a `tdSymbol` but no live
// key is NOT covered, even though `tdSymbol` itself is truthy.
const TD_WS_VIABLE = !!process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;

const STORAGE_MARKET = "axe-market";
const storageKey = (symbol: string) => `axe-analysis-${symbol}`;
const MAX_AGE_MS = 24 * 3600 * 1000;

function saveState(symbol: string, analysis: AnalysisResult | null, opportunity: Opportunity | null) {
  try {
    if (!analysis) return;
    localStorage.setItem(storageKey(symbol), JSON.stringify({ analysis, opportunity, savedAt: Date.now() }));
  } catch { /* storage unavailable */ }
}

const VALID_PHASES = new Set<OppPhase>(["HUNTING", "AWAIT_RETEST", "RETEST_ACTIVE", "CONFIRMED", "TP_HIT", "SL_HIT", "INVALIDATED"]);
function isCompatibleOpportunity(o: unknown): o is Opportunity {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return typeof r.phase === "string" && VALID_PHASES.has(r.phase as OppPhase);
}

const TERMINAL_PHASES = new Set<OppPhase>(["TP_HIT", "SL_HIT", "INVALIDATED"]);

// Keeps the prediction log in sync with an opportunity's state — logs a new
// PredictionRecord the moment there's an actual breakout to call (not a bare
// HUNTING setup still waiting for a level to even break), resolves it on a
// terminal transition, and updates its level/entry/sl/tp on a re-anchor so
// the logged record never shows a resolution price next to stale numbers —
// this feeds Taylor's own "record" context in the AI second-opinion even
// though there's no visible journal UI anymore. Shared
// by the live single-tick path (advancePrice) and the market-switch catch-up
// replay below, so both stay consistent. Mutates `next.predictionId` in
// place — safe, since `next` is always a freshly-constructed object that
// hasn't been committed to state yet when this runs.
function syncPrediction(prev: Opportunity | null, next: Opportunity, marketShort: string, triggerPrice: number): void {
  if (!next.predictionId) {
    if (next.phase === "HUNTING") return; // not a real call yet — nothing to log
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addPrediction({
      id,
      market: marketShort,
      direction: next.direction,
      level: next.level,
      entry: next.entry,
      sl: next.sl,
      tp: next.tp,
      probability: next.analysisProbability,
      createdAt: Date.now(),
      resolvedAt: null,
      outcome: "PENDING",
    });
    next.predictionId = id;
    return; // the fresh log already reflects next's current numbers
  }
  if (next.phase === "TP_HIT" && prev?.phase !== "TP_HIT") {
    resolvePrediction(next.predictionId, "TP_HIT", next.tp, livePnl(next, next.tp));
  } else if (next.phase === "SL_HIT" && prev?.phase !== "SL_HIT") {
    resolvePrediction(next.predictionId, "SL_HIT", next.sl, livePnl(next, next.sl));
  } else if (next.phase === "INVALIDATED" && prev?.phase !== "INVALIDATED") {
    resolvePrediction(next.predictionId, "INVALIDATED", triggerPrice);
  } else if (prev && next.level !== prev.level) {
    updatePredictionLevels(next.predictionId, next.level, next.entry, next.sl, next.tp);
  }
}

// Replays every candle newer than the opportunity's last update against the
// state machine — checking each candle's stop-side extreme before its
// payoff-side extreme (conservative: never credits a TP that might not have
// actually printed before the SL did within the same bar) — so an
// opportunity on a market you weren't watching resolves against the real
// path price took, not just whatever price happens to be showing the moment
// you look again.
function catchUpOpportunity(start: Opportunity, candles: RawCandle[], levels: Level[], marketShort: string): Opportunity {
  const relevant = candles
    .filter(c => c.time * 1000 > start.updatedAt)
    .sort((a, b) => a.time - b.time);
  let cur = start;
  for (const c of relevant) {
    const dirUp = cur.direction === "long";
    const checks = dirUp ? [c.low, c.high] : [c.high, c.low];
    for (const price of checks) {
      const prev = cur;
      const next = advanceOpportunity(cur, price, levels);
      if (next.phase !== prev.phase || next.level !== prev.level) {
        syncPrediction(prev, next, marketShort, price);
      }
      cur = next;
      if (TERMINAL_PHASES.has(cur.phase)) return cur;
    }
  }
  return cur;
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

// Extends the analysis engine's own 1m candle buffer with a live tick,
// locally — no server round-trip. Mirrors the bucket logic AxeChart already
// runs for its own rendering, but kept separate from `rawCandles1m` (the
// chart's state) on purpose: feeding this same array back into the chart's
// props on every tick would change its identity constantly and force a full
// chart rebuild (new candlestick series, lost zoom) every few seconds. This
// buffer exists purely so the deterministic engine can re-run continuously
// for cheap, decoupled from what the chart is doing.
function applyTickToCandles(candles: RawCandle[], price: number): RawCandle[] {
  if (candles.length === 0 || !isFinite(price) || price <= 0) return candles;
  const bucket = Math.floor(Date.now() / 1000 / 60) * 60; // 1min buckets — matches the engine's own basis
  const last = candles[candles.length - 1];
  if (last.time === bucket) {
    const updated: RawCandle = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
    return [...candles.slice(0, -1), updated];
  }
  if (bucket > last.time) {
    return [...candles, { time: bucket, open: price, high: price, low: price, close: price, volume: 0 }];
  }
  return candles; // a tick for a bucket that's already passed — ignore rather than corrupt history
}

function TimeframeSelector({ value, onChange }: { value: Timeframe; onChange: (tf: Timeframe) => void }) {
  return (
    <div className="flex items-center rounded overflow-hidden shrink-0" style={glassChipStyle()}>
      {TIMEFRAMES.map(tf => (
        <button
          key={tf.key}
          onClick={() => onChange(tf.key)}
          className="px-2.5 py-1.5 text-[11px] font-black tracking-wider"
          style={{
            background: value === tf.key ? "rgba(255,255,255,0.14)" : "transparent",
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
// ── Mobile app chrome — bottom tab bar sections ─────────────────────────────
type MobileTab = "chart" | "taylor" | "axe" | "news";
// Thin outline when idle, filled when selected — the iOS tab bar convention
const MOBILE_TABS: { key: MobileTab; label: string; Icon: IconType; ActiveIcon: IconType }[] = [
  { key: "chart",  label: "Chart",  Icon: PiChartLineUpLight, ActiveIcon: PiChartLineUpFill },
  { key: "taylor", label: "Taylor", Icon: PiSparkleLight,     ActiveIcon: PiSparkleFill },
  { key: "axe",    label: "Axe",    Icon: PiNotebookLight,    ActiveIcon: PiNotebookFill },
  { key: "news",   label: "News",   Icon: PiNewspaperLight,   ActiveIcon: PiNewspaperFill },
];

// Full-screen tab surfaces sit under the notch/Dynamic Island on iOS PWA installs
const MOBILE_SCREEN_STYLE = { background: "var(--bg)", paddingTop: "env(safe-area-inset-top, 0px)" };

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
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsTicker, setNewsTicker] = useState<NewsArticle[]>([]);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [checkingOpportunity, setCheckingOpportunity] = useState(false);
  const [isStale, setIsStale] = useState(false);

  const cfg = MARKETS[market];
  const analysisRef = useRef<AnalysisResult | null>(null);
  const symbolRef = useRef(cfg.symbol);
  const marketShortRef = useRef<string>(cfg.short);
  const livePriceRef = useRef<number | null>(null);
  // Mirrors AxeChart's own "no WS source" check — a market with neither a
  // Coinbase product nor a VIABLE Twelve Data WS (tdSymbol set but no key —
  // see TD_WS_VIABLE) already runs its own 5s poll to this same /api/tick
  // endpoint as its PRIMARY feed. Duplicating that from the safety-net poll
  // below doubles the request rate for no added coverage.
  const hasOwnTickPollRef = useRef(!cfg.coinbaseProduct && !(TD_WS_VIABLE && cfg.tdSymbol));
  // Every live price — WS tick, Gold's poll, the safety-net poll, a manual
  // check — funnels through advancePrice(), so "time since the last call"
  // is a single, source-agnostic staleness signal. Every poller in this app
  // used to fail silently (a dead feed just stopped updating with zero
  // on-screen sign); this is what turns that into something visible.
  // 0, not Date.now() — the market-load effect below (which also runs on
  // mount) sets the real value inside its own effect body; a literal here
  // keeps this a pure render instead of an impure call on every re-render.
  const lastTickAtRef = useRef(0);
  const cfgRef = useRef<Market>(cfg);

  // The auto-analysis engine's own candle buffer — see applyTickToCandles()
  // above. Seeded from the market-load fetch, extended locally on every tick,
  // never touches rawCandles1m/rawCandles5m (the chart's state).
  const analysisCandlesRef = useRef<RawCandle[]>([]);
  const prevCloseRef = useRef<number>(0);
  const lastAutoAnalysisAtRef = useRef(0);
  const AUTO_ANALYSIS_THROTTLE_MS = 2500;
  // How long a resolved (TP/SL/INVALIDATED) call stays on screen before the
  // engine clears it and starts hunting the next setup on its own — long
  // enough to actually register the result, short enough that the app never
  // just sits there once a call is done.
  const TERMINAL_GRACE_MS = 20000;

  // Callbacks (handleTick, advancePrice, etc.) read these refs instead of
  // closing over state, so they always see the latest value without being
  // recreated every render — synced here rather than during render.
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
  useEffect(() => { symbolRef.current = cfg.symbol; }, [cfg.symbol]);
  useEffect(() => { marketShortRef.current = cfg.short; }, [cfg.short]);
  useEffect(() => { hasOwnTickPollRef.current = !cfg.coinbaseProduct && !(TD_WS_VIABLE && cfg.tdSymbol); }, [cfg.coinbaseProduct, cfg.tdSymbol]);
  useEffect(() => { livePriceRef.current = livePrice; }, [livePrice]);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

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

  // Reading localStorage during the initial render (e.g. a useState
  // initializer) would desync the static server-prerendered HTML from the
  // client's first paint. Applying the saved value post-mount is what avoids
  // that hydration mismatch, so this intentionally sets state from an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MARKET) as MarketKey | null;
      if (saved && MARKETS[saved]) setMarket(saved);
    } catch { /* storage unavailable */ }
    // One-time tidy-up of keys the trade-execution pivot orphaned — nothing
    // reads or writes these anymore, they're just dead bytes in a real
    // user's browser storage otherwise.
    try {
      localStorage.removeItem("axe-trade-records");
      localStorage.removeItem("axe-journal-entries");
      localStorage.removeItem("axe-bot-mode");
    } catch { /* storage unavailable */ }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Re-runs the deterministic engine (analysis.ts) against the tick-extended
  // local candle buffer — no fetch, no AI, just the same pure computation
  // "New Analysis" used to trigger by hand, now driven by price itself.
  // Throttled internally so a burst of ticks (crypto WS can fire several
  // times a second) still only recomputes a couple times a second at most.
  //
  // Opportunity handling is deliberately conservative: this NEVER supersedes
  // a live, still-unresolved opportunity — it only proposes a fresh one when
  // there's genuinely nothing being tracked (null), or once a resolved
  // TP/SL/INVALIDATED call has sat for TERMINAL_GRACE_MS. Without that
  // guard, re-running every couple seconds while a breakout sits in
  // AWAIT_RETEST would otherwise create (and log a fresh prediction for)
  // a "new" call every single throttle tick — the same setup, spammed.
  const runAutoAnalysis = useCallback((price: number, force = false) => {
    const nowMs = Date.now();
    if (!force && nowMs - lastAutoAnalysisAtRef.current < AUTO_ANALYSIS_THROTTLE_MS) return;
    if (analysisCandlesRef.current.length === 0) return; // market data hasn't loaded yet
    lastAutoAnalysisAtRef.current = nowMs;

    analysisCandlesRef.current = applyTickToCandles(analysisCandlesRef.current, price);
    const activeCfg = cfgRef.current;
    const result = runAnalysis(
      analysisCandlesRef.current,
      price,
      prevCloseRef.current,
      activeCfg.is24h,
      activeCfg.slPoints,
      activeCfg.label
    );
    analysisRef.current = result;
    setAnalysis(result);

    const prevOpp = opportunityRef.current;
    if (prevOpp && TERMINAL_PHASES.has(prevOpp.phase)) {
      if (nowMs - prevOpp.updatedAt > TERMINAL_GRACE_MS) {
        updateOpportunity(null); // let the next tick hunt fresh from a clean slate
      }
      saveState(symbolRef.current, result, prevOpp);
      return;
    }
    if (!prevOpp) {
      const opp = createOpportunity(result, activeCfg.slPoints, tradeCostFor(activeCfg));
      if (opp) {
        // Only logs once there's an actual breakout to call (see
        // syncPrediction) — a bare HUNTING setup isn't a real prediction yet;
        // it becomes one at the HUNTING->AWAIT_RETEST transition in
        // advancePrice() if/when that happens live.
        syncPrediction(null, opp, marketShortRef.current, result.currentPrice);
        updateOpportunity(opp);
        saveState(symbolRef.current, result, opp);
      } else {
        saveState(symbolRef.current, result, null);
      }
      return;
    }
    // Already tracking something live and non-terminal — leave it alone,
    // advancePrice()'s own state machine (right below) is what progresses
    // it. This call only refreshed the displayed read.
    saveState(symbolRef.current, result, prevOpp);
  }, [updateOpportunity]);

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
    analysisCandlesRef.current = [];
    prevCloseRef.current = 0;
    lastAutoAnalysisAtRef.current = 0;
    let cancelled = false;
    // Rapidly clicking through markets used to leave every prior fetch
    // running to completion in the background even though only the last
    // one's result would ever be used — wasted bandwidth/API quota. This
    // actually cancels the in-flight request, not just its state update.
    const controller = new AbortController();

    fetch(`/api/market?symbol=${encodeURIComponent(cfg.symbol)}`, { cache: "no-store", signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const c1m: RawCandle[] = data.candles1m ?? [];
        const c5m: RawCandle[] = data.candles5m ?? [];
        setRawCandles1m(c1m);
        setRawCandles5m(c5m);
        // Same buffer + fallback threshold the old manual analyze() used —
        // 1m history is preferred, but falls back to 5m when the feed hasn't
        // built up 60 bars yet (e.g. right after an index market's open).
        analysisCandlesRef.current = c1m.length >= 60 ? c1m : c5m;
        prevCloseRef.current = data.prevClose;
        try {
          const raw = localStorage.getItem(storageKey(cfg.symbol));
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.analysis && Date.now() - (saved.savedAt ?? 0) < MAX_AGE_MS) {
              setAnalysis(saved.analysis);
              // A saved opportunity from before the trade-execution pivot can
              // have an old-shape phase (e.g. "CLOSED") that no longer exists
              // — PHASE_META[...] would be undefined and crash the panel.
              // Just cached UI state, not real history, so discard rather
              // than try to migrate it.
              let opp: Opportunity | null = isCompatibleOpportunity(saved.opportunity) ? saved.opportunity : null;
              if (opp && !TERMINAL_PHASES.has(opp.phase)) {
                // This market wasn't selected while price kept moving — no
                // WS/poll ever reached it. Replay the candles that arrived
                // since its last update against the state machine (5m for
                // the longest available lookback) instead of only comparing
                // against whatever the price happens to be right now, which
                // could misattribute a TP that already happened as an SL.
                opp = catchUpOpportunity(opp, c5m, saved.analysis?.levels ?? [], cfg.short);
              }
              updateOpportunity(opp);
              if (opp) saveState(cfg.symbol, saved.analysis, opp);
            }
          }
        } catch { /* corrupt entry */ }
        // Forces the very first analysis run for this market — bypasses the
        // throttle since there's nothing to throttle against yet. This is
        // what replaces the old manual "New Analysis" button for the
        // initial-load case; every run after this is tick-driven.
        if (typeof data.currentPrice === "number" && isFinite(data.currentPrice)) {
          runAutoAnalysis(data.currentPrice, true);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChartLoading(false); });

    return () => { cancelled = true; controller.abort(); };
  }, [cfg.symbol, cfg.slPoints, cfg.short, updateOpportunity, runAutoAnalysis]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Shared by both the live WS tick stream and the manual "check opportunity"
  // button, so a manual check goes through exactly the same state machine —
  // announce is only set for the manual path, to report back even when
  // nothing changed (the WS path stays silent unless the phase moves).
  const advancePrice = useCallback((price: number, announce = false) => {
    lastTickAtRef.current = Date.now();
    setLivePrice(price);
    livePriceRef.current = price;
    runAutoAnalysis(price);
    const prev = opportunityRef.current;
    if (!prev) {
      if (announce) toast(`Price updated · ${fmtPrice(price)}`, { duration: 2500 });
      return;
    }
    const next = advanceOpportunity(prev, price, analysisRef.current?.levels ?? []);
    opportunityRef.current = next;
    const levelChanged = next.level !== prev.level;
    const transitioned = next.phase !== prev.phase || levelChanged;
    if (transitioned) {
      setOpportunity(next);
      // Covers logging a fresh breakout call (HUNTING->AWAIT_RETEST),
      // resolving on TP_HIT/SL_HIT/INVALIDATED, and updating the logged
      // level/entry/sl/tp on a plain re-anchor — one call handles every case
      // a phase-or-level transition can produce, so this and the market-
      // switch catch-up path can never drift out of sync with each other.
      syncPrediction(prev, next, marketShortRef.current, price);
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
        toast.success(`tp · ${fmtPrice(next.tp)}`, { duration: 4000 });
      }
      else if (next.phase === "SL_HIT") {
        playResolvedSound(false);
        toast.error(`sl · ${fmtPrice(next.sl)}`, { duration: 4000 });
      }
      else if (next.phase === "INVALIDATED") {
        toast(`invalidated · ${fmtPrice(price)} — setup didn't hold`, { duration: 4000 });
      }
      saveState(symbolRef.current, analysisRef.current, next);
    }
    if (announce && !transitioned) {
      const pnl = next.phase === "CONFIRMED" ? livePnl(next, price) : null;
      const pnlPart = pnl !== null ? ` · ${fmtSignedMoney(pnl)}` : "";
      toast(`No change · ${PHASE_META[next.phase].label} · ${fmtPrice(price)}${pnlPart}`, { duration: 3500 });
    }
  }, [runAutoAnalysis]);

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
    const sigColor = analysis.signal === "GO_LONG" ? "#1c7d4c" : analysis.signal === "GO_SHORT" ? "#8a2f2a" : "#f2f5f8";
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
      items.push({ text: `${analysis.warnings.length} WARNING${analysis.warnings.length > 1 ? "S" : ""}`, color: "#f2f5f8" });
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
                className="absolute left-4 right-4 rounded-md p-4 z-10"
                style={{
                  top: "3.5rem",
                  ...glassStyle(opportunity.direction === "long" ? "#f2f5f8" : "#8a2f2a"),
                }}
                variants={popVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_BASE}
              >
                <div className="flex items-center gap-2 font-black text-lg tracking-wider" style={{ color: opportunity.direction === "long" ? "#f2f5f8" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                  <FiZap size={16} /> RETEST ACTIVE — {fmtPrice(opportunity.level)}
                </div>
                <div className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
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
              <p className="text-base" style={{ color: "var(--text-secondary)" }}>Loading {cfg.label}...</p>
            </>
          ) : (
            <>
              <FiTrendingUp size={40} className="opacity-10" style={{ color: "var(--text-muted)" }} />
              <p className="text-base" style={{ color: "var(--text-secondary)" }}>Error loading {cfg.label}</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <NewsModal open={newsOpen} onClose={() => setNewsOpen(false)} market={market} />

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE LAYOUT  (< lg) — app-style: one screen at a time, market
          switcher + bottom tab bar pinned at the bottom (thumb reach).
      ════════════════════════════════════════════════════════════════════════ */}
      {isDesktop === false && (
      <motion.div
        className="lg:hidden flex flex-col overflow-hidden"
        style={{ height: "100dvh" }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={TRANSITION_APP}
      >
        <div className="relative flex-1 min-h-0 overflow-hidden">

        {/* ── Chart screen — the chart stays mounted under every other tab, so
            switching back to it is instant (no chart rebuild, no refetch). ── */}
        <div className="absolute inset-0">
          {chartBlock}
        </div>

        {/* ── Overlay superior: logo + reloj + timeframe + noticias ── */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex flex-col gap-2 px-3 pb-3"
          style={{
            background: "linear-gradient(to bottom, rgba(5,14,26,0.88) 60%, transparent 100%)",
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- static PWA header mark, no benefit from next/image's server-side pipeline */}
            <img src="/quantz-logo-header.png" alt="Quantz" className="h-6 w-auto shrink-0" />
            <Clock is24h={cfg.is24h} />
          </div>

          {/* Timeframe selector + news marquee — tap the marquee to open the News tab */}
          <div className="flex items-center gap-2">
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
            <AnimatePresence>
            {newsTicker.length > 0 && (
              <motion.button
                onClick={() => setMobileTab("news")}
                className="overflow-hidden rounded flex items-center gap-2 px-2.5 py-1.5 flex-1 min-w-0"
                style={{ ...glassChipStyle(), cursor: "pointer" }}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                <PiNewspaper size={15} className="shrink-0" style={{ color: "var(--gold)" }} />
                <div className="overflow-hidden flex-1">
                  <div className="flex w-max animate-marquee" style={{ animationDuration: `${newsMarqueeDuration}s` }}>
                    {[...newsTicker, ...newsTicker].map((a, i) => (
                      <span key={i} className="flex items-center shrink-0 text-xs font-bold pl-4" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-display)" }}>
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

        {/* ── Overlay inferior: precio + ticker de oportunidad (tap → Taylor) ── */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 px-3 pt-10 pb-2"
          style={{ background: "linear-gradient(to top, rgba(5,14,26,0.92) 50%, transparent 100%)" }}
        >
          <AnimatePresence mode="wait">
            {displayPrice !== null ? (
              <motion.div key="price" variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}>
                <div className="text-3xl font-black text-white leading-none" style={{ fontFamily: "var(--font-display)" }}>
                  {fmtPrice(displayPrice)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {analysis && (
                    <span className="text-sm font-bold" style={{ color: priceUp ? "#1c7d4c" : "#8a2f2a" }}>
                      {fmtSignedPct(analysis.priceChangePct)}
                    </span>
                  )}
                  <AnimatePresence>
                    {trendDir && (
                      <motion.span
                        key={trendDir}
                        className="flex items-center gap-0.5 text-xs font-semibold"
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

          {/* Ticker — resumen de la oportunidad; tap para abrir Taylor */}
          <AnimatePresence>
            {tickerItems.length > 0 && (
              <motion.button
                onClick={() => setMobileTab("taylor")}
                className="overflow-hidden rounded text-left"
                style={{ ...glassChipStyle(), cursor: "pointer" }}
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={TRANSITION_FAST}
              >
                <div className="flex w-max py-1.5 animate-marquee" style={{ animationDuration: `${oppTickerDuration}s` }}>
                  {[...tickerItems, ...tickerItems].map((item, i) => (
                    <span
                      key={i}
                      className="flex items-center shrink-0 text-xs font-bold pl-4"
                      style={{ color: item.color, fontFamily: "var(--font-display)" }}
                    >
                      {item.text}
                      <span className="pl-4 opacity-25" style={{ color: "var(--text-secondary)" }}>•</span>
                    </span>
                  ))}
                </div>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* ── Taylor, Axe, News — full screens over the chart. Kept mounted and
            just hidden while another tab shows, so Taylor's chat, the journal
            form and the loaded news survive switching tabs. ── */}
        <div className="absolute inset-0 z-20 flex flex-col" style={MOBILE_SCREEN_STYLE} hidden={mobileTab !== "taylor"}>
          <div className="flex-1 min-h-0">
            <BobbyPanel
              market={MARKETS[market]}
              analysis={analysis}
              opportunity={opportunity}
              livePrice={livePrice}
              onCheckOpportunity={handleCheckOpportunity}
              checkingOpportunity={checkingOpportunity}
              embedded
              isOpen={mobileTab === "taylor"}
            />
          </div>
        </div>

        <div className="absolute inset-0 z-20 flex flex-col" style={MOBILE_SCREEN_STYLE} hidden={mobileTab !== "axe"}>
          <MobileScreenHeader Icon={PiNotebook} title="AXE" subtitle="Your trade journal" />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <JournalPanel />
          </div>
        </div>

        <div className="absolute inset-0 z-20 flex flex-col" style={MOBILE_SCREEN_STYLE} hidden={mobileTab !== "news"}>
          <NewsFeed market={market} active={mobileTab === "news"} />
        </div>

        </div>

        {/* ── Market switcher + tab bar — the app's bottom chrome ── */}
        <div className="shrink-0" style={{ background: "var(--bg-panel)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {/* Journal isn't per-market, so the switcher steps aside on Axe */}
          {mobileTab !== "axe" && (
            <div className="px-3 pt-2">
              <div className="flex p-1 rounded-lg" style={{ background: "var(--bg)" }}>
                {MARKET_KEYS.map(key => {
                  const active = key === market;
                  return (
                    <button
                      key={key}
                      onClick={() => handleMarketChange(key)}
                      className="flex-1 py-2.5 rounded-md text-sm font-black tracking-wide whitespace-nowrap transition-colors duration-150"
                      style={{
                        background: active ? "var(--bg-card)" : "transparent",
                        color: active ? "var(--text-primary)" : "var(--text-muted)",
                        fontFamily: "var(--font-display)",
                        cursor: "pointer",
                      }}
                    >
                      {MARKETS[key].short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <nav className="flex" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            {MOBILE_TABS.map(tab => {
              const active = mobileTab === tab.key;
              // Live-setup dot on Taylor's icon, so an active call is visible from any tab
              const showDot = tab.key === "taylor" && opportunity !== null && !["TP_HIT", "SL_HIT", "INVALIDATED"].includes(opportunity.phase);
              return (
                <button
                  key={tab.key}
                  onClick={() => setMobileTab(tab.key)}
                  aria-current={active ? "page" : undefined}
                  className="flex-1 flex flex-col items-center gap-1 pt-2 pb-1.5 transition-opacity duration-150 active:opacity-50"
                  style={{ color: active ? "var(--text-primary)" : "var(--text-muted)", opacity: active ? 1 : 0.6, cursor: "pointer" }}
                >
                  <span className="relative">
                    {active ? <tab.ActiveIcon size={24} /> : <tab.Icon size={24} />}
                    {showDot && (
                      <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full" style={{ background: PHASE_META[opportunity!.phase].color }} />
                    )}
                  </span>
                  <span className="text-[10px] font-bold tracking-wide" style={{ fontFamily: "var(--font-display)" }}>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
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
          style={{ background: "var(--bg-panel)" }}
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
          style={{ background: "var(--bg-elevated)" }}
        >
          {MARKET_KEYS.map(key => {
            const m = MARKETS[key];
            const active = key === market;
            return (
              <button
                key={key}
                onClick={() => handleMarketChange(key)}
                className="px-4 py-2 rounded text-sm font-bold tracking-wider transition-all duration-150 whitespace-nowrap"
                style={{
                  ...glassChipStyle(active ? m.color : undefined),
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontFamily: "var(--font-display)",
                }}
              >
                {m.short}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{cfg.description}</span>
        </div>

        {/* ── Timeframe selector + news marquee ── */}
        <div
          className="w-full flex items-center gap-3 px-6 py-2 shrink-0"
          style={{ background: "var(--bg-elevated)" }}
        >
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

          {/* Taylor + Bobby panel — BobbyPanel manages its own internal scroll now */}
          <aside
            className="shrink-0 overflow-hidden flex flex-col"
            style={{ width: "46%" }}
          >
            <BobbyPanel
              market={MARKETS[market]}
              analysis={analysis}
              opportunity={opportunity}
              livePrice={livePrice}
              onCheckOpportunity={handleCheckOpportunity}
              checkingOpportunity={checkingOpportunity}
            />
          </aside>
        </div>
      </motion.div>
      )}
    </>
  );
}
