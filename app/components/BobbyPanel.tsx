"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { IconType } from "react-icons";
import {
  FiTrendingUp, FiTrendingDown, FiPauseCircle, FiPower,
  FiAlertTriangle, FiRefreshCw, FiZap, FiCpu, FiArrowUpRight, FiArrowDownRight, FiCheck, FiX, FiMinus,
} from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, tradeCostFor, type Market } from "../lib/markets";
import { livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; Icon: IconType }> = {
  GO_LONG:  { label: "LARGO",  color: "#1c7d4c", bg: "rgba(28,125,76,0.07)",    border: "rgba(28,125,76,0.35)",    Icon: FiTrendingUp },
  GO_SHORT: { label: "CORTO",  color: "#8a2f2a", bg: "rgba(138,47,42,0.07)",    border: "rgba(138,47,42,0.35)",    Icon: FiTrendingDown },
  WAIT:     { label: "ESPERA", color: "#c23b30", bg: "rgba(194,59,48,0.07)",  border: "rgba(194,59,48,0.30)",  Icon: FiPauseCircle },
};

export const PHASE_META: Record<OppPhase, { label: string; color: string; step: number }> = {
  HUNTING:       { label: "BUSCANDO BREAKOUT",          color: "#9ba5b2", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT — ESPERANDO RETEST", color: "#c23b30", step: 1 },
  RETEST_ACTIVE: { label: "RETEST ACTIVO",              color: "#d9584b", step: 2 },
  CONFIRMED:     { label: "POSICIÓN ABIERTA",           color: "#1c7d4c", step: 3 },
  TP_HIT:        { label: "TAKE PROFIT",                color: "#1c7d4c", step: 4 },
  SL_HIT:        { label: "STOP LOSS",                  color: "#8a2f2a", step: 4 },
  CLOSED:        { label: "CERRADO MANUAL",             color: "#c23b30", step: 4 },
  INVALIDATED:   { label: "SETUP INVÁLIDO",             color: "#8a2f2a", step: 4 },
};


function probColor(p: number) {
  if (p >= 70) return "#1c7d4c";
  if (p >= 45) return "#c23b30";
  return "#8a2f2a";
}
function probLabel(p: number) {
  if (p >= 70) return "ALTA";
  if (p >= 45) return "MEDIA";
  return "BAJA";
}

// ── Per-factor status: full check, partial dash, or missed × ────────────────
function factorVisual(pct: number): { Icon: IconType; color: string } {
  if (pct >= 100) return { Icon: FiCheck, color: "#1c7d4c" };
  if (pct <= 0) return { Icon: FiX, color: "#8a2f2a" };
  return { Icon: FiMinus, color: "#c23b30" };
}

// ── Circular probability gauge ───────────────────────────────────────────────
function ProbRing({ value }: { value: number }) {
  const c = probColor(value);
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={R} fill="none"
          stroke={c} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
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
        setStatusLabel("Mercado 24h — Abierto");
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
        setStatusLabel("Fin de semana — Cerrado"); setStatusColor("#6b7280");
      } else if (totalMin < openMin - 30) {
        setStatusLabel(`Pre-market — abre en ${openMin - totalMin}min`); setStatusColor("#f59e0b");
      } else if (totalMin < setupStart) {
        setStatusLabel(`ABRE EN ${setupStart - totalMin}MIN — MARCA TUS NIVELES`); setStatusColor("#1c7d4c");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`VENTANA DE SETUP — ${30 - (totalMin - setupStart)}min restantes`); setStatusColor("#1c7d4c");
      } else if (totalMin < 16 * 60) {
        setStatusLabel("Abierto — ventana cerrada"); setStatusColor("#6b7280");
      } else {
        setStatusLabel("Mercado cerrado"); setStatusColor("#6b7280");
      }
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [is24h]);

  return (
    <div className="text-right">
      <div className="text-xl font-bold tracking-widest leading-none" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>{time}</div>
      <div className="text-sm mt-1 font-semibold" style={{ color: statusColor }}>{statusLabel}</div>
    </div>
  );
}


