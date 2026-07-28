"use client";

import { useState, useEffect, useCallback } from "react";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import type { Market } from "../lib/markets";

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; icon: string }> = {
  GO_LONG:  { label: "GO LONG",  color: "#22885a", bg: "rgba(34,136,90,0.08)",   border: "rgba(34,136,90,0.28)",   icon: "▲" },
  GO_SHORT: { label: "GO SHORT", color: "#8e2424", bg: "rgba(142,36,36,0.1)",    border: "rgba(142,36,36,0.35)",   icon: "▼" },
  WAIT:     { label: "WAIT",     color: "#b8922a", bg: "rgba(212,175,55,0.07)",  border: "rgba(212,175,55,0.22)",  icon: "◆" },
};

function Clock({ is24h }: { is24h: boolean }) {
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
        setStatusLabel("24/7 Market — Always Open");
        setStatusColor("#f7931a");
        return;
      }

      const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay();
      const totalMin = et.getHours() * 60 + et.getMinutes();
      const openMin = 9 * 60 + 30;

      if (day === 0 || day === 6) {
        setStatusLabel("Weekend — Market Closed"); setStatusColor("#6b7280");
      } else if (totalMin < openMin - 30) {
        setStatusLabel(`Pre-market — Opens in ${openMin - totalMin}min`); setStatusColor("#f59e0b");
      } else if (totalMin < openMin) {
        setStatusLabel(`⚡ OPEN IN ${openMin - totalMin}MIN — MARK YOUR LEVELS`); setStatusColor("#d4af37");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`🔥 SETUP WINDOW — ${30 - (totalMin - openMin)}min left`); setStatusColor("#00d26a");
      } else if (totalMin < 16 * 60) {
        setStatusLabel("Market Open — Window Closed"); setStatusColor("#6b7280");
      } else {
        setStatusLabel("Market Closed"); setStatusColor("#6b7280");
      }
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [is24h]);

  return (
    <div className="p-4" style={{ borderBottom: "1px solid var(--gold-border)" }}>
      <div className="text-xl font-bold tracking-widest" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>{time}</div>
      <div className="text-xs mt-1 font-semibold" style={{ color: statusColor }}>{statusLabel}</div>
      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Costa Rica (UTC-6)</div>
    </div>
  );
}

interface Props {
  market: Market;
  onAnalysis: (result: AnalysisResult, candles5m: RawCandle[], candles1m: RawCandle[]) => void;
}

