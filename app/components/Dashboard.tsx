"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { FiBarChart2, FiZap, FiTrendingUp } from "react-icons/fi";
import AxeChart from "./AxeChart";
import BobbyPanel from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, TradeSetup, BreakoutEvent } from "../lib/analysis";
import { MARKETS, type MarketKey } from "../lib/markets";
import RecordsModal from "./RecordsModal";
import { createOpportunity, advanceOpportunity, takeTrade, enterAtMarket, closeTrade, livePnl, type Opportunity } from "../lib/opportunity";
import { playBreakoutSound, playRetestSound, playResolvedSound } from "../lib/alerts";
import { addRecord } from "../lib/records";
import { ACCOUNT, tradeCostFor } from "../lib/markets";

const MARKET_KEYS: MarketKey[] = ["nasdaq", "dowjones", "gold"];

const STORAGE_MARKET = "axe-market";
const storageKey = (symbol: string) => `axe-analysis-${symbol}`;
const MAX_AGE_MS = 24 * 3600 * 1000; // saved analysis expires after 24h

function saveState(symbol: string, analysis: AnalysisResult | null, opportunity: Opportunity | null) {
  try {
    if (!analysis) return;
    localStorage.setItem(storageKey(symbol), JSON.stringify({ analysis, opportunity, savedAt: Date.now() }));
  } catch { /* storage unavailable */ }
}

