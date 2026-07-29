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
  startedAt: number;
  updatedAt: number;
  exitPrice?: number;  // set when the position is closed manually
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

// autoTrade = Trade Bot ON: entries are taken automatically when the retest
// holds. With the bot OFF, RETEST_ACTIVE waits for the user to take the trade
// manually (takeTrade) — if price leaves the zone untaken, we re-arm the retest.
export function advanceOpportunity(o: Opportunity, price: number, autoTrade = true): Opportunity {
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
      if (beyond && !inZone) {
        return autoTrade
          ? { ...o, phase: "CONFIRMED", updatedAt: now }   // bot takes the trade
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
export function takeTrade(o: Opportunity): Opportunity {
  if (o.phase !== "RETEST_ACTIVE" && o.phase !== "AWAIT_RETEST") return o;
  return { ...o, phase: "CONFIRMED", updatedAt: Date.now() };
}

export function skipTrade(o: Opportunity): Opportunity {
  return { ...o, phase: "INVALIDATED", updatedAt: Date.now() };
}

// Close an open position at the current market price
export function closeTrade(o: Opportunity, price: number): Opportunity {
  if (o.phase !== "CONFIRMED") return o;
  return { ...o, phase: "CLOSED", exitPrice: price, updatedAt: Date.now() };
}

// Live P/L in dollars assuming entry at the level with the account's risk sizing
export function livePnl(o: Opportunity, price: number): number {
  const perPoint = 100 / o.slPoints;
  const diff = o.direction === "long" ? price - o.entry : o.entry - price;
  return diff * perPoint;
}
