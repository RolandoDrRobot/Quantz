// Derived, bounded-size view over the trade log + journal, built specifically
// for the AI second-opinion payload (and mirrored in the UI) — never grows
// with trade count, so it can ride along on every "New Analysis" call without
// the token cost creeping up over months of trading.
import { loadRecords, computeStats, type TradeRecord } from "./records";
import { loadJournal, EMOTIONS, type Emotion, type SetupGrade, type JournalEntry } from "./journal";

const MIN_SAMPLE = 2; // a single trade is noise, not a pattern

export interface GradeBreakdown { grade: SetupGrade; count: number; winRate: number }
export interface EmotionBreakdown { emotion: Emotion; count: number; winRate: number; avgR: number }

export interface TraderProfileSummary {
  hasHistory: boolean;
  totalTrades: number;
  winRate: number;
  expectancy: number;
  profitFactor: number | null;        // Infinity -> null explicitly, never rely on JSON.stringify's coercion
  currentStreak: number;
  planAdherenceRate: number | null;   // null when fewer than MIN_SAMPLE journaled trades have followedPlan set
  bySetupGrade: GradeBreakdown[];     // only grades with >= MIN_SAMPLE trades
  byEmotion: EmotionBreakdown[];      // only emotions with >= MIN_SAMPLE trades, worst win rate first
  recentNotes: string[];              // up to 3 most recent non-empty notes, truncated to 140 chars
}

export const EMPTY_PROFILE: TraderProfileSummary = {
  hasHistory: false, totalTrades: 0, winRate: 0, expectancy: 0, profitFactor: null,
  currentStreak: 0, planAdherenceRate: null, bySetupGrade: [], byEmotion: [], recentNotes: [],
};

export function computeTraderProfile(records: TradeRecord[], journal: Record<string, JournalEntry>): TraderProfileSummary {
  if (records.length === 0) return EMPTY_PROFILE;
  const stats = computeStats(records);

  const journaled = records.filter(r => journal[r.id]);
  const withPlanFlag = journaled.filter(r => journal[r.id].followedPlan !== null);
  const planAdherenceRate = withPlanFlag.length >= MIN_SAMPLE
    ? Math.round((withPlanFlag.filter(r => journal[r.id].followedPlan === true).length / withPlanFlag.length) * 100)
    : null;

  const gradeOrder: SetupGrade[] = ["A+", "A", "B", "C"];
  const bySetupGrade: GradeBreakdown[] = gradeOrder
    .map(grade => {
      const rs = journaled.filter(r => journal[r.id].setupGrade === grade);
      return rs.length >= MIN_SAMPLE
        ? { grade, count: rs.length, winRate: Math.round((rs.filter(r => r.pnl > 0).length / rs.length) * 100) }
        : null;
    })
    .filter((g): g is GradeBreakdown => g !== null);

  const byEmotion: EmotionBreakdown[] = EMOTIONS
    .map(emotion => {
      const rs = journaled.filter(r => journal[r.id].emotion === emotion);
      if (rs.length < MIN_SAMPLE) return null;
      const wins = rs.filter(r => r.pnl > 0).length;
      const avgR = rs.reduce((s, r) => s + r.rMultiple, 0) / rs.length;
      return { emotion, count: rs.length, winRate: Math.round((wins / rs.length) * 100), avgR: parseFloat(avgR.toFixed(2)) };
    })
    .filter((e): e is EmotionBreakdown => e !== null)
    .sort((a, b) => a.winRate - b.winRate); // worst pattern first — the one worth flagging

  const recentNotes = records // already newest-first
    .filter(r => journal[r.id]?.notes.trim())
    .slice(0, 3)
    .map(r => journal[r.id].notes.trim().slice(0, 140));

  return {
    hasHistory: true,
    totalTrades: stats.total,
    winRate: Math.round(stats.winRate),
    expectancy: parseFloat(stats.expectancy.toFixed(2)),
    profitFactor: Number.isFinite(stats.profitFactor) ? parseFloat(stats.profitFactor.toFixed(2)) : null,
    currentStreak: stats.streak,
    planAdherenceRate, bySetupGrade, byEmotion, recentNotes,
  };
}

// The function callers actually use. Wrapped in its own try/catch — on top of
// loadRecords()/loadJournal() already self-guarding — so a corrupted
// localStorage entry degrades to EMPTY_PROFILE instead of throwing into
// analyze()/fetchAiTake.
export function buildTraderProfileSummary(): TraderProfileSummary {
  try {
    return computeTraderProfile(loadRecords(), loadJournal());
  } catch {
    return EMPTY_PROFILE;
  }
}
