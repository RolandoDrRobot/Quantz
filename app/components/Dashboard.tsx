"use client";

import { useState, useCallback, useEffect } from "react";
import AxeChart from "./AxeChart";
import BobbyPanel from "./BobbyPanel";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult } from "../lib/analysis";
import { MARKETS, type MarketKey } from "../lib/markets";

const MARKET_KEYS: MarketKey[] = ["nasdaq", "dowjones", "gold", "sp500"];

export default function Dashboard() {
  const [market, setMarket] = useState<MarketKey>("nasdaq");
  const [chartCandles, setChartCandles] = useState<RawCandle[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const cfg = MARKETS[market];

  // Auto-load chart candles on market switch — no analysis, no tokens
  useEffect(() => {
    setChartCandles([]);
    setAnalysis(null);
    setChartLoading(true);
    let cancelled = false;

    fetch(`/api/market?symbol=${encodeURIComponent(cfg.symbol)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const c1m: RawCandle[] = data.candles1m ?? [];
        const c5m: RawCandle[] = data.candles5m ?? [];
        setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChartLoading(false); });

    return () => { cancelled = true; };
  }, [cfg.symbol]);

  // Called only when Ask Bobby is pressed — updates chart with fresh candles + analysis
  const handleAnalysis = useCallback((result: AnalysisResult, c5m: RawCandle[], c1m: RawCandle[]) => {
    setChartCandles(c1m.length >= 10 ? c1m : c5m.slice(-500));
    setAnalysis(result);
  }, []);

  const handleMarketChange = useCallback((key: MarketKey) => {
    setMarket(key);
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
            <AxeChart
              candles={chartCandles}
              levels={analysis?.levels ?? []}
              ma20={analysis?.trend.ma20 ?? 0}
              tradeSetup={analysis?.tradeSetup ?? null}
              breakout={analysis?.breakout ?? null}
              accentColor={cfg.color}
              symbol={cfg.symbol}
              tdSymbol={cfg.tdSymbol}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              {chartLoading ? (
                <>
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>Cargando {cfg.label}...</p>
                </>
              ) : (
                <>
                  <div className="text-5xl opacity-10">📈</div>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>No se pudo cargar {cfg.label}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Panel */}
        <aside className="w-1/2 shrink-0 border-l border-[rgba(212,175,55,0.2)] overflow-y-auto">
          <BobbyPanel market={MARKETS[market]} onAnalysis={handleAnalysis} />
        </aside>
      </div>
    </>
  );
}
