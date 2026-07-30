"use client";

import { useState, useEffect, useCallback } from "react";
import type { IconType } from "react-icons";
import {
  FiTrendingUp, FiTrendingDown, FiPauseCircle, FiPower,
  FiAlertTriangle, FiRefreshCw, FiZap, FiCpu, FiArrowUpRight, FiArrowDownRight, FiCheck,
} from "react-icons/fi";
import type { RawCandle } from "../api/market/route";
import type { AnalysisResult, Signal } from "../lib/analysis";
import { ACCOUNT, lotsFor, tradeCostFor, type Market } from "../lib/markets";
import { livePnl, type Opportunity, type OppPhase } from "../lib/opportunity";

const SIGNAL_CONFIG: Record<Signal, { label: string; color: string; bg: string; border: string; Icon: IconType }> = {
  GO_LONG:  { label: "LARGO",  color: "#00b868", bg: "rgba(0,184,104,0.07)",    border: "rgba(0,184,104,0.35)",    Icon: FiTrendingUp },
  GO_SHORT: { label: "CORTO",  color: "#e05252", bg: "rgba(204,58,58,0.07)",    border: "rgba(204,58,58,0.35)",    Icon: FiTrendingDown },
  WAIT:     { label: "ESPERA", color: "#b89b28", bg: "rgba(184,155,40,0.07)",  border: "rgba(184,155,40,0.30)",  Icon: FiPauseCircle },
};

const PHASE_META: Record<OppPhase, { label: string; color: string; step: number }> = {
  HUNTING:       { label: "BUSCANDO BREAKOUT",          color: "#6f9a7e", step: 0 },
  AWAIT_RETEST:  { label: "BREAKOUT — ESPERANDO RETEST", color: "#b89b28", step: 1 },
  RETEST_ACTIVE: { label: "RETEST ACTIVO",              color: "#d4b83a", step: 2 },
  CONFIRMED:     { label: "POSICIÓN ABIERTA",           color: "#00b868", step: 3 },
  TP_HIT:        { label: "TAKE PROFIT",                color: "#00b868", step: 4 },
  SL_HIT:        { label: "STOP LOSS",                  color: "#e05252", step: 4 },
  CLOSED:        { label: "CERRADO MANUAL",             color: "#b89b28", step: 4 },
  INVALIDATED:   { label: "SETUP INVÁLIDO",             color: "#e05252", step: 4 },
};


function probColor(p: number) {
  if (p >= 70) return "#00b868";
  if (p >= 45) return "#b89b28";
  return "#e05252";
}
function probLabel(p: number) {
  if (p >= 70) return "ALTA";
  if (p >= 45) return "MEDIA";
  return "BAJA";
}

