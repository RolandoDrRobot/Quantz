"use client";

import { useState, useEffect, useCallback } from "react";
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
  GO_LONG:  { label: "LARGO",  color: "#1f9d5c", bg: "rgba(31,157,92,0.07)",    border: "rgba(31,157,92,0.35)",    Icon: FiTrendingUp },
  GO_SHORT: { label: "CORTO",  color: "#c24545", bg: "rgba(194,69,69,0.07)",    border: "rgba(194,69,69,0.35)",    Icon: FiTrendingDown },
  WAIT:     { label: "ESPERA", color: "#a8862f", bg: "rgba(168,134,47,0.07)",  border: "rgba(168,134,47,0.30)",  Icon: FiPauseCircle },
};

const PHASE_META: Record<OppPhase, { label: string; color: string; step: number }> = {
  HUNTING:       { label: "BUSCANDO BREAKOUT",          color: "#838a94", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT — ESPERANDO RETEST", color: "#a8862f", step: 1 },
  RETEST_ACTIVE: { label: "RETEST ACTIVO",              color: "#c9a545", step: 2 },
  CONFIRMED:     { label: "POSICIÓN ABIERTA",           color: "#1f9d5c", step: 3 },
  TP_HIT:        { label: "TAKE PROFIT",                color: "#1f9d5c", step: 4 },
  SL_HIT:        { label: "STOP LOSS",                  color: "#c24545", step: 4 },
  CLOSED:        { label: "CERRADO MANUAL",             color: "#a8862f", step: 4 },
  INVALIDATED:   { label: "SETUP INVÁLIDO",             color: "#c24545", step: 4 },
};


function probColor(p: number) {
  if (p >= 70) return "#1f9d5c";
  if (p >= 45) return "#a8862f";
  return "#c24545";
}
function probLabel(p: number) {
  if (p >= 70) return "ALTA";
  if (p >= 45) return "MEDIA";
  return "BAJA";
}

// ── Per-factor status: full check, partial dash, or missed × ────────────────
function factorVisual(pct: number): { Icon: IconType; color: string } {
  if (pct >= 100) return { Icon: FiCheck, color: "#1f9d5c" };
  if (pct <= 0) return { Icon: FiX, color: "#c24545" };
  return { Icon: FiMinus, color: "#a8862f" };
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
        <span className="text-xl font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
      </div>
    </div>
  );
}

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
        setStatusLabel("Mercado 24h — Abierto");
        setStatusColor("#1f9d5c");
        return;
      }

      const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay();
      const totalMin = et.getHours() * 60 + et.getMinutes();
      const openMin = 9 * 60 + 30;

      if (day === 0 || day === 6) {
        setStatusLabel("Fin de semana — Cerrado"); setStatusColor("#6b7280");
      } else if (totalMin < openMin - 30) {
        setStatusLabel(`Pre-market — abre en ${openMin - totalMin}min`); setStatusColor("#f59e0b");
      } else if (totalMin < openMin) {
        setStatusLabel(`ABRE EN ${openMin - totalMin}MIN — MARCA TUS NIVELES`); setStatusColor("#1f9d5c");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`VENTANA DE SETUP — ${30 - (totalMin - openMin)}min restantes`); setStatusColor("#1f9d5c");
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
      <div className="text-lg font-bold tracking-widest leading-none" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>{time}</div>
      <div className="text-xs mt-1 font-semibold" style={{ color: statusColor }}>{statusLabel}</div>
    </div>
  );
}