// ── The Trade card — everything about the position in one place ──────────────
function TradeCard({
  opp, price, bot, lots, onTakeTrade, onMarketEntry, onCloseTrade, onCheckOpportunity, checking, onToggleBot,
}: {
  opp: Opportunity;
  price: number | null;
  bot: boolean;
  lots: number;
  onTakeTrade: () => void;
  onMarketEntry: () => void;
  onCloseTrade: () => void;
  onCheckOpportunity: () => void;
  checking: boolean;
  onToggleBot: () => void;
}) {
  // Values come from the LIVE opportunity — it can re-anchor to closer levels
  const reward = Math.round((Math.abs(opp.tp - opp.entry) / opp.slPoints) * 100);
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "CLOSED", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#1c7d4c" : "#8a2f2a";
  const dist = price !== null ? Math.abs(price - opp.level) : null;

  const pnl = (() => {
    if (opp.phase === "CONFIRMED" && price !== null) return livePnl(opp, price);
    if (opp.phase === "CLOSED" && opp.exitPrice != null) return livePnl(opp, opp.exitPrice);
    if (opp.phase === "TP_HIT") return livePnl(opp, opp.tp);
    if (opp.phase === "SL_HIT") return livePnl(opp, opp.sl);
    return null;
  })();

  let statusLine = "";
  switch (opp.phase) {
    case "HUNTING":
      statusLine = dist !== null ? `Esperando break de ${opp.level.toFixed(2)} · ${dist.toFixed(2)} pts de distancia` : `Esperando break de ${opp.level.toFixed(2)}`;
      break;
    case "AWAIT_RETEST":
      statusLine = dist !== null ? `Level broke — esperando retest · ${dist.toFixed(2)} pts de distancia` : "Level broke — esperando retest";
      break;
    case "RETEST_ACTIVE":
      statusLine = bot ? "Precio en el nivel — bot entra si la vela sostiene" : "Precio en el nivel — tu decisión. Tómalo o sáltalo.";
      break;
    case "CONFIRMED":
      statusLine = `${bot ? "Bot entró" : "Posición abierta"} · spread $${(opp.cost ?? 0).toFixed(2)}`;
      break;
    case "TP_HIT":
      statusLine = `Target hit en ${opp.tp.toFixed(2)}. Así se hace.`;
      break;
    case "SL_HIT":
      statusLine = `Stopped en ${opp.sl.toFixed(2)} — pérdida controlada, al siguiente.`;
      break;
    case "CLOSED":
      statusLine = `Cerrado en ${opp.exitPrice?.toFixed(2)} por tu decisión.`;
      break;
    case "INVALIDATED":
      statusLine = "Precio regresó — trampa evitada.";
      break;
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${meta.color}55`,
        background: `linear-gradient(180deg, ${meta.color}0d 0%, transparent 40%), var(--bg-panel)`,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33` : "none",
      }}
    >
      {/* Header: phase + verify button + direction pill */}
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-center gap-2 min-w-0">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: meta.color }} />}
          <span className="font-black text-base tracking-wider truncate" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isTerminal && (
            <>
              <button
                onClick={onToggleBot}
                title={bot ? "Bot: activado — click para desactivar" : "Bot: desactivado — click para activar"}
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150"
                style={{
                  background: bot ? "rgba(28,125,76,0.15)" : "var(--bg-elevated)",
                  color: bot ? "#1c7d4c" : "var(--text-secondary)",
                  border: `1px solid ${bot ? "rgba(28,125,76,0.4)" : "rgba(255,255,255,0.1)"}`,
                  cursor: "pointer",
                }}
              >
                <FiCpu size={12} />
              </button>
              <button
                onClick={onCheckOpportunity}
                disabled={checking}
                title="Verificar oportunidad actual"
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all duration-150"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: checking ? "not-allowed" : "pointer",
                }}
              >
                <FiRefreshCw size={12} className={checking ? "animate-spin" : ""} />
              </button>
            </>
          )}
          <span
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-black tracking-wider whitespace-nowrap"
            style={{ background: `${dirColor}1a`, color: dirColor, border: `1px solid ${dirColor}44`, fontFamily: "var(--font-display)" }}
          >
            {opp.direction === "long" ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
            {opp.direction === "long" ? "▲ LARGO" : "▼ CORTO"} · {lots.toFixed(2)} LOTES
          </span>
        </div>
      </div>

      {/* Status + P/L */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-[14px] leading-snug" style={{ color: "#9ba5b2" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-3xl font-black leading-none" style={{ color: pnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
              {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(0)}
            </div>
            <div className="text-[11px] font-bold tracking-widest mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {opp.phase === "CONFIRMED" ? "P/L EN VIVO" : "RESULTADO"}
            </div>
          </div>
        )}
      </div>

      {/* Entry / SL / TP strip — live values from the opportunity */}
      <div className="grid grid-cols-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-5 py-3.5">
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#d4a72c" }}>E</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.entry.toFixed(2)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#8a2f2a" }}>SL · −${ACCOUNT.riskPerTrade}</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.sl.toFixed(2)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "#1c7d4c" }}>TP · +${reward}</div>
          <div className="text-lg font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.tp.toFixed(2)}</div>
        </div>
      </div>

      {/* Contextual actions */}
      {!bot && (opp.phase === "RETEST_ACTIVE" || opp.phase === "AWAIT_RETEST") && (
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 pt-2">
          <button
            onClick={onTakeTrade}
            className="flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: opp.phase === "RETEST_ACTIVE" ? "#1c7d4c" : "rgba(28,125,76,0.1)",
              color: opp.phase === "RETEST_ACTIVE" ? "#050e1a" : "#1c7d4c",
              border: "1px solid rgba(28,125,76,0.45)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiCheck size={16} /> TOMAR TRADE
          </button>
          <button
            onClick={onMarketEntry}
            disabled={price === null}
            className="flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: "rgba(28,125,76,0.1)",
              color: "#c23b30",
              border: "1px solid rgba(28,125,76,0.45)",
              cursor: price === null ? "not-allowed" : "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiZap size={15} /> {price !== null ? `MERCADO @ ${price.toFixed(2)}` : "ENTRADA MERCADO"}
          </button>
        </div>
      )}

      {opp.phase === "CONFIRMED" && (
        <div className="px-5 pb-4 pt-2">
          <button
            onClick={onCloseTrade}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-black text-base tracking-widest transition-all duration-150"
            style={{
              background: "rgba(138,47,42,0.1)",
              color: "#8a2f2a",
              border: "1px solid rgba(138,47,42,0.4)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiPower size={15} /> CERRAR POSICIÓN {price !== null && pnl !== null ? `@ ${price.toFixed(2)} (${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  market: Market;
  analysis: AnalysisResult | null;
  onAnalysis: (result: AnalysisResult, candles5m: RawCandle[], candles1m: RawCandle[]) => void;
  opportunity: Opportunity | null;
  livePrice: number | null;
  botMode: boolean;
  onToggleBot: () => void;
  onTakeTrade: () => void;
  onMarketEntry: () => void;
  onCloseTrade: () => void;
  onCheckOpportunity: () => void;
  checkingOpportunity: boolean;
  onClose?: () => void;
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  botMode, onToggleBot, onTakeTrade, onMarketEntry, onCloseTrade, onCheckOpportunity, checkingOpportunity, onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const result = analysis; // analysis state lives in Dashboard (persisted across reloads)

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

  const analyze = useCallback(async () => {
    const requestSymbol = market.symbol;
    setLoading(true);
    setError("");
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
  }, [market, onAnalysis]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const lots = lotsFor(market);

  return (
    <div className="flex flex-col" style={{ background: "var(--bg-panel)" }}>

      {/* Header: analyze button */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-5 py-2.5 rounded-md font-black text-sm tracking-widest transition-all duration-150"
          style={{
            background: "transparent",
            color: "#1c7d4c",
            border: "1px solid rgba(28,125,76,0.5)",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center gap-2">
            {loading ? <FiRefreshCw size={13} className="animate-spin" /> : <FiRefreshCw size={13} />}
            {loading ? "CARGANDO..." : "NUEVO ANÁLISIS"}
          </span>
        </button>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded" style={{ color: "var(--text-secondary)", cursor: "pointer" }}>
            <FiX size={18} />
          </button>
        )}
      </div>

      {/* Account chips — only market-variable values */}
      <div className="flex items-center gap-2.5 px-6 py-3 overflow-x-auto" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        {[
          ["SL", market.slLabel, "#f2f5f8"],
          ["LOTES", lots.toFixed(2), "#f2f5f8"],
          ["SPREAD", `~$${tradeCostFor(market).toFixed(2)}`, "#c23b30"],
          ["RIESGO", `$${ACCOUNT.riskPerTrade}`, "#8a2f2a"],
        ].map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap"
            style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: c, fontFamily: "var(--font-display)" }}>{v}</span>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-5 p-4 rounded-md text-base" style={{ background: "rgba(138,47,42,0.1)", border: "1px solid rgba(138,47,42,0.35)", color: "#8a2f2a" }}>
          {error}
        </div>
      )}

      {result && sig && (
        <div className="p-6 flex flex-col gap-5">

          {opportunity ? (
            <TradeCard
              opp={opportunity}
              price={livePrice}
              bot={botMode}
              lots={lots}
              onTakeTrade={onTakeTrade}
              onMarketEntry={onMarketEntry}
              onCloseTrade={onCloseTrade}
              onCheckOpportunity={onCheckOpportunity}
              checking={checkingOpportunity}
              onToggleBot={onToggleBot}
            />
          ) : (
            <div className="rounded-lg px-5 py-4 text-base" style={{ background: "var(--bg-panel)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
              Sin setup tradeable — analiza de nuevo cuando el mercado se mueva.
            </div>
          )}

          {/* Signal + probability gauge */}
          <div className="rounded-lg flex items-center gap-5 px-5 py-4" style={{ background: "var(--bg-panel)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <ProbRing value={result.probability} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <sig.Icon size={26} color={sig.color} />
                <span className="text-3xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              <div className="text-base mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {probLabel(result.probability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factores
                {result.penalties.length > 0 && ` · ${result.penalties.length} penalidad${result.penalties.length > 1 ? "es" : ""}`}
              </div>
            </div>
          </div>

          {/* Warnings — solo si existen */}
          {result.warnings.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(138,47,42,0.35)" }}>
              <div className="flex items-center gap-1.5 py-2.5 text-sm font-black tracking-widest" style={{ background: "rgba(138,47,42,0.1)", color: "#8a2f2a" }}>
                <FiAlertTriangle size={13} /> ADVERTENCIAS — LEE ANTES DE ENTRAR
              </div>
              <div className="flex flex-col">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2.5 py-3" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", background: "var(--bg-elevated)" }}>
                    <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.severity === "high" ? "#8a2f2a" : "#c23b30" }} />
                    <div className="text-[16px] leading-snug">
                      <span className="font-bold" style={{ color: w.severity === "high" ? "#8a2f2a" : "#c23b30" }}>{w.title}: </span>
                      <span style={{ color: "#929ba7" }}>{w.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score factors */}
          <div className="rounded-lg py-4 lg:px-5" style={{ background: "var(--bg-panel)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-2 gap-2">
              {result.probFactors.map((f, i) => {
                const pct = f.max > 0 ? (f.points / f.max) * 100 : 0;
                const { Icon, color: c } = factorVisual(pct);
                return (
                  <div
                    key={i}
                    className="flex items-center text-left gap-2 rounded-md px-3 py-2 w-full lg:flex-col lg:items-center lg:text-center lg:gap-1.5"
                    style={{ background: "var(--bg-elevated)", border: `1px solid ${c}33` }}
                  >
                    <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0" style={{ background: `${c}26` }}>
                      <Icon size={14} color={c} />
                    </span>
                    <div className="flex flex-col lg:contents">
                      <span className="text-xs leading-tight" style={{ color: "#9ba5b2" }}>{f.label}</span>
                      <span className="font-black text-lg leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{Math.round(pct)}%</span>
                    </div>
                  </div>
                );
              })}
              {result.penalties.map((p, i) => (
                <div
                  key={`p${i}`}
                  className="flex items-center text-left gap-2 rounded-md px-3 py-2 w-full lg:flex-col lg:items-center lg:text-center lg:gap-1.5"
                  style={{ background: "rgba(138,47,42,0.06)", border: "1px solid rgba(138,47,42,0.35)" }}
                >
                  <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0" style={{ background: "rgba(138,47,42,0.15)" }}>
                    <FiAlertTriangle size={14} color="#8a2f2a" />
                  </span>
                  <div className="flex flex-col lg:contents">
                    <span className="text-xs leading-tight" style={{ color: "#9ba5b2" }}>{p.label}</span>
                    <span className="font-black text-lg leading-none" style={{ color: "#8a2f2a", fontFamily: "var(--font-display)" }}>{p.points}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg px-5 py-4" style={{ background: sig.bg, border: `1px solid ${sig.border}` }}>
            <div className="text-sm font-black tracking-[0.2em] mb-2" style={{ color: sig.color }}>TAYLOR</div>
            <p className="text-lg leading-relaxed" style={{ color: "#9ba5b2" }}>{result.message}</p>
            {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
              <div className="mt-2 pt-2 text-base" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                Ventana de setup abre en {result.minutesToOpen} min — este es el bias pre-open.
              </div>
            )}
          </div>

        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center px-5 text-center" style={{ color: "var(--text-muted)" }}>
          <FiZap size={48} className="mb-4 opacity-15" />
          <p className="text-lg">Presiona <strong style={{ color: "var(--gold)" }}>Pregunta a Taylor</strong> para analizar {market.label}.</p>
          <p className="text-base mt-2 opacity-70">Señal, probabilidad, niveles y tracking de trades en vivo.</p>
        </div>
      )}
    </div>
  );
}
