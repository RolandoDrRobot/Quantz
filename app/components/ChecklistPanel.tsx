"use client";

import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { FiCheckSquare, FiSquare, FiRotateCcw } from "react-icons/fi";
import { glassStyle, glassChipStyle } from "../lib/glass";
import { fadeUpVariants, TRANSITION_FAST } from "../lib/motionVariants";

// Pulled straight from the actual strategy rules in analysis.ts/opportunity.ts
// — not a generic trading checklist, this is a checkbox for THIS engine's
// specific hard rules. A ritual to run before every manual entry, not a log
// (resets each time — see the RESET button), so it stays untouched by
// AnimatePresence exit/re-render and is just plain local state.
const ITEMS = [
  "Breakout candle has a real body — not a doji, not a wick-only fake-out",
  "Breakout direction matches the trend — never taking a counter-trend break",
  "Waited for the retest — did not chase the initial break",
  "Retest candle actually held the level, didn't just tag it and reverse through",
  "Risk:Reward is at least 1.5:1 on this setup",
  "No unresolved high-severity warning (whipsaw, dead volatility, thin volume)",
  "Inside the session window — NASDAQ/Dow open ±15/30min, or a genuine 24h session",
  "Position sized to the fixed risk — not oversized because \"this one feels sure\"",
  "Head is clear — not revenge trading, not chasing, not FOMO",
];

export default function ChecklistPanel() {
  const [checked, setChecked] = useState<boolean[]>(() => ITEMS.map(() => false));

  const toggle = useCallback((i: number) => {
    setChecked(c => c.map((v, idx) => (idx === i ? !v : v)));
  }, []);

  const reset = useCallback(() => {
    setChecked(ITEMS.map(() => false));
  }, []);

  const doneCount = checked.filter(Boolean).length;
  const allDone = doneCount === ITEMS.length;

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="rounded-md px-5 py-4 flex items-center justify-between" style={glassStyle(allDone ? "#1c7d4c" : undefined)}>
        <div>
          <div className="text-lg font-black tracking-wider" style={{ color: allDone ? "#1c7d4c" : "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            {allDone ? "READY TO TRADE" : "PRE-TRADE CHECKLIST"}
          </div>
          <div className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{doneCount}/{ITEMS.length} checked</div>
        </div>
        <button
          onClick={reset}
          title="Reset for the next setup"
          className="flex items-center justify-center w-10 h-10 rounded shrink-0"
          style={{ ...glassChipStyle(), color: "var(--text-secondary)", cursor: "pointer" }}
        >
          <FiRotateCcw size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {ITEMS.map((item, i) => {
          const done = checked[i];
          return (
            <motion.button
              key={i}
              onClick={() => toggle(i)}
              className="flex items-start gap-3 rounded-md px-4 py-3.5 text-left"
              style={glassChipStyle(done ? "#1c7d4c" : undefined)}
              variants={fadeUpVariants} initial="hidden" animate="visible" transition={{ ...TRANSITION_FAST, delay: i * 0.03 }}
            >
              {done ? (
                <FiCheckSquare size={20} className="shrink-0 mt-0.5" style={{ color: "#1c7d4c" }} />
              ) : (
                <FiSquare size={20} className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
              )}
              <span
                className="text-[15px] leading-snug"
                style={{ color: "var(--text-secondary)", textDecoration: done ? "line-through" : "none", opacity: done ? 0.85 : 1 }}
              >
                {item}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
