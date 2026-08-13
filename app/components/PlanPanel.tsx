"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { FiTarget, FiAlertTriangle } from "react-icons/fi";
import { ACCOUNT } from "../lib/markets";
import { loadEntries, computeJournalStats, type JournalEntry } from "../lib/journal";
import { fmtMoney, fmtSignedMoney } from "../lib/format";
import { glassStyle, glassChipStyle } from "../lib/glass";
import { fadeUpVariants, TRANSITION_FAST } from "../lib/motionVariants";

// The standing rules — not a per-trade ritual (that's what the old checklist
// was), this is the discipline plan itself: what has to hold true every day,
// not just before one entry. Grounded in the same strategy rules used
// throughout the app (analysis.ts's trend-alignment/retest/R:R requirements)
// plus the account-level discipline rules the trader asked to be held to.
const MAX_TRADES_PER_DAY = 2;
const MIN_RR = 1.5;
const DAILY_RISK_CAP_PCT = 5;
const TRADING_DAYS_PER_WEEK = 5;
// Used only as a starting assumption for the projection widget below when
// there isn't enough real journal history yet — never presented as fact.
const DEFAULT_WIN_RATE = 0.5;
const MIN_SAMPLE_FOR_REAL_WINRATE = 3;

const RULES = [
  `Max ${MAX_TRADES_PER_DAY} trades per day — no exceptions, no "just one more"`,
  "Never move or remove your stop loss once it's set",
  `Risk no more than ${DAILY_RISK_CAP_PCT}% of the account per day, total`,
  "Only trade breakouts that align with the trend — no counter-trend entries",
  "Enter only on a confirmed retest — never chase the initial break",
  `Minimum ${MIN_RR}:1 reward-to-risk on every setup`,
  "Respect the session window — NASDAQ/Dow only in the ±15/30min open window",
];

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export default function PlanPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  // Lazy initializer, not a bare Date.now() call in the render body — React
  // forbids impure calls mid-render; useState's initializer form is exempt.
  const [now] = useState(() => Date.now());

  // Reading localStorage during the initial render would desync the static
  // server-prerendered HTML from the client's first paint — applying it
  // post-mount via an effect is what avoids that hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEntries(loadEntries());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const todayEntries = entries.filter(e => isSameDay(e.date, now));
  const todayCount = todayEntries.length;
  const todayPnl = todayEntries.reduce((s, e) => s + (e.pnl ?? 0), 0);
  const overLimit = todayCount > MAX_TRADES_PER_DAY;

  const dailyRiskCapDollars = (ACCOUNT.balance * DAILY_RISK_CAP_PCT) / 100;
  const maxDailyRiskAtPlan = MAX_TRADES_PER_DAY * ACCOUNT.riskPerTrade;

  // Real win rate once there's enough logged history to mean anything;
  // otherwise fall back to a stated, clearly-labeled assumption rather than
  // pretending a 1-trade sample is a real edge.
  const stats = computeJournalStats(entries);
  const sampleSize = stats.wins + stats.losses;
  const usingRealWinRate = sampleSize >= MIN_SAMPLE_FOR_REAL_WINRATE;
  const winRate = usingRealWinRate ? stats.winRate / 100 : DEFAULT_WIN_RATE;

  const reward = ACCOUNT.riskPerTrade * MIN_RR;
  const expectancyPerTrade = winRate * reward - (1 - winRate) * ACCOUNT.riskPerTrade;
  const weeklyProjection = expectancyPerTrade * MAX_TRADES_PER_DAY * TRADING_DAYS_PER_WEEK;
  const horizons = [
    { label: "1 week", weeks: 1 },
    { label: "1 month", weeks: 4 },
    { label: "3 months", weeks: 13 },
  ];

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Today's discipline — the honest, real-time check against the plan */}
      <div className="rounded-md px-5 py-4" style={glassStyle(overLimit ? "#8a2f2a" : "#1c7d4c")}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>{fmtDate(now).toUpperCase()}</div>
            <div className="text-2xl font-black leading-tight mt-0.5" style={{ color: overLimit ? "#8a2f2a" : "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              {todayCount}/{MAX_TRADES_PER_DAY} trades today
            </div>
          </div>
          {todayEntries.length > 0 && (
            <div className="text-right">
              <div className="text-lg font-black" style={{ color: todayPnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                {fmtSignedMoney(todayPnl)}
              </div>
              <div className="text-[10px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>TODAY</div>
            </div>
          )}
        </div>
        {overLimit && (
          <div className="flex items-start gap-2 mt-3 text-sm" style={{ color: "#8a2f2a" }}>
            <FiAlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>You&apos;re over the daily limit. This is exactly the moment the plan exists for — stop here, not after the next one.</span>
          </div>
        )}
        {!overLimit && todayCount === MAX_TRADES_PER_DAY && (
          <div className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            You&apos;re at your limit for today. Done is done — walk away.
          </div>
        )}
      </div>

      {/* The rules themselves — one compact box per rule so each one actually
          stands out, instead of getting lost in a flat list. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <FiTarget size={18} style={{ color: "var(--text-primary)" }} />
          <span className="font-black text-base tracking-wider" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            THE PLAN
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {RULES.map((rule, i) => (
            <motion.div
              key={i}
              className="flex items-start gap-3 rounded-md px-4 py-3"
              style={glassChipStyle()}
              variants={fadeUpVariants} initial="hidden" animate="visible" transition={{ ...TRANSITION_FAST, delay: i * 0.03 }}
            >
              <span
                className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 text-[11px] font-black"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
              >
                {i + 1}
              </span>
              <span className="text-[15px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{rule}</span>
            </motion.div>
          ))}
        </div>

        <div className="px-4 py-3 rounded-md text-xs" style={{ ...glassChipStyle(), color: "var(--text-muted)" }}>
          {MAX_TRADES_PER_DAY} trades × {fmtMoney(ACCOUNT.riskPerTrade)} risk each = {fmtMoney(maxDailyRiskAtPlan)} max daily risk —
          inside the {fmtMoney(dailyRiskCapDollars)} ({DAILY_RISK_CAP_PCT}%) ceiling on a {fmtMoney(ACCOUNT.balance)} account, on purpose.
        </div>
      </div>

      {/* Where you'll be if you actually respect it */}
      <div className="rounded-md px-5 py-4" style={glassStyle("#1c7d4c")}>
        <div className="text-base font-black tracking-wider" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
          IF YOU RESPECT THE PLAN
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {usingRealWinRate
            ? `Based on your actual logged win rate (${stats.winRate}%, ${sampleSize} decided trades) and the plan's ${MIN_RR}:1 minimum R:R.`
            : `Not enough logged trades yet to use your real win rate — this assumes ${Math.round(DEFAULT_WIN_RATE * 100)}% (a neutral placeholder) at the plan's ${MIN_RR}:1 minimum R:R. Log a few more trades in the Journal and this becomes real.`}
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-4">
          {horizons.map(h => {
            const projected = ACCOUNT.balance + weeklyProjection * h.weeks;
            return (
              <div key={h.label} className="rounded-md px-3 py-3" style={glassChipStyle()}>
                <div className="text-[10px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>{h.label.toUpperCase()}</div>
                <div className="text-lg font-black leading-tight mt-1" style={{ color: "#1c7d4c", fontFamily: "var(--font-display)" }}>
                  {fmtMoney(Math.round(projected))}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {fmtSignedMoney(Math.round(weeklyProjection * h.weeks))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] mt-3 leading-snug" style={{ color: "var(--text-muted)" }}>
          Expectancy: {fmtSignedMoney(Math.round(expectancyPerTrade))}/trade · {fmtSignedMoney(Math.round(weeklyProjection))}/week at {MAX_TRADES_PER_DAY}/day, {TRADING_DAYS_PER_WEEK} days/week.
          This is a straight-line estimate off the assumptions above, not a promise — it&apos;s only true on the days you actually stick to the plan.
        </div>
      </div>
    </div>
  );
}