export default function BobbyPanel({ market, onAnalysis }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [candleCount, setCandleCount] = useState(0);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/market?symbol=${encodeURIComponent(market.symbol)}`, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to fetch market data");
      }
      const data = await res.json();
      setCandleCount(data.candles5m.length);

      const { runAnalysis } = await import("../lib/analysis");
      const analysis = runAnalysis(
        data.candles5m,
        data.currentPrice,
        data.prevClose,
        market.is24h,
        market.slPoints,
        market.label
      );
      setResult(analysis);
      onAnalysis(analysis, data.candles5m, data.candles1m ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [market, onAnalysis]);

  // Reset panel state when market changes — analysis only runs on button press
  useEffect(() => {
    setResult(null);
    setError("");
    setCandleCount(0);
  }, [market]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-panel)" }}>

      {/* Header */}
      <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <div className="font-black text-base tracking-[0.25em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>BOBBY&apos;S COUNCIL</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {market.label} {candleCount > 0 ? `· ${candleCount} velas` : ""}
        </div>
      </div>

      <Clock is24h={market.is24h} />

      {/* Precio actual */}
      {result && (
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--gold-border)", background: "var(--bg-elevated)" }}>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>PRECIO ACTUAL</div>
              <div className="font-black text-2xl text-white" style={{ fontFamily: "var(--font-display)" }}>{result.currentPrice.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="font-mono font-bold text-lg" style={{ color: result.priceChange >= 0 ? "#23a065" : "#b02828" }}>
                {result.priceChange >= 0 ? "+" : ""}{result.priceChangePct.toFixed(2)}%
              </div>
              <div className="text-xs mt-0.5" style={{ color: result.trend.direction === "bullish" ? "#23a065" : result.trend.direction === "bearish" ? "#b02828" : "var(--text-muted)" }}>
                {result.trend.direction === "bullish" ? "▲ TENDENCIA ARRIBA" : result.trend.direction === "bearish" ? "▼ TENDENCIA ABAJO" : "→ SIN TENDENCIA"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Estado de breakout */}
      {result?.breakout && (
        <div className="mx-5 mb-1 rounded p-3" style={{
          background: result.breakout.direction === "long" ? "rgba(255,229,102,0.07)" : "rgba(255,96,96,0.07)",
          border: `1px solid ${result.breakout.direction === "long" ? "rgba(255,229,102,0.35)" : "rgba(255,96,96,0.35)"}`,
        }}>
          <div className="font-black text-sm tracking-wider" style={{ color: result.breakout.direction === "long" ? "#ffe566" : "#ff6060" }}>
            ⚡ BREAKOUT DETECTADO
          </div>
          <div className="text-base font-mono font-bold text-white mt-1">{result.breakout.level.toFixed(2)}</div>
          <div className="text-xs mt-1" style={{ color: "#a0a0b8" }}>
            {result.breakout.direction === "long" ? "▲ Rompió resistencia" : "▼ Rompió soporte"} · Fuerza: {result.breakout.strength}x
          </div>
          <div className="text-xs mt-2 font-medium" style={{ color: "#d8d8e8" }}>
            Esperando que el precio regrese a {result.breakout.level.toFixed(2)} para retest → alerta sonora al llegar
          </div>
        </div>
      )}

      {!result?.breakout && result && (
        <div className="mx-5 mb-1 rounded px-3 py-2 text-xs" style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-muted)" }}>
          Sin breakout reciente detectado en los últimos 2 horas
        </div>
      )}

      {/* Botón */}
      <div className="px-5 py-4">
        <button
          onClick={analyze}
          disabled={loading}
          className="w-full py-4 rounded font-black text-base tracking-widest transition-all duration-150"
          style={{
            background: loading ? "rgba(212,175,55,0.08)" : "#d4af37",
            color: loading ? "#d4af37" : "#03030a",
            border: "1px solid rgba(212,175,55,0.5)",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "1rem",
            fontFamily: "var(--font-display)",
          }}
        >
          {loading ? "CARGANDO..." : "ASK BOBBY"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-4 p-3 rounded text-sm" style={{ background: "rgba(180,30,30,0.15)", border: "1px solid rgba(180,30,30,0.4)", color: "#ff6060" }}>
          {error}
        </div>
      )}

      {/* Trade Setup — lo más importante */}
      {result?.tradeSetup && (
        <div className="mx-5 mb-4 rounded overflow-hidden" style={{ border: "1px solid var(--gold-border)" }}>
          <div className="px-4 py-2 text-xs font-bold tracking-widest" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            NIVELES DEL TRADE (EN EL GRÁFICO)
          </div>
          {/* Entry */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid rgba(255,229,102,0.15)" }}>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 rounded" style={{ background: "#ffe566" }} />
              <span className="font-bold text-sm" style={{ color: "#ffe566" }}>ENTRADA</span>
            </div>
            <span className="font-bold text-base text-white" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.entryPrice.toFixed(2)}</span>
          </div>
          {/* SL */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid rgba(255,48,48,0.15)" }}>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 rounded" style={{ background: "#ff3030" }} />
              <span className="font-bold text-sm" style={{ color: "#ff3030" }}>STOP LOSS</span>
            </div>
            <div className="text-right">
              <div className="font-bold text-base text-white" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.stopLoss.toFixed(2)}</div>
              <div className="text-xs font-bold" style={{ color: "#ff3030" }}>−$100</div>
            </div>
          </div>
          {/* TP */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid rgba(48,255,144,0.15)" }}>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 rounded" style={{ background: "#30ff90" }} />
              <span className="font-bold text-sm" style={{ color: "#30ff90" }}>TAKE PROFIT</span>
            </div>
            <div className="text-right">
              <div className="font-bold text-base text-white" style={{ fontFamily: "var(--font-display)" }}>{result.tradeSetup.takeProfit.toFixed(2)}</div>
              <div className="text-xs font-bold" style={{ color: "#30ff90" }}>+${result.tradeSetup.rewardAmount} · R:R {result.tradeSetup.rrRatio}</div>
            </div>
          </div>
        </div>
      )}

      {/* Señal de Bobby */}
      {result && sig && (
        <div className="mx-5 mb-5 rounded p-5" style={{ background: sig.bg, border: `2px solid ${sig.border}` }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl font-black" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.icon}</span>
            <span className="text-2xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
          </div>
          <p className="leading-relaxed" style={{ color: "#d8d8e8", fontSize: "0.9rem" }}>{result.message}</p>
          {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
            <div className="mt-4 pt-3 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
              Ventana de setup en {result.minutesToOpen} min. Este es el sesgo direccional previo al open.
            </div>
          )}
        </div>
      )}

      {/* Empty */}
      {!result && !loading && !error && (
        <div className="px-5 py-8 text-center" style={{ color: "var(--text-muted)" }}>
          <div className="text-5xl mb-4 opacity-20">⚡</div>
          <p className="text-base">Presiona <strong style={{ color: "var(--gold)" }}>Ask Bobby</strong> para analizar {market.label}.</p>
          <p className="text-sm mt-2 opacity-60">Los niveles, entrada, SL y TP<br/>aparecen en el gráfico.</p>
        </div>
      )}
    </div>
  );
}
