import type { AnalysisResult } from "./analysis";

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
  startedAt: number;
  updatedAt: number;
}

export function createOpportunity(a: AnalysisResult, slPoints: number): Opportunity | null {
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
    startedAt: now,
    updatedAt: now,
  };
}

export function advanceOpportunity(o: Opportunity, price: number): Opportunity {
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

    case "AWAIT_RETEST":
      if (failed) return { ...o, phase: "INVALIDATED", updatedAt: now };
      if (inZone) return { ...o, phase: "RETEST_ACTIVE", updatedAt: now };
      return { ...o, updatedAt: now };

    case "RETEST_ACTIVE":
      if (failed) return { ...o, phase: "INVALIDATED", updatedAt: now };
      // Retest held: price bounced off the level and cleared the zone again
      if (beyond && !inZone) return { ...o, phase: "CONFIRMED", updatedAt: now };
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

// Live P/L in dollars assuming entry at the level with the account's risk sizing
export function livePnl(o: Opportunity, price: number): number {
  const perPoint = 100 / o.slPoints;
  const diff = o.direction === "long" ? price - o.entry : o.entry - price;
  return diff * perPoint;
}