// ── Circular probability gauge ───────────────────────────────────────────────
function ProbRing({ value }: { value: number }) {
  const c = probColor(value);
  const R = 30;
  const CIRC = 2 * Math.PI * R;
  return (
    <div className="relative w-[76px] h-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="38" cy="38" r={R} fill="none"
          stroke={c} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * CIRC} ${CIRC}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none" style={{ color: c, fontFamily: "var(--font-display)" }}>{value}%</span>
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
        setStatusColor("#00b868");
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
        setStatusLabel(`ABRE EN ${openMin - totalMin}MIN — MARCA TUS NIVELES`); setStatusColor("#00b868");
      } else if (totalMin < openMin + 30) {
        setStatusLabel(`VENTANA DE SETUP — ${30 - (totalMin - openMin)}min restantes`); setStatusColor("#00b868");
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
  const dirColor = opp.direction === "long" ? "#00b868" : "#e05252";
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
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${meta.color}55`,
        background: `linear-gradient(180deg, ${meta.color}0d 0%, transparent 40%), var(--bg-card)`,
        boxShadow: opp.phase === "RETEST_ACTIVE" ? `0 0 20px ${meta.color}33` : "none",
      }}
    >
      {/* Header: phase + direction pill */}
      <div className="flex items-center justify-between px-4 pt-3">
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
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-[13px] leading-snug" style={{ color: "#c2d8ca" }}>{statusLine}</p>
        {pnl !== null && (
          <div className="text-right shrink-0">
            <div className="text-2xl font-black leading-none" style={{ color: pnl >= 0 ? "#00b868" : "#e05252", fontFamily: "var(--font-display)" }}>
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
        <div className="px-4 py-2.5">
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#b89b28" }}>ENTRADA</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.entry.toFixed(2)}</div>
        </div>
        <div className="px-4 py-2.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#e05252" }}>STOP · −${ACCOUNT.riskPerTrade}</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.sl.toFixed(2)}</div>
        </div>
        <div className="px-4 py-2.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-[9px] font-bold tracking-[0.2em]" style={{ color: "#00b868" }}>TARGET · +${reward}</div>
          <div className="text-base font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{opp.tp.toFixed(2)}</div>
        </div>
      </div>

      {/* Contextual actions */}
      {!bot && (opp.phase === "RETEST_ACTIVE" || opp.phase === "AWAIT_RETEST") && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-1">
          <button
            onClick={onTakeTrade}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: opp.phase === "RETEST_ACTIVE" ? "#00b868" : "rgba(0,184,104,0.1)",
              color: opp.phase === "RETEST_ACTIVE" ? "#010503" : "#00b868",
              border: "1px solid rgba(0,184,104,0.45)",
              cursor: "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiCheck size={16} /> TOMAR TRADE
          </button>
          <button
            onClick={onMarketEntry}
            disabled={price === null}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(0,184,104,0.1)",
              color: "#b89b28",
              border: "1px solid rgba(0,184,104,0.45)",
              cursor: price === null ? "not-allowed" : "pointer",
              fontFamily: "var(--font-display)",
            }}
          >
            <FiZap size={15} /> {price !== null ? `MERCADO @ ${price.toFixed(2)}` : "ENTRADA MERCADO"}
          </button>
        </div>
      )}

      {opp.phase === "CONFIRMED" && (
        <div className="px-4 pb-3 pt-1">
          <button
            onClick={onCloseTrade}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-black text-sm tracking-widest transition-all duration-150"
            style={{
              background: "rgba(204,58,58,0.1)",
              color: "#d64848",
              border: "1px solid rgba(204,58,58,0.4)",
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
}

export default function BobbyPanel({
  market, analysis, onAnalysis, opportunity, livePrice,
  botMode, onToggleBot, onTakeTrade, onMarketEntry, onCloseTrade,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const result = analysis; // analysis state lives in Dashboard (persisted across reloads)

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

  useEffect(() => {
    setError("");
  }, [market]);

  const sig = result?.signal ? SIGNAL_CONFIG[result.signal] : null;
  const hasOpp = !!opportunity;
  const lots = lotsFor(market);

  return (
    <div className="flex flex-col" style={{ background: "var(--bg-panel)" }}>

      {/* Header: analyze button + clock */}
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg font-black text-xs tracking-widest transition-all duration-150"
          style={{
            background: "transparent",
            color: "#00b868",
            border: "1px solid rgba(0,184,104,0.5)",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-display)",
          }}
        >
          <span className="flex items-center gap-2">
            {loading ? <FiRefreshCw size={13} className="animate-spin" /> : <FiRefreshCw size={13} />}
            {loading ? "CARGANDO..." : "NUEVO ANÁLISIS"}
          </span>
        </button>
        <Clock is24h={market.is24h} />
      </div>

      {/* Account chips — only market-variable values */}
      <div className="flex items-center gap-2 px-5 py-2 overflow-x-auto" style={{ borderBottom: "1px solid var(--gold-border)" }}>
        {[
          ["SL", market.slLabel, "#e8f5ec"],
          ["LOTES", `${lots}`, "#e8f5ec"],
          ["SPREAD", `~$${tradeCostFor(market).toFixed(2)}`, "#c68428"],
          ["RIESGO", `$${ACCOUNT.riskPerTrade}`, "#e05252"],
        ].map(([k, v, c]) => (
          <span key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: c, fontFamily: "var(--font-display)" }}>{v}</span>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 p-3 rounded-lg text-sm" style={{ background: "rgba(204,58,58,0.1)", border: "1px solid rgba(204,58,58,0.35)", color: "#d64848" }}>
          {error}
        </div>
      )}

      {result && sig && (
        <div className="p-4 flex flex-col gap-3">

          {/* Bot toggle */}
          <div className="flex justify-end">
            <button
              onClick={onToggleBot}
              className="flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-black tracking-wider transition-all duration-150"
              style={{
                background: botMode ? "rgba(0,184,104,0.12)" : "rgba(255,255,255,0.04)",
                color: botMode ? "#00b868" : "var(--text-secondary)",
                border: `1px solid ${botMode ? "rgba(0,184,104,0.4)" : "rgba(255,255,255,0.12)"}`,
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
            <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
              Sin setup tradeable — analiza de nuevo cuando el mercado se mueva.
            </div>
          )}

          {/* Signal + probability gauge */}
          <div className="rounded-xl flex items-center gap-4 px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <ProbRing value={result.probability} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <sig.Icon size={24} color={sig.color} />
                <span className="text-xl font-black tracking-wider" style={{ color: sig.color, fontFamily: "var(--font-display)" }}>{sig.label}</span>
              </div>
              <div className="text-xs mt-1 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {probLabel(result.probability)} · {result.probFactors.filter(f => f.points === f.max).length}/{result.probFactors.length} factores
                {result.penalties.length > 0 && ` · ${result.penalties.length} penalidad${result.penalties.length > 1 ? "es" : ""}`}
              </div>
            </div>
          </div>

          {/* Warnings — solo si existen */}
          {result.warnings.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(204,58,58,0.35)" }}>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black tracking-widest" style={{ background: "rgba(204,58,58,0.1)", color: "#d64848" }}>
                <FiAlertTriangle size={12} /> ADVERTENCIAS — LEE ANTES DE ENTRAR
              </div>
              <div className="flex flex-col">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2.5 px-3 py-1.5" style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none", background: "var(--bg-card)" }}>
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.severity === "high" ? "#e05252" : "#c68428" }} />
                    <div className="text-[13px] leading-snug">
                      <span className="font-bold" style={{ color: w.severity === "high" ? "#d64848" : "#c68428" }}>{w.title}: </span>
                      <span style={{ color: "#b5ccbc" }}>{w.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score factors */}
          <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
              {result.probFactors.map((f, i) => {
                const pct = f.max > 0 ? (f.points / f.max) * 100 : 0;
                const c = pct === 100 ? "#00b868" : pct === 0 ? "#e05252" : "#00b868";
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span style={{ color: "#c2d8ca" }}>{f.label}</span>
                      <span className="font-bold" style={{ color: c, fontFamily: "var(--font-display)" }}>{f.points}/{f.max}</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
                    </div>
                  </div>
                );
              })}
              {result.penalties.map((p, i) => (
                <div key={`p${i}`}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className="flex items-center gap-1" style={{ color: "#c2d8ca" }}><FiAlertTriangle size={11} color="#e05252" /> {p.label}</span>
                    <span className="font-bold" style={{ color: "#e05252", fontFamily: "var(--font-display)" }}>{p.points}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(204,58,58,0.25)" }}>
                    <div className="h-full rounded-full" style={{ width: "100%", background: "rgba(204,58,58,0.5)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl px-4 py-3" style={{ background: sig.bg, border: `1px solid ${sig.border}` }}>
            <div className="text-[10px] font-black tracking-[0.2em] mb-2" style={{ color: sig.color }}>TAYLOR</div>
            <p className="text-[13px] leading-relaxed" style={{ color: "#c2d8ca" }}>{result.message}</p>
            {!result.is24h && !result.inSetupWindow && result.minutesToOpen > 0 && (
              <div className="mt-2 pt-2 text-xs" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
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
