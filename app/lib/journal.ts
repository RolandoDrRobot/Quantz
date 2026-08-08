// Per-trade journal entries — keyed by TradeRecord.id (see records.ts) so
// each entry stays attached to its trade's market/direction/P&L/time without
// duplicating that data here. This is the qualitative layer (plan adherence,
// setup grade, emotional state, notes) meant for later review/study — the
// quantitative layer (win rate, expectancy, etc.) lives in records.ts.

export type SetupGrade = "A+" | "A" | "B" | "C";

export const EMOTIONS = ["Calm", "Confident", "Anxious", "FOMO", "Impatient", "Revenge", "Bored", "Excited"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export interface JournalEntry {
  followedPlan: boolean | null;
  setupGrade: SetupGrade | null;
  emotion: Emotion | null;
  notes: string;
}

export const EMPTY_ENTRY: JournalEntry = { followedPlan: null, setupGrade: null, emotion: null, notes: "" };

const KEY = "axe-journal-entries";

function isJournalEntry(v: unknown): v is JournalEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    (e.followedPlan === null || typeof e.followedPlan === "boolean") &&
    (e.setupGrade === null || ["A+", "A", "B", "C"].includes(e.setupGrade as string)) &&
    (e.emotion === null || (EMOTIONS as readonly string[]).includes(e.emotion as string)) &&
    typeof e.notes === "string"
  );
}

export function loadJournal(): Record<string, JournalEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, JournalEntry> = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isJournalEntry(entry)) out[id] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveJournal(entries: Record<string, JournalEntry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* storage unavailable */ }
}
