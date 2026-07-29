"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import AxeChart from "./AxeChart";
import BobbyPanel from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult } from "../lib/analysis";
import { MARKETS, type MarketKey } from "../lib/markets";
import { createOpportunity, advanceOpportunity, takeTrade, skipTrade, closeTrade, livePnl, type Opportunity } from "../lib/opportunity";
import { playBreakoutSound, playRetestSound, playResolvedSound } from "../lib/alerts";

const MARKET_KEYS: MarketKey[] = ["nasdaq", "dowjones", "gold", "sp500"];

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

  const cfg = MARKETS[market];
  const analysisRef = useRef<AnalysisResult | null>(null);
  analysisRef.current = analysis;
  const symbolRef = useRef(cfg.symbol);
  symbolRef.current = cfg.symbol;
  const botModeRef = useRef(botMode);
  botModeRef.current = botMode;

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
    setOpportunity(null);
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
              setOpportunity(saved.opportunity ?? null);
            }
          }
        } catch { /* corrupt entry — ignore */ }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChartLoading(false); });

    return () => { cancelled = true; };
  }, [cfg.symbol]);

  // Called only when Ask Bobby / New Analysis is pressed
  const handleAnalysis = useCallback((result: AnalysisResult, c5m: RawCandle[], c1m: RawCandle[]) => {
    setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));
    setAnalysis(result);
    const opp = createOpportunity(result, MARKETS[market].slPoints);
    setOpportunity(opp);
    saveState(MARKETS[market].symbol, result, opp);
  }, [market]);

  // Every live tick advances the opportunity state machine
  const handleTick = useCallback((price: number) => {
    setLivePrice(price);
    setOpportunity(prev => {
      if (!prev) return prev;
      const next = advanceOpportunity(prev, price, botModeRef.current);
      if (next.phase !== prev.phase) {
        if (next.phase === "AWAIT_RETEST" && prev.phase === "HUNTING") playBreakoutSound();
        else if (next.phase === "RETEST_ACTIVE") playRetestSound();
        else if (next.phase === "TP_HIT") playResolvedSound(true);
        else if (next.phase === "SL_HIT") playResolvedSound(false);
        saveState(symbolRef.current, analysisRef.current, next);
      }
      return next;
    });
  }, []);

  const handleMarketChange = useCallback((key: MarketKey) => {
    setMarket(key);
    try { localStorage.setItem(STORAGE_MARKET, key); } catch { /* ignore */ }
  }, []);

  const handleToggleBot = useCallback(() => {
    setBotMode(v => {
      try { localStorage.setItem("axe-bot-mode", String(!v)); } catch { /* ignore */ }
      return !v;
    });
  }, []);

  const handleTakeTrade = useCallback(() => {
    setOpportunity(prev => {
      if (!prev) return prev;
      const next = takeTrade(prev);
      saveState(symbolRef.current, analysisRef.current, next);
      return next;
    });
  }, []);

  const handleSkipTrade = useCallback(() => {
    setOpportunity(prev => {
      if (!prev) return prev;
      const next = skipTrade(prev);
      saveState(symbolRef.current, analysisRef.current, next);
      return next;
    });
  }, []);

  const livePriceRef = useRef<number | null>(null);
  livePriceRef.current = livePrice;

  const handleCloseTrade = useCallback(() => {
    setOpportunity(prev => {
      if (!prev || livePriceRef.current === null) return prev;
      const next = closeTrade(prev, livePriceRef.current);
      if (next.phase === "CLOSED") {
        playResolvedSound(livePnl(next, livePriceRef.current) >= 0);
        saveState(symbolRef.current, analysisRef.current, next);
      }
      return next;
    });
  }, []);

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
      </div>

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
                tradeSetup={analysis?.tradeSetup ?? null}
                breakout={analysis?.breakout ?? null}
                accentColor={cfg.color}
                symbol={cfg.symbol}
                tdSymbol={cfg.tdSymbol}
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
                  <div className="font-black text-lg tracking-wider" style={{ color: opportunity.direction === "long" ? "#c9b845" : "#d64848" }}>
                    ⚡ RETEST ACTIVE — {opportunity.level.toFixed(2)}
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
                  <div className="text-5xl opacity-10">📈</div>
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
            onSkipTrade={handleSkipTrade}
            onCloseTrade={handleCloseTrade}
          />
        </aside>
      </div>
    </>
  );
}
