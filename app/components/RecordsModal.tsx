"use client";

import { useState, useMemo, useCallback } from "react";
import { FiTrash2, FiX, FiBarChart2, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";
import { loadRecords, clearRecords, computeStats, type TradeRecord } from "../lib/records";
import { ACCOUNT } from "../lib/markets";

function StatCard({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-lg px-5 py-4" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="text-[11px] font-bold tracking-[0.2em]" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className={`${big ? "text-4xl" : "text-2xl"} font-black mt-1 leading-none`} style={{ color: color ?? "#f2f5f8", fontFamily: "var(--font-display)" }}>
        {value}
      </div>
    </div>
  );
}

const OUTCOME_STYLE: Record<TradeRecord["outcome"], { label: string; color: string }> = {
  TP:     { label: "TP", color: "#1c7d4c" },
  SL:     { label: "SL", color: "#8a2f2a" },
  MANUAL: { label: "MANUAL", color: "#1c7d4c" },
};

export default function RecordsModal({ open, onClose, refreshToken }: { open: boolean; onClose: () => void; refreshToken?: number }) {
  // Bumped after a clear to force re-reading localStorage; otherwise records
  // is just a plain derived read, refreshed each time the modal opens.
  // `refreshToken` (bumped by the parent whenever a trade resolves) does the
  // same thing while the modal is already open — without it, a TP/SL/manual
  // close that lands mid-session left the stats and trade list stale until
  // the modal was closed and reopened.
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version/refreshToken are manual invalidation tokens, not read inside
  const records = useMemo(() => (open ? loadRecords() : []), [open, version, refreshToken]);

  const handleClear = useCallback(() => {
    if (window.confirm("Delete ALL trades? This can't be undone.")) {
      clearRecords();
      setVersion(v => v + 1);
    }
  }, []);

  if (!open) return null;

  const stats = computeStats(records);
  const pnlColor = stats.netPnl > 0 ? "#1c7d4c" : stats.netPnl < 0 ? "#8a2f2a" : "#f2f5f8";
  const pf = stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center lg:p-6" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="w-full lg:max-w-4xl h-[92dvh] lg:h-[88vh] rounded-t-lg lg:rounded-lg overflow-hidden flex flex-col"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--gold-border)", boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 shrink-0" style={{ borderBottom: "1px solid var(--gold-border)" }}>
          <div>
            <div className="font-black text-xl tracking-[0.25em]" style={{ color: "var(--gold)", fontFamily: "var(--font-display)" }}>TRADE HISTORY</div>
            <div className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>Per-trade performance · fixed risk ${ACCOUNT.riskPerTrade}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold tracking-wider"
              style={{ background: "rgba(138,47,42,0.08)", color: "#8a2f2a", border: "1px solid rgba(138,47,42,0.3)", cursor: "pointer", fontFamily: "var(--font-display)" }}
            >
              <FiTrash2 size={13} /> CLEAR ALL
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
            >
              <FiX size={13} /> CLOSE
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-7 flex flex-col gap-6">
          {records.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
              <FiBarChart2 size={48} className="mb-4 opacity-15" />
              <p className="text-lg">No trades recorded yet.</p>
              <p className="text-base mt-2 opacity-70">Every TP, SL, or manual close shows up here automatically.</p>
            </div>
          ) : (
            <>
              {/* Headline stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="NET P/L" value={`${stats.netPnl >= 0 ? "+" : "−"}$${Math.abs(stats.netPnl).toFixed(0)}`} color={pnlColor} big />
                <StatCard label="WIN RATE" value={`${stats.winRate.toFixed(0)}%`} color={stats.winRate >= 50 ? "#1c7d4c" : "#8a2f2a"} big />
                <StatCard label="TRADES" value={`${stats.total}`} big />
                <StatCard label="PROFIT FACTOR" value={pf} color={stats.profitFactor >= 1.5 ? "#1c7d4c" : stats.profitFactor >= 1 ? "#1c7d4c" : "#8a2f2a"} big />
              </div>

              {/* Secondary stats */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="AVG WIN" value={`+$${stats.avgWin.toFixed(0)}`} color="#1c7d4c" />
                <StatCard label="AVG LOSS" value={`−$${stats.avgLoss.toFixed(0)}`} color="#8a2f2a" />
                <StatCard label="EXPECTANCY/TRADE" value={`${stats.expectancy >= 0 ? "+" : "−"}$${Math.abs(stats.expectancy).toFixed(0)}`} color={stats.expectancy >= 0 ? "#1c7d4c" : "#8a2f2a"} />
                <StatCard label="BEST/WORST" value={`+$${stats.best.toFixed(0)} / −$${Math.abs(stats.worst).toFixed(0)}`} />
                <StatCard
                  label="STREAK"
                  value={stats.streak > 0 ? `${stats.streak}G` : stats.streak < 0 ? `${Math.abs(stats.streak)}P` : "—"}
                  color={stats.streak > 0 ? "#1c7d4c" : stats.streak < 0 ? "#8a2f2a" : undefined}
                />
              </div>

              {/* Wins vs losses bar */}
              <div className="rounded-lg px-5 py-4" style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between text-[12px] font-bold mb-2">
                  <span style={{ color: "#1c7d4c" }}>{stats.wins} WINS · +${stats.grossWin.toFixed(0)}</span>
                  <span style={{ color: "#8a2f2a" }}>{stats.losses} LOSSES · −${stats.grossLoss.toFixed(0)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ width: `${stats.winRate}%`, background: "#1c7d4c" }} />
                  <div style={{ width: `${100 - stats.winRate}%`, background: "#8a2f2a" }} />
                </div>
              </div>

              {/* Trade list */}
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="overflow-x-auto">
                <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-5 py-3 text-[11px] font-bold tracking-widest min-w-[520px]" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  <span>DATE</span><span>MARKET</span><span>SIDE</span><span>ENTRY → EXIT</span><span>OUTCOME</span><span>P/L</span><span>R</span>
                </div>
                {records.map((r, i) => {
                  const oc = OUTCOME_STYLE[r.outcome];
                  const win = r.pnl > 0;
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.8fr_0.7fr_0.5fr] px-5 py-3 text-[14px] items-center min-w-[520px]"
                      style={{ background: "var(--bg-card)", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                    >
                      <span style={{ color: "#9ba5b2" }}>
                        {new Date(r.time).toLocaleString("en-US", { timeZone: "America/Costa_Rica", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                      </span>
                      <span className="font-bold" style={{ color: "#f2f5f8", fontFamily: "var(--font-display)" }}>{r.market}</span>
                      <span className="flex items-center gap-1 font-bold" style={{ color: r.direction === "long" ? "#1c7d4c" : "#8a2f2a" }}>
                        {r.direction === "long" ? <FiArrowUpRight size={14} /> : <FiArrowDownRight size={14} />}
                        {r.direction === "long" ? "L" : "S"}
                      </span>
                      <span style={{ color: "#9ba5b2", fontFamily: "var(--font-display)" }}>{r.entry.toFixed(2)} → {r.exit.toFixed(2)}</span>
                      <span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-black" style={{ background: `${oc.color}1a`, color: oc.color, border: `1px solid ${oc.color}40` }}>
                          {oc.label}
                        </span>
                      </span>
                      <span className="font-black" style={{ color: win ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                        {win ? "+" : "−"}${Math.abs(r.pnl).toFixed(0)}
                      </span>
                      <span className="font-bold" style={{ color: win ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
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
