// Trade performance records — per-trade P/L only, never portfolio equity.
// Every trade risks the same fixed amount (ACCOUNT.riskPerTrade), so results
// are comparable across instruments.

export interface TradeRecord {
  id: string;
  time: number;                    // when the trade resolved
  market: string;                  // e.g. "US100", "XAUUSD"
  direction: "long" | "short";
  entry: number;
  exit: number;
  outcome: "TP" | "SL" | "MANUAL";
  pnl: number;                     // dollars
  rMultiple: number;               // pnl / risk
  probability?: number;            // Taylor's score when the opportunity was created —
                                    // optional so old records without it still load fine
}

const KEY = "axe-trade-records";
const MAX_RECORDS = 2000; // plenty for a personal trading journal, caps unbounded growth

function isTradeRecord(v: unknown): v is TradeRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.time === "number" &&
    typeof r.market === "string" &&
    (r.direction === "long" || r.direction === "short") &&
    typeof r.entry === "number" &&
    typeof r.exit === "number" &&
    (r.outcome === "TP" || r.outcome === "SL" || r.outcome === "MANUAL") &&
    typeof r.pnl === "number" &&
    typeof r.rMultiple === "number" &&
    (r.probability === undefined || typeof r.probability === "number")
  );
}

export function loadRecords(): TradeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // A corrupted or hand-edited localStorage entry used to flow straight
    // into computeStats/the trade list and crash the Records modal — guard
    // against a non-array payload and drop any malformed individual rows.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTradeRecord);
  } catch {
    return [];
  }
}

export function addRecord(r: TradeRecord) {
  try {
    const all = loadRecords();
    all.unshift(r); // newest first
    if (all.length > MAX_RECORDS) all.length = MAX_RECORDS;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// "Today" in Costa Rica local time, matching how trade times are displayed
// everywhere else in the app (RecordsPanel, JournalPanel) — a trade at
// 11pm CR shouldn't count against tomorrow's UTC-day limit.
export function getTodayRecords(records: TradeRecord[]): TradeRecord[] {
  const todayStr = new Date().toLocaleDateString("en-US", { timeZone: "America/Costa_Rica" });
  return records.filter(r => new Date(r.time).toLocaleDateString("en-US", { timeZone: "America/Costa_Rica" }) === todayStr);
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;        // 0-100
  netPnl: number;
  grossWin: number;
  grossLoss: number;      // positive number
  profitFactor: number;   // grossWin / grossLoss
  avgWin: number;
  avgLoss: number;        // positive number
  expectancy: number;     // avg pnl per trade
  best: number;
  worst: number;
  streak: number;         // positive = current win streak, negative = loss streak
}

export function computeStats(rs: TradeRecord[]): TradeStats {
  const total = rs.length;
  const wins = rs.filter(r => r.pnl > 0);
  // Exact breakeven (pnl === 0) is neither a win nor a loss — it used to
  // count as a loss here, silently breaking win streaks and dragging down
  // winRate/avgLoss for a trade that made/lost nothing.
  const losses = rs.filter(r => r.pnl < 0);
  const grossWin = wins.reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnl, 0));
  const netPnl = grossWin - grossLoss;

  let streak = 0;
  for (const r of rs) { // rs is newest-first
    if (r.pnl === 0) break; // breakeven trade — doesn't extend or break a streak, but ends the count
    const win = r.pnl > 0;
    if (streak === 0) streak = win ? 1 : -1;
    else if (streak > 0 && win) streak++;
    else if (streak < 0 && !win) streak--;
    else break;
  }

  return {
    total,
    wins: wins.length,
    losses: losses.length,
    winRate: total > 0 ? (wins.length / total) * 100 : 0,
    netPnl,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? grossWin / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    expectancy: total > 0 ? netPnl / total : 0,
    best: total > 0 ? Math.max(...rs.map(r => r.pnl)) : 0,
    worst: total > 0 ? Math.min(...rs.map(r => r.pnl)) : 0,
    streak,
  };
}
