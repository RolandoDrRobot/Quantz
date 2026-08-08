"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { FiBarChart2, FiZap, FiTrendingUp, FiArrowUpRight, FiArrowDownRight, FiCpu } from "react-icons/fi";
import AxeChart from "./AxeChart";
import BobbyPanel, { PHASE_META } from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, TradeSetup, BreakoutEvent } from "../lib/analysis";
import { MARKETS, type MarketKey } from "../lib/markets";
import RecordsModal from "./RecordsModal";
import { createOpportunity, advanceOpportunity, takeTrade, enterAtMarket, closeTrade, livePnl, type Opportunity } from "../lib/opportunity";
import { playBreakoutSound, playRetestSound, playResolvedSound } from "../lib/alerts";
import { toast } from "sonner";
import { addRecord } from "../lib/records";
import { ACCOUNT, tradeCostFor } from "../lib/markets";

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
  const [checkingOpportunity, setCheckingOpportunity] = useState(false);
  const [recordsVersion, setRecordsVersion] = useState(0);

  const cfg = MARKETS[market];
  const analysisRef = useRef<AnalysisResult | null>(null);
  const symbolRef = useRef(cfg.symbol);
  const botModeRef = useRef(botMode);
  const marketShortRef = useRef<string>(cfg.short);
  const livePriceRef = useRef<number | null>(null);

  // Callbacks (handleTick, recordTrade, etc.) read these refs instead of
  // closing over state, so they always see the latest value without being
  // recreated every render — synced here rather than during render.
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
  useEffect(() => { symbolRef.current = cfg.symbol; }, [cfg.symbol]);
  useEffect(() => { botModeRef.current = botMode; }, [botMode]);
  useEffect(() => { marketShortRef.current = cfg.short; }, [cfg.short]);
  useEffect(() => { livePriceRef.current = livePrice; }, [livePrice]);

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
    setRecordsVersion(v => v + 1);
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
        setChartCandles(pickChartCandles(c1m, c5m, cfg.slPoints));
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
    setChartCandles(pickChartCandles(c1m, c5m, MARKETS[market].slPoints));
    setAnalysis(result);
    const opp = createOpportunity(result, MARKETS[market].slPoints, tradeCostFor(MARKETS[market]));
    updateOpportunity(opp);
    saveState(MARKETS[market].symbol, result, opp);
    const sig = result.signal === "GO_LONG" ? "▲ largo" : result.signal === "GO_SHORT" ? "▼ corto" : "espera";
    toast(`taylor · ${sig} · ${result.probability}%`, { duration: 3000 });
  }, [market, updateOpportunity]);

  // Shared by both the live WS tick stream and the manual "check opportunity"
  // button, so a manual check goes through exactly the same state machine —
  // announce is only set for the manual path, to report back even when
  // nothing changed (the WS path stays silent unless the phase moves).
  const advancePrice = useCallback((price: number, announce = false) => {
    setLivePrice(price);
    livePriceRef.current = price;
    const prev = opportunityRef.current;
    if (!prev) {
      if (announce) toast(`Precio actualizado · ${price.toFixed(2)}`, { duration: 2500 });
      return;
    }
    const next = advanceOpportunity(prev, price, botModeRef.current, analysisRef.current?.levels ?? []);
    opportunityRef.current = next;
    const levelChanged = next.level !== prev.level;
    const transitioned = next.phase !== prev.phase || levelChanged;
    if (transitioned) {
      setOpportunity(next);
      if (levelChanged) playBreakoutSound();
      else if (next.phase === "AWAIT_RETEST" && prev.phase === "HUNTING") {
        playBreakoutSound();
        toast(`breakout ${next.direction === "long" ? "▲" : "▼"} ${next.level.toFixed(2)} — espera retest`, { duration: 5000 });
      }
      else if (next.phase === "RETEST_ACTIVE") {
        playRetestSound();
        toast.warning(`retest activo · ${next.level.toFixed(2)}`, { duration: 6000 });
      }
      else if (next.phase === "TP_HIT") {
        playResolvedSound(true);
        recordTrade(next, "TP", next.tp);
        toast.success(`tp · ${next.tp.toFixed(2)}`, { duration: 4000 });
      }
      else if (next.phase === "SL_HIT") {
        playResolvedSound(false);
        recordTrade(next, "SL", next.sl);
        toast.error(`sl · ${next.sl.toFixed(2)}`, { duration: 4000 });
      }
      saveState(symbolRef.current, analysisRef.current, next);
    }
    if (announce && !transitioned) {
      const pnl = next.phase === "CONFIRMED" ? livePnl(next, price) : null;
      const pnlPart = pnl !== null ? ` · ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}` : "";
      toast(`Sin cambios · ${PHASE_META[next.phase].label} · ${price.toFixed(2)}${pnlPart}`, { duration: 3500 });
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
      if (symbolRef.current !== requestSymbol) return;
      if (!res.ok) { toast.error("No se pudo verificar el mercado"); return; }
      const data = await res.json();
      if (symbolRef.current !== requestSymbol) return;
      if (typeof data.currentPrice === "number") {
        advancePrice(data.currentPrice, true);
      } else {
        toast.error("Respuesta de mercado inválida — intenta de nuevo");
      }
    } catch {
      if (symbolRef.current === requestSymbol) toast.error("Error de red al verificar");
    } finally {
      setCheckingOpportunity(false);
    }
  }, [advancePrice]);

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
            binanceSymbol={cfg.binanceSymbol}
            onTick={handleTick}
          />
          {opportunity?.phase === "RETEST_ACTIVE" && (
            <div
              className="absolute left-4 right-4 rounded-2xl p-4 z-10"
              style={{
                top: "3.5rem",
                background: "rgba(5,14,26,0.96)",
                border: `2px solid ${opportunity.direction === "long" ? "#c23b30" : "#8a2f2a"}`,
                boxShadow: `0 0 28px ${opportunity.direction === "long" ? "rgba(28,125,76,0.35)" : "rgba(138,47,42,0.35)"}`,
                backdropFilter: "blur(8px)",
              }}
            >
              <div className="flex items-center gap-2 font-black text-lg tracking-wider" style={{ color: opportunity.direction === "long" ? "#c23b30" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                <FiZap size={16} /> RETEST ACTIVO — {opportunity.level.toFixed(2)}
              </div>
              <div className="text-sm mt-0.5" style={{ color: "#8792a0" }}>
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
              <p className="text-base" style={{ color: "var(--text-muted)" }}>Cargando {cfg.label}...</p>
            </>
          ) : (
            <>
              <FiTrendingUp size={40} className="opacity-10" style={{ color: "var(--text-muted)" }} />
              <p className="text-base" style={{ color: "var(--text-muted)" }}>Error al cargar {cfg.label}</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <RecordsModal open={recordsOpen} onClose={() => setRecordsOpen(false)} refreshToken={recordsVersion} />

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE LAYOUT  (< lg) — chart a pantalla completa
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden relative overflow-hidden" style={{ height: "100dvh" }}>

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
          <span className="font-black text-lg tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>QUANTZ</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-2 flex-1">
              {MARKET_KEYS.map(key => {
                const m = MARKETS[key];
                const active = key === market;
                return (
                  <button
                    key={key}
                    onClick={() => handleMarketChange(key)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-black tracking-wider transition-all duration-200"
                    style={{
                      background: active ? "var(--gold-dim)" : "rgba(255,255,255,0.06)",
                      color: active ? "var(--text-primary)" : "var(--text-muted)",
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
              className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-bold"
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
        </div>

        {/* ── Overlay inferior: precio + botón Taylor ── */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 flex items-end justify-between px-5 pt-16"
          style={{
            background: "linear-gradient(to top, rgba(5,14,26,0.92) 50%, transparent 100%)",
            // Clears the home-indicator gesture bar on notched iOS devices.
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2.25rem)",
          }}
        >
          {/* Precio en vivo */}
          <div>
            {displayPrice !== null ? (
              <>
                <div className="text-4xl font-black text-white leading-none" style={{ fontFamily: "var(--font-display)" }}>
                  {displayPrice.toFixed(2)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {analysis && (
                    <span className="text-base font-bold" style={{ color: priceUp ? "#1c7d4c" : "#8a2f2a" }}>
                      {priceUp ? "+" : ""}{analysis.priceChangePct.toFixed(2)}%
                    </span>
                  )}
                  {trendDir && (
                    <span className="flex items-center gap-0.5 text-sm font-semibold" style={{
                      color: trendDir === "bullish" ? "#1c7d4c" : trendDir === "bearish" ? "#8a2f2a" : "var(--text-muted)"
                    }}>
                      {trendDir === "bullish" ? <FiArrowUpRight size={11} /> : trendDir === "bearish" ? <FiArrowDownRight size={11} /> : null}
                      {trendDir === "bullish" ? "ALCISTA" : trendDir === "bearish" ? "BAJISTA" : "NEUTRAL"}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-base" style={{ color: "var(--text-muted)" }}>{cfg.label}</span>
            )}
          </div>

          {/* Botón Taylor */}
          <button
            onClick={() => setTaylorOpen(true)}
            className="flex items-center gap-2 px-6 py-4 rounded-2xl font-black text-base tracking-widest transition-all duration-150 active:scale-95"
            style={{
              background: "var(--gold-dim)",
              color: "var(--gold)",
              border: "1px solid var(--gold-border)",
              boxShadow: "0 0 20px rgba(194,59,48,0.25)",
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
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
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
              onClose={() => setTaylorOpen(false)}
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
                className="px-4 py-2 rounded-xl text-sm font-bold tracking-wider transition-all duration-150 whitespace-nowrap"
                style={{
                  background: active ? "var(--gold-dim)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--gold-border)" : "transparent"}`,
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
            onClick={() => setRecordsOpen(true)}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold tracking-wider whitespace-nowrap shrink-0"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
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
            />
          </aside>
        </div>
      </div>
    </>
  );
}
