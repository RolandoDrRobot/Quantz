"use client";

import { useState, useCallback } from "react";
import { FiX, FiCheck } from "react-icons/fi";
import { LuListChecks } from "react-icons/lu";
import { PLAYBOOK, TOTAL_RULES, loadChecked, saveChecked } from "../lib/playbook";

export default function PlaybookModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Nothing else writes to this storage key, so a lazy initializer (read
  // once, on mount) is enough — no need to resync from storage on every open.
  const [checked, setChecked] = useState<Set<number>>(() => loadChecked());

  const toggle = useCallback((id: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveChecked(next);
      return next;
    });
  }, []);

  if (!open) return null;

  const pct = Math.round((checked.size / TOTAL_RULES) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center lg:p-6" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="w-full lg:max-w-3xl h-[92dvh] lg:h-[88vh] rounded-t-lg lg:rounded-lg overflow-hidden flex flex-col"
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
            <div className="flex items-center gap-2 font-black text-xl tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              <LuListChecks size={18} /> PLAYBOOK
            </div>
            <div className="text-base mt-0.5" style={{ color: "var(--text-secondary)" }}>The 40 rules · {checked.size}/{TOTAL_RULES} checked ({pct}%)</div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
          >
            <FiX size={13} /> CLOSE
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: "var(--gold)" }} />
        </div>

        {/* Rule list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-7 flex flex-col gap-6">
          {PLAYBOOK.map(category => (
            <div key={category.title}>
              <div className="text-xs font-bold tracking-[0.2em] mb-2" style={{ color: "var(--text-muted)" }}>
                {category.title.toUpperCase()}
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                {category.rules.map((rule, i) => {
                  const isChecked = checked.has(rule.id);
                  return (
                    <button
                      key={rule.id}
                      onClick={() => toggle(rule.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-base transition-colors"
                      style={{
                        background: "var(--bg-card)",
                        borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        className="flex items-center justify-center shrink-0 rounded"
                        style={{
                          width: 24,
                          height: 24,
                          background: isChecked ? "#1c7d4c" : "rgba(255,255,255,0.06)",
                          border: `1px solid ${isChecked ? "#1c7d4c" : "rgba(255,255,255,0.15)"}`,
                        }}
                      >
                        {isChecked && <FiCheck size={16} color="#f2f5f8" />}
                      </span>
                      <span style={{ color: isChecked ? "var(--text-secondary)" : "var(--text-primary)", textDecoration: isChecked ? "line-through" : "none" }}>
                        {rule.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
