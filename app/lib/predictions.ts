// Automatic log of every opportunity Taylor's engine has ever detected, and
// whether the prediction it implied (TP before SL) came true. Logged the
// moment an opportunity is created (createOpportunity succeeds) — not later
// at CONFIRMED — so a setup that never even validated shows up too; hiding
// those would be survivorship bias.
//
// This is deliberately NOT account-performance tracking (no net P/L, profit
// factor, win streak) — the app never takes a real position, so there's no
// account to perform. What's tracked is prediction accuracy: did the call
// resolve TP, SL, or never even confirm.

export interface PredictionRecord {
  id: string;
  market: string;                 // e.g. "US100", "XAUUSD" (Market.short)
  direction: "long" | "short";
  level: number;                  // the breakout/retest level being tracked
  entry: number;
  sl: number;
  tp: number;
  probability: number;            // Taylor's score at creation
  createdAt: number;
  resolvedAt: number | null;
  outcome: "PENDING" | "TP_HIT" | "SL_HIT" | "INVALIDATED";
  resolvedPrice?: number;         // price at resolution (tp/sl price, or the invalidating tick)
  pnlAtResolution?: number;       // what it "would have been worth" at the kept lot sizing —
                                   // only set for TP_HIT/SL_HIT; left undefined for INVALIDATED
                                   // since no position was ever conceptually opened
}

const KEY = "axe-predictions";
const MAX_RECORDS = 2000; // plenty for a personal log, caps unbounded growth

function isPredictionRecord(v: unknown): v is PredictionRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.market === "string" &&
    (r.direction === "long" || r.direction === "short") &&
    typeof r.level === "number" &&
    typeof r.entry === "number" &&
    typeof r.sl === "number" &&
    typeof r.tp === "number" &&
    typeof r.probability === "number" &&
    typeof r.createdAt === "number" &&
    (r.resolvedAt === null || typeof r.resolvedAt === "number") &&
    (r.outcome === "PENDING" || r.outcome === "TP_HIT" || r.outcome === "SL_HIT" || r.outcome === "INVALIDATED") &&
    (r.resolvedPrice === undefined || typeof r.resolvedPrice === "number") &&
    (r.pnlAtResolution === undefined || typeof r.pnlAtResolution === "number")
  );
}

export function loadPredictions(): PredictionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPredictionRecord);
  } catch {
    return [];
  }
}

function save(all: PredictionRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

export function addPrediction(p: PredictionRecord) {
  try {
    const all = loadPredictions();
    all.unshift(p); // newest first
    if (all.length > MAX_RECORDS) all.length = MAX_RECORDS;
    save(all);
  } catch { /* storage unavailable */ }
}

export function resolvePrediction(
  id: string,
  outcome: Exclude<PredictionRecord["outcome"], "PENDING">,
  resolvedPrice: number,
  pnlAtResolution?: number
) {
  try {
    const all = loadPredictions();
    const idx = all.findIndex(r => r.id === id);
    if (idx === -1) return; // stale predictionId (e.g. evicted by the cap) — nothing to update
    all[idx] = { ...all[idx], outcome, resolvedAt: Date.now(), resolvedPrice, pnlAtResolution };
    save(all);
  } catch { /* storage unavailable */ }
}

export function clearPredictions() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export interface PredictionStats {
  total: number;
  pending: number;
  resolved: number;        // tpHits + slHits + invalidated
  tpHits: number;
  slHits: number;
  invalidated: number;
  hitRate: number;         // 0-100 — tpHits / (tpHits + slHits); of calls that actually played
                            // out, how often was the direction right. Excludes invalidated/pending.
  invalidatedRate: number; // 0-100 — invalidated / resolved
}

export function computePredictionStats(rs: PredictionRecord[]): PredictionStats {
  const total = rs.length;
  const pending = rs.filter(r => r.outcome === "PENDING").length;
  const tpHits = rs.filter(r => r.outcome === "TP_HIT").length;
  const slHits = rs.filter(r => r.outcome === "SL_HIT").length;
  const invalidated = rs.filter(r => r.outcome === "INVALIDATED").length;
  const resolved = tpHits + slHits + invalidated;
  const played = tpHits + slHits;

  return {
    total,
    pending,
    resolved,
    tpHits,
    slHits,
    invalidated,
    hitRate: played > 0 ? (tpHits / played) * 100 : 0,
    invalidatedRate: resolved > 0 ? (invalidated / resolved) * 100 : 0,
  };
}
