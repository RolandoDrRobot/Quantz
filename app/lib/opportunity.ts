import type { AnalysisResult, Level } from "./analysis";
import { ACCOUNT } from "./markets";

// Live-tracked trade opportunity, advanced tick by tick:
// HUNTING → AWAIT_RETEST → RETEST_ACTIVE → CONFIRMED → TP_HIT / SL_HIT
// Any stage can die into INVALIDATED if price pushes hard against the setup.
export type OppPhase =
  | "HUNTING"        // waiting for price to break the level
  | "AWAIT_RETEST"   // level broken — waiting for price to come back to it
  | "RETEST_ACTIVE"  // price is retesting the level right now
  | "CONFIRMED"      // retest held — trade is live, tracking P/L
  | "TP_HIT"
  | "SL_HIT"
  | "CLOSED"         // manually closed at market price
  | "INVALIDATED";

export interface Opportunity {
  phase: OppPhase;
  direction: "long" | "short";
  level: number;       // the level being broken / retested (= entry)
  retestZone: number;
  entry: number;
  sl: number;
  tp: number;
  slPoints: number;
  cost: number;        // round-trip broker cost (spread) in dollars
  startedAt: number;
  updatedAt: number;
  fillPrice?: number;  // actual market price when the trade was entered
  exitPrice?: number;  // set when the position is closed manually
}

export function createOpportunity(a: AnalysisResult, slPoints: number, cost: number): Opportunity | null {
  if (!a.tradeSetup) return null;
  const now = Date.now();
  return {
    phase: a.breakout ? "AWAIT_RETEST" : "HUNTING",
    direction: a.tradeSetup.direction,
    level: a.breakout?.level ?? a.tradeSetup.entryPrice,
    retestZone: a.breakout?.retestZone ?? slPoints * 0.25,
    entry: a.tradeSetup.entryPrice,
    sl: a.tradeSetup.stopLoss,
    tp: a.tradeSetup.takeProfit,
    slPoints,
    cost,
    startedAt: now,
    updatedAt: now,
  };
}

// TP: next opposite level at least 1.5R away, else fixed 2R
function computeTp(direction: "long" | "short", entry: number, slPoints: number, levels: Level[]): number {
  if (direction === "long") {
    const next = levels
      .filter(l => l.type === "resistance" && l.price >= entry + slPoints * 1.5)
      .sort((a, b) => a.price - b.price)[0];
    return next?.price ?? entry + slPoints * 2;
  }
  const next = levels
    .filter(l => l.type === "support" && l.price <= entry - slPoints * 1.5)
    .sort((a, b) => b.price - a.price)[0];
  return next?.price ?? entry - slPoints * 2;
}

// autoTrade = Trade Bot ON: entries are taken automatically when the retest
// holds. With the bot OFF, RETEST_ACTIVE waits for the user to take the trade
// manually (takeTrade) — if price leaves the zone untaken, we re-arm the retest.
// `levels` enables dynamic re-anchoring: if price runs away from a broken level
// without retesting, the opportunity jumps to the nearest freshly-broken level.
export function advanceOpportunity(o: Opportunity, price: number, autoTrade = true, levels: Level[] = []): Opportunity {
  const now = Date.now();
  const dirUp = o.direction === "long";
  const beyond = dirUp ? price > o.level : price < o.level;  // past the level in trade direction
  const inZone = Math.abs(price - o.level) < o.retestZone;
  const failed = dirUp
    ? price < o.level - o.retestZone * 3
    : price > o.level + o.retestZone * 3;

  switch (o.phase) {
    case "HUNTING":
      // Break counts once price clears the retest zone past the level
      if (beyond && !inZone) return { ...o, phase: "AWAIT_RETEST", updatedAt: now };
      return { ...o, updatedAt: now };

    case "AWAIT_RETEST": {
      if (failed) return { ...o, phase: "INVALIDATED", updatedAt: now };
      if (inZone) return { ...o, phase: "RETEST_ACTIVE", updatedAt: now };

      // Re-anchor: price ran more than 1 SL past the broken level without
      // retesting — that retest is likely gone. The live trade is at the
      // nearest level price broke on its way. Jump the opportunity there.
      const runDist = dirUp ? price - o.level : o.level - price;
      if (runDist > o.slPoints && levels.length > 0) {
        const crossed = levels
          .map(l => l.price)
          .filter(p => (dirUp ? p > o.level && p < price : p < o.level && p > price));
        if (crossed.length > 0) {
          const newLevel = dirUp ? Math.max(...crossed) : Math.min(...crossed);
          return {
            ...o,
            level: newLevel,
            entry: newLevel,
            sl: dirUp ? newLevel - o.slPoints : newLevel + o.slPoints,
            tp: computeTp(o.direction, newLevel, o.slPoints, levels),
            updatedAt: now,
          };
        }
      }
      return { ...o, updatedAt: now };
    }

    case "RETEST_ACTIVE":
      if (failed) return { ...o, phase: "INVALIDATED", updatedAt: now };
      // Retest held: price bounced off the level and cleared the zone again
      if (beyond && !inZone) {
        return autoTrade
          ? { ...o, phase: "CONFIRMED", fillPrice: price, updatedAt: now } // bot enters at market
          : { ...o, phase: "AWAIT_RETEST", updatedAt: now }; // untaken — wait for next touch
      }
      return { ...o, updatedAt: now };

    case "CONFIRMED": {
      const hitTp = dirUp ? price >= o.tp : price <= o.tp;
      const hitSl = dirUp ? price <= o.sl : price >= o.sl;
      if (hitTp) return { ...o, phase: "TP_HIT", updatedAt: now };
      if (hitSl) return { ...o, phase: "SL_HIT", updatedAt: now };
      return { ...o, updatedAt: now };
    }

    default:
      return o; // terminal phases stay put
  }
}

// Manual mode actions
export function takeTrade(o: Opportunity, price: number): Opportunity {
  if (o.phase !== "RETEST_ACTIVE" && o.phase !== "AWAIT_RETEST") return o;
  return { ...o, phase: "CONFIRMED", fillPrice: price, updatedAt: Date.now() };
}

// Market entry: open the position at the CURRENT price, re-basing SL and TP
// from it (same lot sizing — SL distance is unchanged)
export function enterAtMarket(o: Opportunity, price: number, levels: Level[] = []): Opportunity {
  if (o.phase === "CONFIRMED" || o.phase === "TP_HIT" || o.phase === "SL_HIT" || o.phase === "CLOSED" || o.phase === "INVALIDATED") return o;
  const dirUp = o.direction === "long";
  return {
    ...o,
    phase: "CONFIRMED",
    entry: price,
    fillPrice: price,
    sl: dirUp ? price - o.slPoints : price + o.slPoints,
    tp: computeTp(o.direction, price, o.slPoints, levels),
    updatedAt: Date.now(),
  };
}

// Close an open position at the current market price
export function closeTrade(o: Opportunity, price: number): Opportunity {
  if (o.phase !== "CONFIRMED") return o;
  return { ...o, phase: "CLOSED", exitPrice: price, updatedAt: Date.now() };
}

// Live P/L in dollars from the ACTUAL fill price, minus broker cost (spread).
// A fresh position correctly starts slightly negative — you pay the spread.
export function livePnl(o: Opportunity, price: number): number {
  const perPoint = ACCOUNT.riskPerTrade / o.slPoints;
  const base = o.fillPrice ?? o.entry;
  const diff = o.direction === "long" ? price - base : base - price;
  return diff * perPoint - (o.cost ?? 0);
}
