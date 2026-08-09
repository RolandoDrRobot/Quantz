import type { AnalysisResult, Level } from "./analysis";
import { ACCOUNT } from "./markets";

// Live-tracked opportunity, advanced tick by tick:
// HUNTING → AWAIT_RETEST → RETEST_ACTIVE → CONFIRMED → TP_HIT / SL_HIT
// Any stage can die into INVALIDATED if price pushes hard against the setup.
// The app never takes a real position — this purely tracks whether Taylor's
// call (TP before SL) would have played out, for the automatic prediction log.
export type OppPhase =
  | "HUNTING"        // waiting for price to break the level
  | "AWAIT_RETEST"   // level broken — waiting for price to come back to it
  | "RETEST_ACTIVE"  // price is retesting the level right now
  | "CONFIRMED"      // retest held — tracking live toward TP/SL
  | "TP_HIT"
  | "SL_HIT"
  | "INVALIDATED";

export interface Opportunity {
  phase: OppPhase;
  direction: "long" | "short";
  level: number;       // the level being broken / retested (= entry) — moves on re-anchor
  anchorLevel: number; // the breakout level invalidation is judged against — stays fixed
                        // through ordinary pullback/consolidation so a normal retest never
                        // reads as a failure, but moves WITH `level` on a re-anchor (see
                        // advanceOpportunity's AWAIT_RETEST case) so the failure tolerance
                        // stays anchored to whatever level is actually being tracked now,
                        // instead of drifting arbitrarily far from it after a big run
  retestZone: number;
  entry: number;
  sl: number;
  tp: number;
  slPoints: number;
  cost: number;        // round-trip broker cost (spread) in dollars — reference for manual sizing
  analysisProbability: number; // Taylor's score at creation — carried onto the
                                // PredictionRecord when this resolves, so scoring can
                                // eventually be checked against real outcomes
  startedAt: number;
  updatedAt: number;
  confirmedPrice?: number; // price at the moment the retest confirmed (was "fillPrice" —
                            // renamed since CONFIRMED no longer means a real position filled)
  predictionId?: string;   // links this live opportunity to its logged PredictionRecord
                            // (see lib/predictions.ts), set by the caller right after creation
}

export function createOpportunity(a: AnalysisResult, slPoints: number, cost: number): Opportunity | null {
  if (!a.tradeSetup) return null;
  // A breakout that already happened but isn't trend-aligned (or scored too
  // low to trust) is exactly what Taylor's own message calls a trap — don't
  // hand back a trackable opportunity for it (which would reach RETEST_ACTIVE
  // on the very next tick, since price is already past the level). Nothing
  // to hunt at this level anymore; the next "New Analysis" looks for a
  // cleaner setup instead.
  if (a.breakout && a.signal === "WAIT") return null;
  const now = Date.now();
  const startLevel = a.breakout?.level ?? a.tradeSetup.entryPrice;
  return {
    phase: a.breakout ? "AWAIT_RETEST" : "HUNTING",
    direction: a.tradeSetup.direction,
    level: startLevel,
    anchorLevel: startLevel,
    retestZone: a.breakout?.retestZone ?? slPoints * 0.25,
    entry: a.tradeSetup.entryPrice,
    sl: a.tradeSetup.stopLoss,
    tp: a.tradeSetup.takeProfit,
    slPoints,
    cost,
    analysisProbability: a.probability,
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

// `levels` enables dynamic re-anchoring: if price runs away from a broken
// level without retesting, the opportunity jumps to the nearest freshly-
// broken level. A held retest always confirms — there's no bot/manual
// distinction anymore, since the app never takes a real position either way.
export function advanceOpportunity(o: Opportunity, price: number, levels: Level[] = []): Opportunity {
  const now = Date.now();
  const dirUp = o.direction === "long";
  const beyond = dirUp ? price > o.level : price < o.level;  // past the level in trade direction
  const inZone = Math.abs(price - o.level) < o.retestZone;
  // Judged against the ORIGINAL breakout level, not the live (possibly
  // re-anchored) one — otherwise catching up to a farther level after a
  // strong run shrinks the pullback room needed to call the move failed,
  // right when a bit of normal consolidation is most likely.
  const failed = dirUp
    ? price < o.anchorLevel - o.retestZone * 3
    : price > o.anchorLevel + o.retestZone * 3;

  switch (o.phase) {
    case "HUNTING":
      // Break counts once price clears the retest zone past the level
      if (beyond && !inZone) return { ...o, phase: "AWAIT_RETEST", updatedAt: now };
      return { ...o, updatedAt: now };

    case "AWAIT_RETEST": {
      if (failed) return { ...o, phase: "INVALIDATED", updatedAt: now };
      if (inZone) return { ...o, phase: "RETEST_ACTIVE", updatedAt: now };

      // Re-anchor: price ran more than 1 SL past the broken level without
      // retesting — that retest is likely gone. The live read is at the
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
            // Re-anchoring `anchorLevel` too: this new level is now the setup
            // being tracked, so its own failure tolerance should be judged
            // relative to itself — not to a level several re-anchors back,
            // which would make INVALIDATED nearly unreachable after a run.
            anchorLevel: newLevel,
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
        return { ...o, phase: "CONFIRMED", confirmedPrice: price, updatedAt: now };
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

// Live P/L in dollars from the price at confirmation, minus broker cost
// (spread) — reference info for sizing/tracking a manually-placed trade, not
// a real position the app itself holds. A fresh confirm correctly starts
// slightly negative — you'd pay the spread.
export function livePnl(o: Opportunity, price: number): number {
  const perPoint = ACCOUNT.riskPerTrade / o.slPoints;
  const base = o.confirmedPrice ?? o.entry;
  const diff = o.direction === "long" ? price - base : base - price;
  return diff * perPoint - (o.cost ?? 0);
}
