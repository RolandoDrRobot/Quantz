"use client";

import { useState, useEffect, useCallback } from "react";
import { FiTrash2, FiX, FiBarChart2, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";
import { loadRecords, clearRecords, computeStats, type TradeRecord } from "../lib/records";

function StatCard({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className={`${big ? "text-3xl" : "text-xl"} font-black mt-1 leading-none`} style={{ color: color ?? "#e8f5ec", fontFamily: "var(--font-display)" }}>
        {value}
      </div>
    </div>
  );
}

const OUTCOME_STYLE: Record<TradeRecord["outcome"], { label: string; color: string }> = {
  TP:     { label: "TP HIT", color: "#00b868" },
  SL:     { label: "SL HIT", color: "#cc3a3a" },
  MANUAL: { label: "MANUAL", color: "#b89b28" },
};

export default function RecordsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<TradeRecord[]>([]);

  useEffect(() => {
    if (open) setRecords(loadRecords());
  }, [open]);

  const handleClear = useCallback(() => {
    if (window.confirm("Delete ALL trade records? This cannot be undone.")) {
      clearRecords();
      setRecords([]);
    }
  }, []);

  if (!open) return null;

  const stats = computeStats(records);
  const pnlColor = stats.netPnl > 0 ? "#00b868" : stats.netPnl < 0 ? "#cc3a3a" : "#e8f5ec";
  const pf = stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--gold-border)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--gold-border)" }}>
          <div>
            <div className="font-black text-lg tracking-[0.25em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>TRADE RECORDS</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Per-trade performance · fixed $100 risk</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider"
              style={{ background: "rgba(204,58,58,0.08)", color: "#d64848", border: "1px solid rgba(204,58,58,0.3)", cursor: "pointer", fontFamily: "var(--font-display)" }}
            >
              <FiTrash2 size={13} /> CLEAR ALL
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
            >
              <FiX size={13} /> CLOSE
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-5">
          {records.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
              <FiBarChart2 size={48} className="mb-4 opacity-15" />
              <p className="text-base">No trades recorded yet.</p>
              <p className="text-sm mt-2 opacity-70">Every TP, SL or manual close lands here automatically.</p>
            </div>
          ) : (
            <>
              {/* Headline stats */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="NET P/L" value={`${stats.netPnl >= 0 ? "+" : "−"}$${Math.abs(stats.netPnl).toFixed(0)}`} color={pnlColor} big />
                <StatCard label="WIN RATE" value={`${stats.winRate.toFixed(0)}%`} color={stats.winRate >= 50 ? "#00b868" : "#cc3a3a"} big />
                <StatCard label="TRADES" value={`${stats.total}`} big />
                <StatCard label="PROFIT FACTOR" value={pf} color={stats.profitFactor >= 1.5 ? "#00b868" : stats.profitFactor >= 1 ? "#b89b28" : "#cc3a3a"} big />
              </div>

              {/* Secondary stats */}
              <div className="grid grid-cols-5 gap-3">
                <StatCard label="AVG WIN" value={`+$${stats.avgWin.toFixed(0)}`} color="#00b868" />
                <StatCard label="AVG LOSS" value={`−$${stats.avgLoss.toFixed(0)}`} color="#cc3a3a" />
                <StatCard label="EXPECTANCY / TRADE" value={`${stats.expectancy >= 0 ? "+" : "−"}$${Math.abs(stats.expectancy).toFixed(0)}`} color={stats.expectancy >= 0 ? "#00b868" : "#cc3a3a"} />
                <StatCard label="BEST / WORST" value={`+$${stats.best.toFixed(0)} / −$${Math.abs(stats.worst).toFixed(0)}`} />
                <StatCard
                  label="STREAK"
                  value={stats.streak > 0 ? `${stats.streak}W` : stats.streak < 0 ? `${Math.abs(stats.streak)}L` : "—"}
                  color={stats.streak > 0 ? "#00b868" : stats.streak < 0 ? "#cc3a3a" : undefined}
                />
              </div>

              {/* Wins vs losses bar */}
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between text-[11px] font-bold mb-2">
                  <span style={{ color: "#00b868" }}>{stats.wins} WINS · +${stats.grossWin.toFixed(0)}</span>
                  <span style={{ color: "#cc3a3a" }}>{stats.losses} LOSSES · −${stats.grossLoss.toFixed(0)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ width: `${stats.winRate}%`, background: "#00b868" }} />
                  <div style={{ width: `${100 - stats.winRate}%`, background: "#cc3a3a" }} />
                </div>
              </div>

              {/* Trade list */}
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-4 py-2 text-[10px] font-bold tracking-widest" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  <span>DATE</span><span>MARKET</span><span>SIDE</span><span>ENTRY → EXIT</span><span>OUTCOME</span><span>P/L</span><span>R</span>
                </div>
                {records.map((r, i) => {
                  const oc = OUTCOME_STYLE[r.outcome];
                  const win = r.pnl > 0;
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-4 py-2.5 text-[13px] items-center"
                      style={{ background: "var(--bg-card)", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                    >
                      <span style={{ color: "#c2d8ca" }}>
                        {new Date(r.time).toLocaleString("en-US", { timeZone: "America/Costa_Rica", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                      </span>
                      <span className="font-bold" style={{ color: "#e8f5ec", fontFamily: "var(--font-display)" }}>{r.market}</span>
                      <span className="flex items-center gap-1 font-bold" style={{ color: r.direction === "long" ? "#00b868" : "#cc3a3a" }}>
                        {r.direction === "long" ? <FiArrowUpRight size={14} /> : <FiArrowDownRight size={14} />}
                        {r.direction === "long" ? "L" : "S"}
                      </span>
                      <span style={{ color: "#c2d8ca", fontFamily: "var(--font-display)" }}>{r.entry.toFixed(2)} → {r.exit.toFixed(2)}</span>
                      <span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: `${oc.color}1a`, color: oc.color, border: `1px solid ${oc.color}40` }}>
                          {oc.label}
                        </span>
                      </span>
                      <span className="font-black" style={{ color: win ? "#00b868" : "#cc3a3a", fontFamily: "var(--font-display)" }}>
                        {win ? "+" : "−"}${Math.abs(r.pnl).toFixed(0)}
                      </span>
                      <span className="font-bold" style={{ color: win ? "#00b868" : "#cc3a3a", fontFamily: "var(--font-display)" }}>
                        {r.rMultiple >= 0 ? "+" : ""}{r.rMultiple.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
