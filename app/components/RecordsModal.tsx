"use client";

import { useState, useEffect, useCallback } from "react";
import { FiTrash2, FiX, FiBarChart2, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";
import { loadRecords, clearRecords, computeStats, type TradeRecord } from "../lib/records";

function StatCard({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className={`${big ? "text-3xl" : "text-xl"} font-black mt-1 leading-none`} style={{ color: color ?? "#dde8f5", fontFamily: "var(--font-display)" }}>
        {value}
      </div>
    </div>
  );
}

const OUTCOME_STYLE: Record<TradeRecord["outcome"], { label: string; color: string }> = {
  TP:     { label: "TP", color: "#3dc85c" },
  SL:     { label: "SL", color: "#e05252" },
  MANUAL: { label: "MANUAL", color: "#3dc85c" },
};

export default function RecordsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<TradeRecord[]>([]);

  useEffect(() => {
    if (open) setRecords(loadRecords());
  }, [open]);

  const handleClear = useCallback(() => {
    if (window.confirm("¿Eliminar TODOS los trades? No se puede deshacer.")) {
      clearRecords();
      setRecords([]);
    }
  }, []);

  if (!open) return null;

  const stats = computeStats(records);
  const pnlColor = stats.netPnl > 0 ? "#3dc85c" : stats.netPnl < 0 ? "#e05252" : "#dde8f5";
  const pf = stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center lg:p-6" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="w-full lg:max-w-4xl h-[92dvh] lg:max-h-[90vh] lg:h-auto rounded-t-3xl lg:rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--gold-border)", boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--gold-border)" }}>
          <div>
            <div className="font-black text-lg tracking-[0.25em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>HISTORIAL DE TRADES</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Performance por trade · riesgo fijo $100</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider"
              style={{ background: "rgba(224,82,82,0.08)", color: "#e86666", border: "1px solid rgba(224,82,82,0.3)", cursor: "pointer", fontFamily: "var(--font-display)" }}
            >
              <FiTrash2 size={13} /> LIMPIAR TODO
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
            >
              <FiX size={13} /> CERRAR
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-5">
          {records.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
              <FiBarChart2 size={48} className="mb-4 opacity-15" />
              <p className="text-base">Sin trades registrados.</p>
              <p className="text-sm mt-2 opacity-70">Cada TP, SL o cierre manual aparece aquí automáticamente.</p>
            </div>
          ) : (
            <>
              {/* Headline stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="P/L NETO" value={`${stats.netPnl >= 0 ? "+" : "−"}$${Math.abs(stats.netPnl).toFixed(0)}`} color={pnlColor} big />
                <StatCard label="WIN RATE" value={`${stats.winRate.toFixed(0)}%`} color={stats.winRate >= 50 ? "#3dc85c" : "#e05252"} big />
                <StatCard label="TRADES" value={`${stats.total}`} big />
                <StatCard label="PROFIT FACTOR" value={pf} color={stats.profitFactor >= 1.5 ? "#3dc85c" : stats.profitFactor >= 1 ? "#3dc85c" : "#e05252"} big />
              </div>

              {/* Secondary stats */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard label="PROMEDIO WIN" value={`+$${stats.avgWin.toFixed(0)}`} color="#3dc85c" />
                <StatCard label="PROMEDIO LOSS" value={`−$${stats.avgLoss.toFixed(0)}`} color="#e05252" />
                <StatCard label="EXPECTATIVA/TRADE" value={`${stats.expectancy >= 0 ? "+" : "−"}$${Math.abs(stats.expectancy).toFixed(0)}`} color={stats.expectancy >= 0 ? "#3dc85c" : "#e05252"} />
                <StatCard label="MEJOR/PEOR" value={`+$${stats.best.toFixed(0)} / −$${Math.abs(stats.worst).toFixed(0)}`} />
                <StatCard
                  label="RACHA"
                  value={stats.streak > 0 ? `${stats.streak}G` : stats.streak < 0 ? `${Math.abs(stats.streak)}P` : "—"}
                  color={stats.streak > 0 ? "#3dc85c" : stats.streak < 0 ? "#e05252" : undefined}
                />
              </div>

              {/* Wins vs losses bar */}
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between text-[11px] font-bold mb-2">
                  <span style={{ color: "#3dc85c" }}>{stats.wins} GANANCIAS · +${stats.grossWin.toFixed(0)}</span>
                  <span style={{ color: "#e05252" }}>{stats.losses} PÉRDIDAS · −${stats.grossLoss.toFixed(0)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ width: `${stats.winRate}%`, background: "#3dc85c" }} />
                  <div style={{ width: `${100 - stats.winRate}%`, background: "#e05252" }} />
                </div>
              </div>

              {/* Trade list */}
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="overflow-x-auto">
                <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-4 py-2 text-[10px] font-bold tracking-widest min-w-[520px]" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  <span>FECHA</span><span>MERCADO</span><span>LADO</span><span>ENTRADA → SALIDA</span><span>RESULTADO</span><span>P/L</span><span>R</span>
                </div>
                {records.map((r, i) => {
                  const oc = OUTCOME_STYLE[r.outcome];
                  const win = r.pnl > 0;
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-4 py-2.5 text-[13px] items-center min-w-[520px]"
                      style={{ background: "var(--bg-card)", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                    >
                      <span style={{ color: "#b0c8e8" }}>
                        {new Date(r.time).toLocaleString("en-US", { timeZone: "America/Costa_Rica", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                      </span>
                      <span className="font-bold" style={{ color: "#dde8f5", fontFamily: "var(--font-display)" }}>{r.market}</span>
                      <span className="flex items-center gap-1 font-bold" style={{ color: r.direction === "long" ? "#3dc85c" : "#e05252" }}>
                        {r.direction === "long" ? <FiArrowUpRight size={14} /> : <FiArrowDownRight size={14} />}
                        {r.direction === "long" ? "L" : "C"}
                      </span>
                      <span style={{ color: "#b0c8e8", fontFamily: "var(--font-display)" }}>{r.entry.toFixed(2)} → {r.exit.toFixed(2)}</span>
                      <span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: `${oc.color}1a`, color: oc.color, border: `1px solid ${oc.color}40` }}>
                          {oc.label}
                        </span>
                      </span>
                      <span className="font-black" style={{ color: win ? "#3dc85c" : "#e05252", fontFamily: "var(--font-display)" }}>
                        {win ? "+" : "−"}${Math.abs(r.pnl).toFixed(0)}
                      </span>
                      <span className="font-bold" style={{ color: win ? "#3dc85c" : "#e05252", fontFamily: "var(--font-display)" }}>
                        {r.rMultiple >= 0 ? "+" : ""}{r.rMultiple.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
                </div>{/* end overflow-x-auto */}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