export default function Dashboard() {
  const [market, setMarket] = useState<MarketKey>("nasdaq");
  const [chartCandles, setChartCandles] = useState<RawCandle[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [botMode, setBotMode] = useState(true);
  const [recordsOpen, setRecordsOpen] = useState(false);

  const cfg = MARKETS[market];
  const analysisRef = useRef<AnalysisResult | null>(null);
  analysisRef.current = analysis;
  const symbolRef = useRef(cfg.symbol);
  symbolRef.current = cfg.symbol;
  const botModeRef = useRef(botMode);
  botModeRef.current = botMode;
  const marketShortRef = useRef<string>(cfg.short);
  marketShortRef.current = cfg.short;
  const livePriceRef = useRef<number | null>(null);
  livePriceRef.current = livePrice;

  // The opportunity lives in a ref (single source of truth for transitions) and
  // is mirrored to state for rendering. All side effects (records, sounds,
  // persistence) run OUTSIDE React state updaters — updaters can be invoked
  // twice in dev, which double-fired them (e.g. trades recorded twice).
  const opportunityRef = useRef<Opportunity | null>(null);
  const updateOpportunity = useCallback((next: Opportunity | null) => {
    opportunityRef.current = next;
    setOpportunity(next);
  }, []);

  // Every resolved trade (TP, SL or manual close) lands in the records
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
    });
  }, []);

  // Restore last selected market + bot mode on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MARKET) as MarketKey | null;
      if (saved && MARKETS[saved]) setMarket(saved);
      const bot = localStorage.getItem("axe-bot-mode");
      if (bot !== null) setBotMode(bot === "true");
    } catch { /* storage unavailable */ }
  }, []);

  // Auto-load chart candles on market switch, then restore any saved analysis
  useEffect(() => {
    setChartCandles([]);
    setAnalysis(null);
    updateOpportunity(null);
    setLivePrice(null);
    setChartLoading(true);
    let cancelled = false;

    fetch(`/api/market?symbol=${encodeURIComponent(cfg.symbol)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const c1m: RawCandle[] = data.candles1m ?? [];
        const c5m: RawCandle[] = data.candles5m ?? [];
        setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));

        // Restore persisted analysis + opportunity for this market
        try {
          const raw = localStorage.getItem(storageKey(cfg.symbol));
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.analysis && Date.now() - (saved.savedAt ?? 0) < MAX_AGE_MS) {
              setAnalysis(saved.analysis);
              updateOpportunity(saved.opportunity ?? null);
            }
          }
        } catch { /* corrupt entry — ignore */ }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChartLoading(false); });

    return () => { cancelled = true; };
  }, [cfg.symbol, updateOpportunity]);

  // Called only when Ask Bobby / New Analysis is pressed
  const handleAnalysis = useCallback((result: AnalysisResult, c5m: RawCandle[], c1m: RawCandle[]) => {
    setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));
    setAnalysis(result);
    const opp = createOpportunity(result, MARKETS[market].slPoints, tradeCostFor(MARKETS[market]));
    updateOpportunity(opp);
    saveState(MARKETS[market].symbol, result, opp);
  }, [market, updateOpportunity]);

  // Every live tick advances the opportunity state machine.
  // Transitions run against the ref (synchronous, exactly once per tick),
  // and the state mirror only updates on a phase change to avoid re-rendering
  // the whole panel on every tick.
  const handleTick = useCallback((price: number) => {
    setLivePrice(price);
    livePriceRef.current = price;

    const prev = opportunityRef.current;
    if (!prev) return;
    const next = advanceOpportunity(prev, price, botModeRef.current, analysisRef.current?.levels ?? []);
    opportunityRef.current = next;

    const levelChanged = next.level !== prev.level; // dynamic re-anchor to a closer broken level
    if (next.phase !== prev.phase || levelChanged) {
      setOpportunity(next);
      if (levelChanged) playBreakoutSound();
      else if (next.phase === "AWAIT_RETEST" && prev.phase === "HUNTING") playBreakoutSound();
      else if (next.phase === "RETEST_ACTIVE") playRetestSound();
      else if (next.phase === "TP_HIT") { playResolvedSound(true); recordTrade(next, "TP", next.tp); }
      else if (next.phase === "SL_HIT") { playResolvedSound(false); recordTrade(next, "SL", next.sl); }
      saveState(symbolRef.current, analysisRef.current, next);
    }
  }, [recordTrade]);

  const handleMarketChange = useCallback((key: MarketKey) => {
    setMarket(key);
    try { localStorage.setItem(STORAGE_MARKET, key); } catch { /* ignore */ }
  }, []);

  // Chart lines follow the LIVE opportunity (which can re-anchor to new levels),
  // falling back to the static analysis when no opportunity exists
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

  const handleToggleBot = useCallback(() => {
    const next = !botModeRef.current;
    try { localStorage.setItem("axe-bot-mode", String(next)); } catch { /* ignore */ }
    setBotMode(next);
  }, []);

  const handleTakeTrade = useCallback(() => {
    const prev = opportunityRef.current;
    if (!prev || livePriceRef.current === null) return;
    const next = takeTrade(prev, livePriceRef.current);
    if (next === prev) return;
    updateOpportunity(next);
    saveState(symbolRef.current, analysisRef.current, next);
  }, [updateOpportunity]);

  const handleMarketEntry = useCallback(() => {
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

  return (
    <>
      {/* Market selector */}
      <div className="flex items-center gap-1 px-4 py-2 shrink-0 overflow-x-auto" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--gold-border)" }}>
        {MARKET_KEYS.map(key => {
          const m = MARKETS[key];
          const active = key === market;
          return (
            <button
              key={key}
              onClick={() => handleMarketChange(key)}
              className="px-3 py-1.5 rounded text-xs font-bold tracking-wider transition-all duration-150 whitespace-nowrap"
              style={{
                background: active ? m.color + "18" : "transparent",
                color: active ? m.color : "var(--text-muted)",
                border: `1px solid ${active ? m.color + "55" : "transparent"}`,
                cursor: "pointer",
                fontFamily: "var(--font-display)",
              }}
            >
              {m.short}
            </button>
          );
        })}
        <span className="ml-2 text-[10px] whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{cfg.description}</span>
        <button
          onClick={() => setRecordsOpen(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider whitespace-nowrap shrink-0"
          style={{
            background: "rgba(184,155,40,0.08)",
            color: "var(--gold)",
            border: "1px solid rgba(184,155,40,0.3)",
            cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <FiBarChart2 size={13} /> RECORDS
        </button>
      </div>

      <RecordsModal open={recordsOpen} onClose={() => setRecordsOpen(false)} />

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chart */}
        <div className="flex-1 min-w-0 relative">
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
                yahooTickFallback={cfg.yahooTickFallback}
                onTick={handleTick}
              />
              {/* Retest alert overlay */}
              {opportunity?.phase === "RETEST_ACTIVE" && (
                <div
                  className="absolute left-3 right-3 rounded-lg p-4 z-10"
                  style={{
                    top: "3.5rem",
                    background: "rgba(3,11,6,0.97)",
                    border: `2px solid ${opportunity.direction === "long" ? "#c9b845" : "#d64848"}`,
                    boxShadow: `0 0 24px ${opportunity.direction === "long" ? "rgba(201,184,69,0.4)" : "rgba(214,72,72,0.4)"}`,
                  }}
                >
                  <div className="flex items-center gap-2 font-black text-lg tracking-wider" style={{ color: opportunity.direction === "long" ? "#c9b845" : "#d64848" }}>
                    <FiZap size={18} /> RETEST ACTIVE — {opportunity.level.toFixed(2)}
                  </div>
                  <div className="text-sm mt-0.5" style={{ color: "#c2d8ca" }}>
                    {opportunity.direction === "long" ? "▲ LONG" : "▼ SHORT"} · Confirm the candle before entering
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              {chartLoading ? (
                <>
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading {cfg.label}...</p>
                </>
              ) : (
                <>
                  <FiTrendingUp size={48} className="opacity-10" style={{ color: "var(--text-muted)" }} />
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Failed to load {cfg.label}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Panel */}
        <aside className="w-1/2 shrink-0 border-l border-[rgba(184,155,40,0.2)] overflow-y-auto">
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
          />
        </aside>
      </div>
    </>
  );
}
