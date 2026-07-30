"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { FiBarChart2, FiZap, FiTrendingUp, FiArrowUpRight, FiArrowDownRight, FiX, FiCpu } from "react-icons/fi";
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
const MAX_AGE_MS = 24 * 3600 * 1000;

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
  const [taylorOpen, setTaylorOpen] = useState(false);

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
    });
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MARKET) as MarketKey | null;
      if (saved && MARKETS[saved]) setMarket(saved);
      const bot = localStorage.getItem("axe-bot-mode");
      if (bot !== null) setBotMode(bot === "true");
    } catch { /* storage unavailable */ }
  }, []);

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
  }, [cfg.symbol, updateOpportunity]);

  const handleAnalysis = useCallback((result: AnalysisResult, c5m: RawCandle[], c1m: RawCandle[]) => {
    setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));
    setAnalysis(result);
    const opp = createOpportunity(result, MARKETS[market].slPoints, tradeCostFor(MARKETS[market]));
    updateOpportunity(opp);
    saveState(MARKETS[market].symbol, result, opp);
  }, [market, updateOpportunity]);

  const handleTick = useCallback((price: number) => {
    setLivePrice(price);
    livePriceRef.current = price;
    const prev = opportunityRef.current;
    if (!prev) return;
    const next = advanceOpportunity(prev, price, botModeRef.current, analysisRef.current?.levels ?? []);
    opportunityRef.current = next;
    const levelChanged = next.level !== prev.level;
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

  // ── Derived display values ───────────────────────────────────────────────────
  const displayPrice = livePrice ?? analysis?.currentPrice ?? null;
  const priceUp = (analysis?.priceChange ?? 0) >= 0;
  const trendDir = analysis?.trend.direction ?? null;

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
            yahooTickFallback={cfg.yahooTickFallback}
            onTick={handleTick}
          />
          {opportunity?.phase === "RETEST_ACTIVE" && (
            <div
              className="absolute left-3 right-3 rounded-xl p-3 z-10"
              style={{
                top: "3.5rem",
                background: "rgba(1,5,3,0.96)",
                border: `2px solid ${opportunity.direction === "long" ? "#b89b28" : "#d64848"}`,
                boxShadow: `0 0 28px ${opportunity.direction === "long" ? "rgba(0,184,104,0.35)" : "rgba(204,58,58,0.35)"}`,
                backdropFilter: "blur(8px)",
              }}
            >
              <div className="flex items-center gap-2 font-black text-base tracking-wider" style={{ color: opportunity.direction === "long" ? "#b89b28" : "#d64848", fontFamily: "var(--font-display)" }}>
                <FiZap size={16} /> RETEST ACTIVO — {opportunity.level.toFixed(2)}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#c2d8ca" }}>
                {opportunity.direction === "long" ? "▲ LARGO" : "▼ CORTO"} · Confirma la vela antes de entrar
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          {chartLoading ? (
            <>
              <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Cargando {cfg.label}...</p>
            </>
          ) : (
            <>
              <FiTrendingUp size={40} className="opacity-10" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Error al cargar {cfg.label}</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <RecordsModal open={recordsOpen} onClose={() => setRecordsOpen(false)} />

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE LAYOUT  (< lg) — chart a pantalla completa
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden relative overflow-hidden" style={{ height: "100dvh" }}>

        {/* ── Chart — cubre toda la pantalla ── */}
        <div className="absolute inset-0">
          {chartBlock}
        </div>

        {/* ── Overlay superior: mercados + historial ── */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 pt-safe pt-3 pb-4"
          style={{ background: "linear-gradient(to bottom, rgba(1,5,3,0.88) 60%, transparent 100%)" }}
        >
          <div className="flex gap-1.5 flex-1">
            {MARKET_KEYS.map(key => {
              const m = MARKETS[key];
              const active = key === market;
              return (
                <button
                  key={key}
                  onClick={() => handleMarketChange(key)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-black tracking-wider transition-all duration-200"
                  style={{
                    background: active ? "var(--gold-dim)" : "rgba(255,255,255,0.06)",
                    color: active ? "var(--gold)" : "var(--text-muted)",
                    border: `1px solid ${active ? "var(--gold-border)" : "rgba(255,255,255,0.08)"}`,
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
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-secondary)",
              border: "1px solid rgba(255,255,255,0.08)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiBarChart2 size={13} />
          </button>
        </div>

        {/* ── Overlay inferior: precio + botón Taylor ── */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 flex items-end justify-between px-4 pb-8 pt-16"
          style={{ background: "linear-gradient(to top, rgba(1,5,3,0.92) 50%, transparent 100%)" }}
        >
          {/* Precio en vivo */}
          <div>
            {displayPrice !== null ? (
              <>
                <div className="text-3xl font-black text-white leading-none" style={{ fontFamily: "var(--font-display)" }}>
                  {displayPrice.toFixed(2)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {analysis && (
                    <span className="text-sm font-bold" style={{ color: priceUp ? "#00b868" : "#e05252" }}>
                      {priceUp ? "+" : ""}{analysis.priceChangePct.toFixed(2)}%
                    </span>
                  )}
                  {trendDir && (
                    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{
                      color: trendDir === "bullish" ? "#00b868" : trendDir === "bearish" ? "#e05252" : "var(--text-muted)"
                    }}>
                      {trendDir === "bullish" ? <FiArrowUpRight size={11} /> : trendDir === "bearish" ? <FiArrowDownRight size={11} /> : null}
                      {trendDir === "bullish" ? "ALCISTA" : trendDir === "bearish" ? "BAJISTA" : "NEUTRAL"}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>{cfg.label}</span>
            )}
          </div>

          {/* Botón Taylor */}
          <button
            onClick={() => setTaylorOpen(true)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-sm tracking-widest transition-all duration-150 active:scale-95"
            style={{
              background: "var(--gold-dim)",
              color: "var(--gold)",
              border: "1px solid var(--gold-border)",
              boxShadow: "0 0 20px rgba(184,155,40,0.25)",
              fontFamily: "var(--font-display)",
              cursor: "pointer",
            }}
          >
            <FiCpu size={15} /> TAYLOR
          </button>
        </div>

        {/* ── Taylor sheet — cubre pantalla completa ── */}
        <div
          className="absolute inset-0 z-50 flex flex-col transition-transform duration-300 ease-out"
          style={{
            transform: taylorOpen ? "translateY(0)" : "translateY(100%)",
            background: "var(--bg-panel)",
          }}
        >
          {/* Header del sheet */}
          <div
            className="shrink-0 flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--gold-border)" }}
          >
            <span className="font-black tracking-[0.25em] text-base" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>
              TAYLOR
            </span>
            <button
              onClick={() => setTaylorOpen(false)}
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--text-secondary)", cursor: "pointer" }}
            >
              <FiX size={20} />
            </button>
          </div>

          {/* Contenido scrollable */}
          <div className="flex-1 overflow-y-auto pb-8">
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
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DESKTOP LAYOUT  (>= lg)
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex lg:flex-col lg:flex-1 overflow-hidden">

        {/* ── Top bar ── */}
        <div
          className="flex items-center gap-1 px-4 py-2 shrink-0 overflow-x-auto"
          style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--gold-border)" }}
        >
          {MARKET_KEYS.map(key => {
            const m = MARKETS[key];
            const active = key === market;
            return (
              <button
                key={key}
                onClick={() => handleMarketChange(key)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider transition-all duration-150 whitespace-nowrap"
                style={{
                  background: active ? "var(--gold-dim)" : "transparent",
                  color: active ? "var(--gold)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--gold-border)" : "transparent"}`,
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
              background: "rgba(0,184,104,0.08)",
              color: "var(--gold)",
              border: "1px solid rgba(0,184,104,0.3)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiBarChart2 size={13} /> HISTORIAL
          </button>
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
            style={{ width: "46%", borderLeft: "1px solid rgba(0,184,104,0.2)" }}
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
            />
          </aside>
        </div>
      </div>
    </>
  );
}