// ── The Trade card — everything about the position in one place ──────────────
function TradeCard({
  opp, price, bot, lots, onTakeTrade, onMarketEntry, onCloseTrade,
}: {
  opp: Opportunity;
  price: number | null;
  bot: boolean;
  lots: number;
  onTakeTrade: () => void;
  onMarketEntry: () => void;
  onCloseTrade: () => void;
}) {
  // Values come from the LIVE opportunity — it can re-anchor to closer levels
  const reward = Math.round((Math.abs(opp.tp - opp.entry) / opp.slPoints) * 100);
  const meta = PHASE_META[opp.phase];
  const isTerminal = ["TP_HIT", "SL_HIT", "CLOSED", "INVALIDATED"].includes(opp.phase);
  const dirColor = opp.direction === "long" ? "#1f9d5c" : "#c24545";
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
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${meta.color}55`,
        background: `linear-gradient(180deg, ${meta.color}0d 0%, transparent 40%), var(--bg-card)`,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33` : "none",
      }}
    >
      {/* Header: phase + direction pill */}
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2">
          {!isTerminal && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: meta.color }} />}
          <span className="font-black text-sm tracking-wider" style={{ color: meta.color, fontFamily: "var(--font-display)" }}>
            {meta.label}
          </span>
        </div>
        <span
          className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black tracking-wider"
          style={{ background: `${dirColor}1a`, color: dirColor, border: `1px solid ${dirColor}44`, fontFamily: "var(--font-display)" }}
        >
          {opp.direction === "long" ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
          {opp.direction === "long" ? "▲ LARGO" : "▼ CORTO"} · {lots} LOTES
        </span>
      </div>

      {/* Status + P/L */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-[13px] leading-snug" style={{ color: "#9aa1ab" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-2xl font-black leading-none" style={{ color: pnl >= 0 ? "#1f9d5c" : "#c24545", fontFamily: "var(--font-display)" }}>
              {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(0)}
            </div>
            <div className="text-[10px] font-bold tracking-widest mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {opp.phase === "CONFIRMED" ? "P/L EN VIVO" : "RESULTADO"}
            </div>
          </div>
        )}
      </div>

      {/* Entry / SL / TP strip — live values from the opportunity */}
      <div className="grid grid-cols-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-5 py-3.5">
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#a8862f" }}>ENTRADA</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.entry.toFixed(2)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#c24545" }}>STOP · −${ACCOUNT.riskPerTrade}</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.sl.toFixed(2)}</div>
        </div>
        <div className="px-5 py-3.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#1f9d5c" }}>TARGET · +${reward}</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.tp.toFixed(2)}</div>
        </div>
      </div>

      {/* Contextual actions */}
      {!bot && (opp.phase === "RETEST_ACTIVE" || opp.phase === "AWAIT_RETEST") && (
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 pt-2">
          <button
            onClick={onTakeTrade}
            className="flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: opp.phase === "RETEST_ACTIVE" ? "#1f9d5c" : "rgba(31,157,92,0.1)",
              color: opp.phase === "RETEST_ACTIVE" ? "#030405" : "#1f9d5c",
              border: "1px solid rgba(31,157,92,0.45)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiCheck size={16} /> TOMAR TRADE
          </button>
          <button
            onClick={onMarketEntry}
            disabled={price === null}
            className="flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(31,157,92,0.1)",
              color: "#a8862f",
              border: "1px solid rgba(31,157,92,0.45)",
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
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(194,69,69,0.1)",
              color: "#c24545",
              border: "1px solid rgba(194,69,69,0.4)",
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
  onClose?: () => void;
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  botMode, onToggleBot, onTakeTrade, onMarketEntry, onCloseTrade, onClose,
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

      const { runAnalysis } = await import("../lib/analysis");
      const fresh = runAnalysis(
        data.candles5m,
        data.currentPrice,
        data.prevClose,
        market.is24h,
        market.slPoints,
        market.label
      );
      onAnalysis(fresh, data.candles5m, data.candles1m ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [market, onAnalysis]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const lots = lotsFor(market);

  return (
    <div className="flex flex-col" style={{ background: "var(--bg-panel)" }}>

      {/* Header: analyze button + clock */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl font-black text-xs tracking-widest transition-all duration-150"
          style={{
            background: "transparent",
            color: "#1f9d5c",
            border: "1px solid rgba(31,157,92,0.5)",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center gap-2">
            {loading ? <FiRefreshCw size={13} className="animate-spin" /> : <FiRefreshCw size={13} />}
            {loading ? "CARGANDO..." : "NUEVO ANÁLISIS"}
          </span>
        </button>
        <div className="flex items-center gap-3">
          <Clock is24h={market.is24h} />
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "var(--text-secondary)", cursor: "pointer" }}>
              <FiX size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Account chips — only market-variable values */}
      <div className="flex items-center gap-2.5 px-6 py-3 overflow-x-auto" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        {[
          ["SL", market.slLabel, "#eceef0"],
          ["LOTES", `${lots}`, "#eceef0"],
          ["SPREAD", `~$${tradeCostFor(market).toFixed(2)}`, "#a8862f"],
          ["RIESGO", `$${ACCOUNT.riskPerTrade}`, "#c24545"],
        ].map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: c, fontFamily: "var(--font-display)" }}>{v}</span>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-5 p-4 rounded-xl text-sm" style={{ background: "rgba(194,69,69,0.1)", border: "1px solid rgba(194,69,69,0.35)", color: "#c24545" }}>
          {error}
        </div>
      )}

      {result && sig && (
        <div className="p-6 flex flex-col gap-5">

          {/* Bot toggle */}
          <div className="flex justify-end">
            <button
              onClick={onToggleBot}
              className="flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-black tracking-wider transition-all duration-150"
              style={{
                background: botMode ? "rgba(31,157,92,0.12)" : "rgba(255,255,255,0.04)",
                color: botMode ? "#1f9d5c" : "var(--text-secondary)",
                border: `1px solid ${botMode ? "rgba(31,157,92,0.4)" : "rgba(255,255,255,0.12)"}`,
                cursor: "pointer",
                fontFamily: "var(--font-display)",
              }}
            >
              <FiCpu size={13} />
              {botMode ? "BOT: ACTIVADO" : "BOT: OFF — MANUAL"}
            </button>
          </div>

          {opportunity ? (
            <TradeCard
              opp={opportunity}
              price={livePrice}
              bot={botMode}
              lots={lots}
              onTakeTrade={onTakeTrade}
              onMarketEntry={onMarketEntry}
              onCloseTrade={onCloseTrade}
            />
          ) : (
            <div className="rounded-2xl px-5 py-4 text-sm" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
              Sin setup tradeable — analiza de nuevo cuando el mercado se mueva.
            </div>
          )}

          {/* Signal + probability gauge */}
          <div className="rounded-2xl flex items-center gap-5 px-5 py-4" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <ProbRing value={result.probability} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <sig.Icon size={26} color={sig.color} />
                <span className="text-2xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              <div className="text-sm mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {probLabel(result.probability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factores
                {result.penalties.length > 0 && ` · ${result.penalties.length} penalidad${result.penalties.length > 1 ? "es" : ""}`}
              </div>
            </div>
          </div>

          {/* Warnings — solo si existen */}
          {result.warnings.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(194,69,69,0.35)" }}>
              <div className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-black tracking-widest" style={{ background: "rgba(194,69,69,0.1)", color: "#c24545" }}>
                <FiAlertTriangle size={13} /> ADVERTENCIAS — LEE ANTES DE ENTRAR
              </div>
              <div className="flex flex-col">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2.5 px-4 py-3" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", background: "var(--bg-card)" }}>
                    <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.severity === "high" ? "#c24545" : "#a8862f" }} />
                    <div className="text-[15px] leading-snug">
                      <span className="font-bold" style={{ color: w.severity === "high" ? "#c24545" : "#a8862f" }}>{w.title}: </span>
                      <span style={{ color: "#7d848d" }}>{w.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score factors */}
          <div className="rounded-2xl px-5 py-4" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-2 gap-3">
              {result.probFactors.map((f, i) => {
                const pct = f.max > 0 ? (f.points / f.max) * 100 : 0;
                const { Icon, color: c } = factorVisual(pct);
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center text-center gap-2 rounded-xl px-3 py-4"
                    style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${c}33` }}
                  >
                    <span className="flex items-center justify-center w-10 h-10 rounded-full" style={{ background: `${c}26` }}>
                      <Icon size={18} color={c} />
                    </span>
                    <span className="text-sm leading-tight" style={{ color: "#9aa1ab" }}>{f.label}</span>
                    <span className="font-black text-2xl leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
              {result.penalties.map((p, i) => (
                <div
                  key={`p${i}`}
                  className="flex flex-col items-center text-center gap-2 rounded-xl px-3 py-4"
                  style={{ background: "rgba(194,69,69,0.06)", border: "1px solid rgba(194,69,69,0.35)" }}
                >
                  <span className="flex items-center justify-center w-10 h-10 rounded-full" style={{ background: "rgba(194,69,69,0.15)" }}>
                    <FiAlertTriangle size={18} color="#c24545" />
                  </span>
                  <span className="text-sm leading-tight" style={{ color: "#9aa1ab" }}>{p.label}</span>
                  <span className="font-black text-2xl leading-none" style={{ color: "#c24545", fontFamily: "var(--font-display)" }}>{p.points}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl px-5 py-4" style={{ background: sig.bg, border: `1px solid ${sig.border}` }}>
            <div className="text-xs font-black tracking-[0.2em] mb-2" style={{ color: sig.color }}>TAYLOR</div>
            <p className="text-base leading-relaxed" style={{ color: "#9aa1ab" }}>{result.message}</p>
            {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
              <div className="mt-2 pt-2 text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
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
          <p className="text-base">Presiona <strong style={{ color: "var(--gold)" }}>Pregunta a Taylor</strong> para analizar {market.label}.</p>
          <p className="text-sm mt-2 opacity-70">Señal, probabilidad, niveles y tracking de trades en vivo.</p>
        </div>
      )}
    </div>
  );
}
