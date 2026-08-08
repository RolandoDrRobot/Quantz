"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiCheck } from "react-icons/fi";
import { PLAYBOOK, TOTAL_RULES, loadChecked, saveChecked } from "../lib/playbook";
import { popVariants, TRANSITION_FAST } from "../lib/motionVariants";

export default function PlaybookPanel() {
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

  const pct = Math.round((checked.size / TOTAL_RULES) * 100);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-base" style={{ color: "var(--text-secondary)" }}>The 40 rules · {checked.size}/{TOTAL_RULES} checked ({pct}%)</div>
        <div className="h-1.5 rounded-full overflow-hidden mt-2.5" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: "var(--gold)" }} />
        </div>
      </div>

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
                    <AnimatePresence>
                      {isChecked && (
                        <motion.span
                          className="flex items-center justify-center"
                          variants={popVariants}
                          initial="hidden"
                          animate="visible"
                          exit="hidden"
                          transition={TRANSITION_FAST}
                        >
                          <FiCheck size={16} color="#f2f5f8" />
                        </motion.span>
                      )}
                    </AnimatePresence>
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
  );
}
