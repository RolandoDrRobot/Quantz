"use client";

import { useState, useMemo, useCallback } from "react";
import { FiTrash2, FiArrowUpRight, FiArrowDownRight, FiClock } from "react-icons/fi";
import { LuNotebookPen } from "react-icons/lu";
import { loadPredictions, clearPredictions, computePredictionStats, type PredictionRecord } from "../lib/predictions";
import { fmtPrice, fmtPct, fmtSignedMoney, fmtInt } from "../lib/format";

function StatCard({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-lg px-5 py-4" style={{ background: "var(--bg-card)" }}>
      <div className="text-[11px] font-bold tracking-[0.2em]" style={{ color: "var(--text-primary)" }}>{label}</div>
      <div className={`${big ? "text-4xl" : "text-2xl"} font-black mt-1 leading-none`} style={{ color: color ?? "#f2f5f8", fontFamily: "var(--font-display)" }}>
        {value}
      </div>
    </div>
  );
}

const OUTCOME_STYLE: Record<PredictionRecord["outcome"], { label: string; color: string }> = {
  PENDING:     { label: "TRACKING", color: "#c9a838" },
  TP_HIT:      { label: "TP",       color: "#1c7d4c" },
  SL_HIT:      { label: "SL",       color: "#8a2f2a" },
  INVALIDATED: { label: "INVALID.", color: "#9ba5b2" },
};

export default function JournalPanel({ refreshToken }: { refreshToken?: number }) {
  // Bumped after a clear to force re-reading localStorage.
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version/refreshToken are manual invalidation tokens, not read inside
  const predictions = useMemo(() => loadPredictions(), [version, refreshToken]);

  const handleClear = useCallback(() => {
    if (window.confirm("Delete ALL logged predictions? This can't be undone.")) {
      clearPredictions();
      setVersion(v => v + 1);
    }
  }, []);

  const stats = computePredictionStats(predictions);
  const hitColor = stats.hitRate >= 50 ? "#1c7d4c" : "#8a2f2a";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="text-base" style={{ color: "var(--text-primary)" }}>Automatic log — every opportunity Taylor detects, and whether the call came true</div>
        {predictions.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-bold tracking-wider shrink-0"
            style={{ background: "rgba(138,47,42,0.08)", color: "#8a2f2a", border: "1px solid rgba(138,47,42,0.3)", cursor: "pointer", fontFamily: "var(--font-display)" }}
          >
            <FiTrash2 size={13} /> CLEAR ALL
          </button>
        )}
      </div>

      {predictions.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-primary)" }}>
          <LuNotebookPen size={48} className="mb-4 opacity-15" />
          <p className="text-lg">No predictions logged yet.</p>
          <p className="text-base mt-2 opacity-70">Every opportunity Taylor detects shows up here automatically.</p>
        </div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="PREDICTIONS" value={fmtInt(stats.total)} big />
            <StatCard label="HIT RATE" value={fmtPct(stats.hitRate)} color={hitColor} big />
            <StatCard label="RESOLVED" value={fmtInt(stats.resolved)} big />
            <StatCard label="INVALIDATED" value={fmtPct(stats.invalidatedRate)} color="#9ba5b2" big />
          </div>

          {/* TP vs SL bar */}
          <div className="rounded-lg px-5 py-4" style={{ background: "var(--bg-card)" }}>
            <div className="flex items-center justify-between text-[12px] font-bold mb-2">
              <span style={{ color: "#1c7d4c" }}>{fmtInt(stats.tpHits)} TP</span>
              <span style={{ color: "#8a2f2a" }}>{fmtInt(stats.slHits)} SL</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div style={{ width: `${stats.hitRate}%`, background: "#1c7d4c" }} />
              <div style={{ width: `${100 - stats.hitRate}%`, background: "#8a2f2a" }} />
            </div>
          </div>

          {/* Prediction list */}
          <div className="rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.9fr] px-5 py-3 text-[11px] font-bold tracking-widest min-w-[480px]" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
              <span>DATE</span><span>MARKET</span><span>SIDE</span><span>LEVEL → RESOLVED</span><span>OUTCOME</span>
            </div>
            {predictions.map((p, i) => {
              const oc = OUTCOME_STYLE[p.outcome];
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1.2fr_0.9fr] px-5 py-3 text-[14px] items-center min-w-[480px]"
                  style={{ background: "var(--bg-card)", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                >
                  <span style={{ color: "#9ba5b2" }}>
                    {new Date(p.createdAt).toLocaleString("en-US", { timeZone: "America/Costa_Rica", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                  </span>
                  <span className="font-bold" style={{ color: "#f2f5f8", fontFamily: "var(--font-display)" }}>{p.market}</span>
                  <span className="flex items-center gap-1 font-bold" style={{ color: p.direction === "long" ? "#1c7d4c" : "#8a2f2a" }}>
                    {p.direction === "long" ? <FiArrowUpRight size={14} /> : <FiArrowDownRight size={14} />}
                    {p.direction === "long" ? "L" : "S"}
                  </span>
                  <span style={{ color: "#9ba5b2", fontFamily: "var(--font-display)" }}>
                    {fmtPrice(p.level)}{p.resolvedPrice != null ? ` → ${fmtPrice(p.resolvedPrice)}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black" style={{ background: `${oc.color}1a`, color: oc.color, border: `1px solid ${oc.color}40` }}>
                      {p.outcome === "PENDING" && <FiClock size={10} />}
                      {oc.label}
                    </span>
                    {p.pnlAtResolution != null && (
                      <span className="font-bold text-[12px]" style={{ color: p.pnlAtResolution >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                        {fmtSignedMoney(p.pnlAtResolution)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            </div>{/* end overflow-x-auto */}
          </div>
        </>
      )}
    </div>
  );
}
