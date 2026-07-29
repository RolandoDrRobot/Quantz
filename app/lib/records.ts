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
}

const KEY = "axe-trade-records";

export function loadRecords(): TradeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecord(r: TradeRecord) {
  try {
    const all = loadRecords();
    all.unshift(r); // newest first
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
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
  const losses = rs.filter(r => r.pnl <= 0);
  const grossWin = wins.reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnl, 0));
  const netPnl = grossWin - grossLoss;

  let streak = 0;
  for (const r of rs) { // rs is newest-first
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
