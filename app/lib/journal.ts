// Manual trade journal — a personal ledger the trader edits by hand, distinct
// from the automatic PredictionRecord log in predictions.ts (which tracks
// whether Taylor's calls would have played out, purely for accuracy stats).
// Nothing here is derived or verified — every field is exactly what the
// trader typed, since trades are still placed manually in the broker outside
// this app. This is what actually helps them manage real capital.

export interface JournalEntry {
  id: string;
  date: number;              // ms epoch — editable, defaults to "now" on creation
  market: string;             // free text (e.g. "US100") — not locked to MARKETS keys
  direction: "long" | "short";
  entry: number | null;
  exit: number | null;
  size: number | null;        // lots
  pnl: number | null;         // the actual $ result — the number that matters for capital
  notes: string;
  createdAt: number;
  updatedAt: number;
}

const KEY = "axe-manual-journal";
const MAX_ENTRIES = 1000; // plenty for a personal ledger, caps unbounded growth

function isJournalEntry(v: unknown): v is JournalEntry {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.date === "number" &&
    typeof r.market === "string" &&
    (r.direction === "long" || r.direction === "short") &&
    (r.entry === null || typeof r.entry === "number") &&
    (r.exit === null || typeof r.exit === "number") &&
    (r.size === null || typeof r.size === "number") &&
    (r.pnl === null || typeof r.pnl === "number") &&
    typeof r.notes === "string" &&
    typeof r.createdAt === "number" &&
    typeof r.updatedAt === "number"
  );
}

export function loadEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isJournalEntry).sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

function save(all: JournalEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

export type NewJournalEntry = Omit<JournalEntry, "id" | "createdAt" | "updatedAt">;

export function addEntry(entry: NewJournalEntry): JournalEntry {
  const now = Date.now();
  const created: JournalEntry = {
    ...entry,
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const all = loadEntries();
    all.unshift(created);
    if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
    save(all);
  } catch { /* storage unavailable */ }
  return created;
}

export function updateEntry(id: string, patch: Partial<NewJournalEntry>): void {
  try {
    const all = loadEntries();
    const idx = all.findIndex(e => e.id === id);
    if (idx === -1) return;
    all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
    save(all);
  } catch { /* storage unavailable */ }
}

export function deleteEntry(id: string): void {
  try {
    const all = loadEntries().filter(e => e.id !== id);
    save(all);
  } catch { /* storage unavailable */ }
}

export interface JournalStats {
  count: number;
  totalPnl: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100, of entries with a non-null, non-zero pnl
  avgPnl: number;
}

export function computeJournalStats(entries: JournalEntry[]): JournalStats {
  const withPnl = entries.filter(e => e.pnl !== null);
  const wins = withPnl.filter(e => (e.pnl ?? 0) > 0).length;
  const losses = withPnl.filter(e => (e.pnl ?? 0) < 0).length;
  const decided = wins + losses; // excludes exact-zero (scratch) trades from the rate
  const totalPnl = withPnl.reduce((s, e) => s + (e.pnl ?? 0), 0);
  return {
    count: entries.length,
    totalPnl,
    wins,
    losses,
    winRate: decided > 0 ? Math.round((wins / decided) * 100) : 0,
    avgPnl: withPnl.length > 0 ? totalPnl / withPnl.length : 0,
  };
}
