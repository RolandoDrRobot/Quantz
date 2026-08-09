import { RawCandle } from "../api/market/route";
import { ACCOUNT } from "./markets";
import { fmtPrice, fmtPct, fmtSignedPct } from "./format";

export type Signal = "GO_LONG" | "GO_SHORT" | "WAIT";

export interface Level {
  price: number;
  type: "support" | "resistance";
  strength: number;
}

export interface TrendInfo {
  direction: "bullish" | "bearish" | "neutral";
  momentum: "strong" | "moderate" | "weak";
  ma20: number;
  changeRecent: number; // % change over the last ~15 minutes
}

export interface TradeSetup {
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slPoints: number;
  tpPoints: number;
  rrRatio: number;
  rewardAmount: number;
}

export interface BreakoutEvent {
  level: number;
  direction: "long" | "short";
  breakoutTime: number;
  strength: number;
  retestZone: number; // price tolerance around the level that counts as a retest
}

export interface ProbFactor {
  label: string;
  points: number;
  max: number;
}

export interface Warning {
  severity: "high" | "medium";
  title: string;
  detail: string;
}

export interface AnalysisResult {
  signal: Signal;
  message: string;
  levels: Level[];
  trend: TrendInfo;
  currentPrice: number;
  priceChange: number;
  priceChangePct: number;
  tradeSetup: TradeSetup | null;
  breakout: BreakoutEvent | null;
  volume: VolumeInfo;
  volatilityRatio: number; // current ATR / this instrument's recent-average ATR; 1 = normal
  probability: number;
  probFactors: ProbFactor[];
  penalties: ProbFactor[];
  warnings: Warning[];
  marketOpen: boolean;
  inSetupWindow: boolean;
  minutesToOpen: number;
  is24h: boolean;
}

// ─── Support / Resistance ────────────────────────────────────────────────────

export function findLevels(candles: RawCandle[], currentPrice: number, slPoints: number): Level[] {
  if (candles.length < 10) return [];

  // Use only the last 600 candles (~10h on 1min) for level detection —
  // scalping cares about levels formed in the current session, not stale
  // ones from days ago.
  const slice = candles.slice(-600);
  const lookback = 3;
  const threshold = currentPrice * 0.0012;

  const clusters: (Level & { count: number })[] = [];

  const addPivot = (price: number, type: "support" | "resistance") => {
    const existing = clusters.find(cl => Math.abs(cl.price - price) < threshold && cl.type === type);
    if (existing) {
      existing.price = (existing.price * existing.count + price) / (existing.count + 1);
      existing.count++;
      existing.strength = existing.count;
    } else {
      clusters.push({ price, type, strength: 1, count: 1 });
    }
  };

  for (let i = lookback; i < slice.length - lookback; i++) {
    const c = slice[i];

    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (slice[i - j].high >= c.high || slice[i + j].high >= c.high) { isHigh = false; break; }
    }
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (slice[i - j].low <= c.low || slice[i + j].low <= c.low) { isLow = false; break; }
    }

    if (isHigh) addPivot(c.high, c.high > currentPrice ? "resistance" : "support");
    if (isLow)  addPivot(c.low,  c.low  < currentPrice ? "support"    : "resistance");
  }

  // Upper bound scales with the instrument's own SL distance instead of a
  // flat % of price — a level 2.5% away (the old fixed threshold) is ~100pts
  // on Gold at $4342, which then gets drawn as a price line and blows out
  // the chart's autoscale on a tightly-zoomed scalping view, squashing every
  // real candle into a sliver. 20x the SL keeps levels within the zone that
  // could plausibly be an entry/target for this instrument's own scale.
  const maxRelevantDist = slPoints * 20;
  return clusters
    .filter(c => {
      const dist = Math.abs(c.price - currentPrice);
      return dist / currentPrice > 0.0003 && dist < maxRelevantDist;
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 12)
    .map(({ price, type, strength }) => ({ price, type, strength }));
}

// ─── Trend ───────────────────────────────────────────────────────────────────

// Ported from nyao_scalper_mt5's "Blended Weighted Average Signal Smoothing":
// a single 1-minute close is noisy enough to flip bullish/bearish on one bad
// print. Blend a linear-decay-weighted average of the last few CLOSED candles
// (base) with the very latest close (dampened contribution) instead of
// trusting that one tick alone — cuts whipsaw while staying responsive.
function smoothedPrice(slice: RawCandle[], lookback = 3, currentBlend = 0.4): number {
  const n = slice.length;
  const latest = slice[n - 1].close;
  const closed = slice.slice(Math.max(0, n - 1 - lookback), n - 1); // closed candles before the latest
  if (closed.length === 0) return latest;
  let weightedSum = 0, weightTotal = 0;
  closed.forEach((c, i) => {
    const weight = i + 1; // oldest=1 ... newest=closed.length, linear decay toward recent
    weightedSum += c.close * weight;
    weightTotal += weight;
  });
  const base = weightTotal > 0 ? weightedSum / weightTotal : latest;
  return base * (1 - currentBlend) + latest * currentBlend;
}

function detectTrend(candles: RawCandle[]): TrendInfo {
  const slice = candles.slice(-60); // last 60 minutes on 1min candles
  if (slice.length < 20) return { direction: "neutral", momentum: "weak", ma20: 0, changeRecent: 0 };

  // ma20 on 1min candles = a 20-minute moving average — fast enough to react
  // within a scalping timeframe instead of the old ~100-minute MA on 5m bars.
  const ma20 = slice.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const current = smoothedPrice(slice);
  const recentAgo = slice[Math.max(0, slice.length - 15)].close;
  const changeRecent = ((current - recentAgo) / recentAgo) * 100;

  const direction = current > ma20 ? "bullish" : current < ma20 ? "bearish" : "neutral";
  const abs = Math.abs(changeRecent);
  // Thresholds scaled down from the old 1h-window values (0.5% / 0.15%) to
  // match a ~15min window — tuned a bit tighter than a strict sqrt(15/60)
  // scaling (which would give 0.25%/0.075%) after live testing on 1m data.
  const momentum = abs > 0.20 ? "strong" : abs > 0.07 ? "moderate" : "weak";

  return { direction, momentum, ma20, changeRecent };
}

// ─── Volume ──────────────────────────────────────────────────────────────────
// Yahoo (NASDAQ/Dow) reports real traded volume. Twelve Data's forex/crypto
// spot feed (Gold, Bitcoin) does not — every candle comes back with
// volume: 0. `hasData` distinguishes the two so we never score or warn on
// fabricated "zero volume" for an instrument that simply has no volume feed.
export interface VolumeInfo {
  hasData: boolean;
  relativeVolume: number; // recent activity vs baseline average; 1 = normal
}

function analyzeVolume(candles: RawCandle[]): VolumeInfo {
  const recent = candles.slice(-30);
  const hasData = recent.some(c => c.volume > 0);
  if (!hasData) return { hasData: false, relativeVolume: 1 };

  // Baseline = average volume over the hour before "now", current = last
  // 5 candles — relative volume answers "is there real participation behind
  // what's happening right now, or is this move on thin air?"
  const baseline = candles.slice(-60, -5);
  const baselineAvg = baseline.length > 0 ? baseline.reduce((s, c) => s + c.volume, 0) / baseline.length : 0;
  const current = candles.slice(-5);
  const currentAvg = current.length > 0 ? current.reduce((s, c) => s + c.volume, 0) / current.length : 0;

  const relativeVolume = baselineAvg > 0 ? currentAvg / baselineAvg : 1;
  return { hasData: true, relativeVolume };
}

// ─── Volatility ratio (dead-market filter) ────────────────────────────────────
// Ported from nyao_scalper_mt5's "Dead-Market Filter": current volatility
// relative to THIS instrument's own recent average, not a fixed threshold —
// a market that's always tight isn't penalized, only one that's gone quieter
// than its own normal. Uses true range (not just high-low) so a gap between
// candles still counts as real movement.
function trueRange(curr: RawCandle, prevClose: number): number {
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
}

function analyzeVolatilityRatio(candles: RawCandle[]): number {
  // Needs enough history to judge "relative to normal" — assume normal
  // (ratio 1) rather than penalize a thin data set.
  if (candles.length < 75) return 1;
  const trs: number[] = [];
  for (let i = Math.max(1, candles.length - 74); i < candles.length; i++) {
    trs.push(trueRange(candles[i], candles[i - 1].close));
  }
  const recent = trs.slice(-14);
  const baseline = trs.slice(0, -14);
  const currentATR = recent.reduce((s, v) => s + v, 0) / recent.length;
  const avgATR = baseline.length > 0 ? baseline.reduce((s, v) => s + v, 0) / baseline.length : currentATR;
  return avgATR > 0 ? currentATR / avgATR : 1;
}

// ─── Wick rejection ────────────────────────────────────────────────────────────
// Ported from nyao_scalper_mt5's wick-rejection penalty: a breakout candle
// with a long wick opposing the break direction means the move got fought
// off within the same bar — a weaker signal than a clean-bodied break, even
// though detectBreakout's body-size filter already passed it.
function wickRejectionRatio(candles: RawCandle[], breakout: BreakoutEvent): number {
  const idx = candles.findIndex(c => c.time === breakout.breakoutTime);
  if (idx === -1) return 0;
  const c = candles[idx];
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  const range = c.high - c.low;
  // Floors the divisor so a near-doji body doesn't produce a wild ratio —
  // matches detectBreakout's own body-size filter reasoning.
  const body = Math.max(bodyHigh - bodyLow, range * 0.1);
  const opposingWick = breakout.direction === "long" ? c.high - bodyHigh : bodyLow - c.low;
  return body > 0 ? opposingWick / body : 0;
}

// ─── Breakout Detection ──────────────────────────────────────────────────────

function detectBreakout(candles: RawCandle[], levels: Level[], slPoints: number): BreakoutEvent | null {
  if (candles.length < 15) return null;

  // Look only at last 30 candles (30 minutes on 1min) — scalping cares about
  // breakouts happening right now, not something that broke an hour ago.
  const window = candles.slice(-30);
  const retestZone = slPoints * 0.25; // retest = price within 1/4 SL of the level
  const failDist  = slPoints * 0.75; // close beyond this against the break = failed breakout

  for (let i = window.length - 1; i >= 2; i--) {
    const curr = window[i];
    const prev = window[i - 1];

    // Candle must have a real body (not a doji). 1min candles are naturally
    // smaller than 5min ones — the old 0.06%-of-price threshold rejected
    // almost every 1min bar, so it's halved here to still catch real moves.
    const bodySize = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0 || bodySize / range < 0.45 || bodySize / curr.close < 0.0003) continue;

    for (const level of levels) {
      // Abrupt pierce through the level, no gap
      const isBull = prev.close < level.price && curr.close > level.price && curr.open < level.price;
      const isBear = prev.close > level.price && curr.close < level.price && curr.open > level.price;
      if (!isBull && !isBear) continue;

      // Invalidation: if any later candle closed back beyond the level against
      // the breakout, it was a trap — the setup is dead, don't wait for retest
      let failed = false;
      for (let j = i + 1; j < window.length; j++) {
        const c = window[j].close;
        if (isBull && c < level.price - failDist) { failed = true; break; }
        if (isBear && c > level.price + failDist) { failed = true; break; }
      }
      // This candle+level pierce already failed — keep scanning older
      // candles/other levels instead of abandoning the whole search, so a
      // still-valid earlier breakout isn't discarded because of it.
      if (failed) continue;

      return {
        level: level.price,
        direction: isBull ? "long" : "short",
        breakoutTime: curr.time,
        strength: level.strength,
        retestZone,
      };
    }
  }

  return null;
}

// ─── Trade Setup ─────────────────────────────────────────────────────────────

// Shared TP rule: next opposite level at least 1.5R away, else fixed 2R.
// Used both for the initial trade setup below and by opportunity.ts when a
// live opportunity re-anchors to a new level — kept in one place so the two
// can never quietly drift out of sync with each other.
export function computeTakeProfit(direction: "long" | "short", entryPrice: number, slPoints: number, levels: Level[]): number {
  if (direction === "long") {
    const next = levels
      .filter(l => l.type === "resistance" && l.price >= entryPrice + slPoints * 1.5)
      .sort((a, b) => a.price - b.price)[0];
    return next?.price ?? entryPrice + slPoints * 2;
  }
  const next = levels
    .filter(l => l.type === "support" && l.price <= entryPrice - slPoints * 1.5)
    .sort((a, b) => b.price - a.price)[0];
  return next?.price ?? entryPrice - slPoints * 2;
}

function calculateTradeSetup(
  signal: Signal,
  currentPrice: number,
  levels: Level[],
  slPoints: number,
  trendDirection: "bullish" | "bearish" | "neutral",
  breakout: BreakoutEvent | null
): TradeSetup | null {
  const resistances = levels.filter(l => l.type === "resistance").sort((a, b) => a.price - b.price);
  const supports    = levels.filter(l => l.type === "support").sort((a, b) => b.price - a.price);

  if (resistances.length === 0 && supports.length === 0 && !breakout) return null;

  // Active breakout drives the setup: the strategy enters at the retest of the
  // broken level, in the direction of the break
  let direction: "long" | "short";
  if (breakout) {
    direction = breakout.direction;
  } else if (signal === "GO_LONG") {
    direction = "long";
  } else if (signal === "GO_SHORT") {
    direction = "short";
  } else {
    if (trendDirection === "bullish") direction = "long";
    else if (trendDirection === "bearish") direction = "short";
    else {
      const nearR = resistances[0] ? Math.abs(resistances[0].price - currentPrice) : Infinity;
      const nearS = supports[0]    ? Math.abs(supports[0].price    - currentPrice) : Infinity;
      direction = nearR <= nearS ? "long" : "short";
    }
  }

  const entryPrice = breakout
    ? breakout.level
    : direction === "long"
      ? (resistances[0]?.price ?? currentPrice)
      : (supports[0]?.price ?? currentPrice);

  const stopLoss = direction === "long" ? entryPrice - slPoints : entryPrice + slPoints;

  // TP: next opposite level, but never accept less than 1.5R — a trade that
  // risks $100 to make less than $150 is not part of the playbook
  const takeProfit = computeTakeProfit(direction, entryPrice, slPoints, levels);

  const tpPoints = Math.abs(takeProfit - entryPrice);
  const rrRatio = parseFloat((tpPoints / slPoints).toFixed(2));
  const rewardAmount = parseFloat((ACCOUNT.riskPerTrade * rrRatio).toFixed(0));

  return { direction, entryPrice, stopLoss, takeProfit, slPoints, tpPoints, rrRatio, rewardAmount };
}

// ─── Market timing ───────────────────────────────────────────────────────────

function getMarketTiming(is24h: boolean): { marketOpen: boolean; inSetupWindow: boolean; minutesToOpen: number } {
  if (is24h) return { marketOpen: true, inSetupWindow: true, minutesToOpen: 0 };

  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const totalMin = et.getHours() * 60 + et.getMinutes();
  const openMin = 9 * 60 + 30;

  if (day === 0 || day === 6) return { marketOpen: false, inSetupWindow: false, minutesToOpen: -1 };

  const marketOpen = totalMin >= openMin && totalMin < 16 * 60;
  const inSetupWindow = totalMin >= openMin - 15 && totalMin < openMin + 30;
  const minutesToOpen = openMin - totalMin;

  return { marketOpen, inSetupWindow, minutesToOpen };
}

// ─── Message templates ───────────────────────────────────────────────────────

const MESSAGES: Record<Signal, ((d: Record<string, unknown>) => string)[]> = {
  GO_LONG: [
    d => `${d.mkt} is ${d.chg} — tape is bullish, trade above the ${d.ma20} MA with ${d.mom} momentum. Key resistance: ${d.r1}${d.r1s ? ` (${d.r1s}x touches)` : ""}. That's your trigger level. Wait for a sharp break above it, watch for the retest to hold as support — that's your long entry. No retest, no trade.`,
    d => `Trend is up at ${d.chg}. Price is above the 20 MA at ${d.ma20} with ${d.mom} conviction. You've got a wall at ${d.r1}. When that level breaks at the open and comes back to test it — you go long. Not before. Let the market confirm.`,
    d => `${d.mkt} bulls are in control, ${d.chg} with ${d.mom} momentum. Watch resistance at ${d.r1}${d.r1s ? ` — it's been tested ${d.r1s}x, it's weakening` : ""}. Breakout + retest of that level is your green light to go long.`,
  ],
  GO_SHORT: [
    d => `${d.mkt} is ${d.chg} — bears control the tape. Trade below the ${d.ma20} MA with ${d.mom} selling pressure. Key support: ${d.s1}${d.s1s ? ` (${d.s1s}x touches)` : ""}. When that floor breaks at the open and retests as resistance — you load up short.`,
    d => `Trend is down at ${d.chg}. Price broke below the 20 MA at ${d.ma20}. Critical support at ${d.s1}. The more that level gets tested, the weaker it gets. Wait for the break, wait for the retest — then short it and ride the flush.`,
    d => `${d.mom} bearish momentum at ${d.chg}. Everything points lower. Support at ${d.s1}${d.s1s ? ` has held ${d.s1s}x` : ""} — but it's running out of gas. When it breaks at the open with volume and retests — that's your short entry.`,
  ],
  WAIT: [
    d => `Market is ${d.chg} — no edge right now. ${d.r1 ? `Resistance at ${d.r1}` : "No clear resistance"}. ${d.s1 ? `Support at ${d.s1}.` : ""} Momentum is ${d.mom} and trend is mixed. Don't force a trade. The setup window is 30 minutes — either you get a clean break with a retest, or you walk.`,
    d => `Choppy tape at ${d.chg} with ${d.mom} momentum. Structure is unclear. You've got levels on the chart but no directional conviction. Let the first 15 minutes of the open tell the story before you commit. Patience is the edge.`,
    d => `${d.chg} — it's a coin flip. ${d.r1 ? `Watch ${d.r1} as resistance` : ""}${d.r1 && d.s1 ? " and " : ""}${d.s1 ? `${d.s1} as support` : ""}. Wait for a decisive break of one of those levels with real volume. If the retest confirms — take the trade. If not, sit on your hands.`,
  ],
};

// ─── Main entry ──────────────────────────────────────────────────────────────

export function runAnalysis(
  candles: RawCandle[],
  currentPrice: number,
  prevClose: number,
  is24h: boolean,
  slPoints: number,
  marketLabel: string
): AnalysisResult {
  const priceChange = currentPrice - prevClose;
  const priceChangePct = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;
  const chg = fmtSignedPct(priceChangePct);

  const levels = findLevels(candles, currentPrice, slPoints);
  const trend  = detectTrend(candles);
  const volume = analyzeVolume(candles);
  const volatilityRatio = analyzeVolatilityRatio(candles);
  const timing = getMarketTiming(is24h);

  const resistances = levels.filter(l => l.type === "resistance").sort((a, b) => a.price - b.price);
  const supports    = levels.filter(l => l.type === "support").sort((a, b) => b.price - a.price);

  const r1 = resistances[0] ? fmtPrice(resistances[0].price) : null;
  const r1s = resistances[0]?.strength ?? null;
  const s1 = supports[0] ? fmtPrice(supports[0].price) : null;
  const s1s = supports[0]?.strength ?? null;

  const msgData = { chg, r1, r1s, s1, s1s, ma20: fmtPrice(trend.ma20), mom: trend.momentum, mkt: marketLabel };

  const breakout = detectBreakout(candles, levels, slPoints);

  // Signal follows the strategy: the trigger is a breakout IN the direction of
  // the trend. A counter-trend breakout is usually a trap → WAIT. No breakout
  // → nothing to trade yet → WAIT (message carries the directional bias).
  const breakoutAligned = !!breakout && (
    (breakout.direction === "long"  && trend.direction === "bullish") ||
    (breakout.direction === "short" && trend.direction === "bearish")
  );

  let signal: Signal;
  if (breakoutAligned) {
    signal = breakout!.direction === "long" ? "GO_LONG" : "GO_SHORT";
  } else {
    signal = "WAIT";
  }

  const tradeSetup = calculateTradeSetup(signal, currentPrice, levels, slPoints, trend.direction, breakout);

  // ── Probability score: confluence of every strategy requirement ──────────
  const dir = tradeSetup?.direction ?? null;
  const trendAligned = !!dir && (
    (dir === "long" && trend.direction === "bullish") ||
    (dir === "short" && trend.direction === "bearish")
  );
  const lvlStrength = breakout?.strength
    ?? (dir === "long" ? resistances[0]?.strength : supports[0]?.strength)
    ?? 0;
  const rr = tradeSetup?.rrRatio ?? 0;

  // Volume only scores when the data source actually reports it (Yahoo:
  // NASDAQ/Dow) — Twelve Data's forex/crypto feed (Gold, Bitcoin) has no
  // volume, so those instruments keep the original weights unchanged rather
  // than being scored against a fabricated "zero volume".
  const volPoints = !volume.hasData ? 0
    : volume.relativeVolume >= 1.4 ? 15
    : volume.relativeVolume >= 1.0 ? 10
    : volume.relativeVolume >= 0.6 ? 5
    : 0;

  const probFactors: ProbFactor[] = volume.hasData ? [
    { label: "Breakout confirmed", max: 22, points: breakout ? 22 : 0 },
    { label: "Trend aligned",      max: 18, points: trendAligned ? 18 : 0 },
    { label: "Volume",             max: 15, points: volPoints },
    { label: "Momentum",           max: 12, points: trend.momentum === "strong" ? 12 : trend.momentum === "moderate" ? 7 : 2 },
    { label: "Level strength",     max: 12, points: lvlStrength >= 4 ? 12 : lvlStrength === 3 ? 9 : lvlStrength === 2 ? 6 : lvlStrength === 1 ? 3 : 0 },
    { label: "Risk:Reward",        max: 12, points: rr >= 2 ? 12 : rr >= 1.5 ? 8 : rr >= 1 ? 5 : 2 },
    { label: "Session window",     max: 9,  points: timing.inSetupWindow ? 9 : 2 },
  ] : [
    { label: "Breakout confirmed", max: 25, points: breakout ? 25 : 0 },
    { label: "Trend aligned",      max: 20, points: trendAligned ? 20 : 0 },
    { label: "Momentum",           max: 15, points: trend.momentum === "strong" ? 15 : trend.momentum === "moderate" ? 9 : 3 },
    { label: "Level strength",     max: 15, points: lvlStrength >= 4 ? 15 : lvlStrength === 3 ? 12 : lvlStrength === 2 ? 8 : lvlStrength === 1 ? 4 : 0 },
    { label: "Risk:Reward",        max: 15, points: rr >= 2 ? 15 : rr >= 1.5 ? 10 : rr >= 1 ? 6 : 2 },
    { label: "Session window",     max: 10, points: timing.inSetupWindow ? 10 : 2 },
  ];
  // ── Warnings & penalties: the context the raw score can't see ────────────
  const warnings: Warning[] = [];
  const penalties: ProbFactor[] = [];
  // 30 minutes on 1min candles — was "2 hours" back when this ran on 5min
  // bars; scalping cares about the range that's actually relevant right now.
  const recentRange = candles.slice(-30);
  const hiRecent = Math.max(...recentRange.map(c => c.high));
  const loRecent = Math.min(...recentRange.map(c => c.low));

  // Whipsaw: the breakout level was crossed in BOTH directions in the 15
  // minutes BEFORE this breakout — price was already chopping across it
  // before this attempt, a real "this level doesn't hold" signal. Only
  // candles BEFORE the breakout count: a legitimate retest AFTER the
  // breakout is a single opposite-direction cross too, and it's exactly
  // what breakout+retest is built to trade — counting it here used to flag
  // a clean, textbook setup's own retest as "chop" and could tank it below
  // the probability floor for doing exactly what it was supposed to do.
  if (breakout) {
    const breakoutIdx = candles.findIndex(c => c.time === breakout.breakoutTime);
    const w = breakoutIdx > 0 ? candles.slice(Math.max(0, breakoutIdx - 15), breakoutIdx) : [];
    let up = 0, down = 0;
    for (let i = 1; i < w.length; i++) {
      if (w[i - 1].close < breakout.level && w[i].close > breakout.level) up++;
      if (w[i - 1].close > breakout.level && w[i].close < breakout.level) down++;
    }
    if (up >= 1 && down >= 1) {
      warnings.push({
        severity: "high",
        title: "Whipsaw at the level",
        detail: `${fmtPrice(breakout.level)} broke in BOTH directions in the 15 min before this break — breakouts here were already eating each other alive. Classic range noise.`,
      });
      penalties.push({ label: "Whipsaw at level", points: -20, max: 0 });
    }

    // Wick rejection: the break candle's opposing wick fought the move off
    // within the same bar — a weaker break than a clean close through the level.
    const rejection = wickRejectionRatio(candles, breakout);
    if (rejection > 0.5) {
      const dirTxt = breakout.direction === "long" ? "upper" : "lower";
      warnings.push({
        severity: rejection > 1 ? "high" : "medium",
        title: "Breakout candle got rejected",
        detail: `The break candle closed with a long ${dirTxt} wick (${Math.round(rejection * 100)}% of the body) — the move got fought off within the same bar. Weak breaks like this often fail the retest.`,
      });
      penalties.push({ label: "Wick rejection", points: -Math.round(Math.min(rejection, 2) * 8), max: 0 });
    }
  }

  // Thin volume: real participation is running well below its recent
  // baseline — a breakout on thin volume often lacks the conviction to
  // survive a retest, so this is worth surfacing loudly.
  if (volume.hasData && volume.relativeVolume < 0.6) {
    warnings.push({
      severity: "high",
      title: "Low volume",
      detail: `Current volume is ~${Math.round(volume.relativeVolume * 100)}% of the recent average — little real participation behind the move. Breakouts with this profile tend to fail the retest. Think twice before entering.`,
    });
    penalties.push({ label: "Low volume", points: -12, max: 0 });
  }

  // Dead momentum: abrupt candles with no follow-through. Unlike every other
  // warning here, this one has no adjacent `penalties.push(...)` — it's
  // enforced further down instead, via the weak-momentum score cap (search
  // "Weak-momentum cap"), which is a stronger check than a flat point
  // deduction would be (it caps the *ceiling*, not just the raw sum).
  if (trend.momentum === "weak") {
    warnings.push({
      severity: "high",
      title: "Dead momentum",
      detail: `Only ${fmtPct(Math.abs(trend.changeRecent))} movement in the last 15 min. Every sharp candle is reverting — breakouts lack follow-through.`,
    });
  }

  // Range-bound: recent range too small relative to the SL
  const rangeRecent = hiRecent - loRecent;
  if (rangeRecent < slPoints * 3) {
    warnings.push({
      severity: "medium",
      title: "Range-bound market",
      detail: `The last 30 min range is only ${fmtPrice(rangeRecent)} pts vs your ${slPoints} pt SL. Normal chop can tag your stop without a real move.`,
    });
    penalties.push({ label: "Range-bound tape", points: -10, max: 0 });
  }

  // Volatility collapsed relative to THIS instrument's own recent average —
  // different from range-bound above (that's a fixed range-vs-SL check; this
  // catches a market that's gone quieter than its own normal, even one that's
  // always tight). Ported from nyao_scalper_mt5's dead-market ATR filter.
  const MIN_VOL_RATIO = 0.6;
  if (volatilityRatio < MIN_VOL_RATIO) {
    warnings.push({
      severity: "high",
      title: "Volatility collapsed",
      detail: `Current volatility is ~${Math.round(volatilityRatio * 100)}% of this instrument's recent average — too quiet to scalp profitably right now. Costs eat the edge in dead air like this.`,
    });
    penalties.push({ label: "Dead volatility (ATR ratio)", points: -25, max: 0 });
  }

  // SL exposed: the stop sits inside the recent price range
  if (tradeSetup) {
    const slExposed = tradeSetup.direction === "short"
      ? tradeSetup.stopLoss <= hiRecent
      : tradeSetup.stopLoss >= loRecent;
    if (slExposed) {
      warnings.push({
        severity: "medium",
        title: "SL inside the recent range",
        detail: `Your stop at ${fmtPrice(tradeSetup.stopLoss)} sits inside the last 30 min range (${fmtPrice(loRecent)}–${fmtPrice(hiRecent)}). A normal whipsaw can take it out.`,
      });
      penalties.push({ label: "SL exposed to chop", points: -10, max: 0 });
    }
  }

  // Thin session for 24h markets (gold outside London/NY hours)
  if (is24h) {
    const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const h = etNow.getHours();
    if (h >= 16 || h < 3) {
      warnings.push({
        severity: "medium",
        title: "Thin session",
        detail: "NY is closed — Asian hours mean thinner liquidity and choppier moves. Levels get pierced without conviction.",
      });
      penalties.push({ label: "Thin session", points: -8, max: 0 });
    }
  }

  let probability = probFactors.reduce((s, f) => s + f.points, 0)
    + penalties.reduce((s, p) => s + p.points, 0);

  // Weak momentum caps the score — a breakout without fuel can't be high probability
  if (trend.momentum === "weak" && probability > 60) {
    penalties.push({ label: "Weak-momentum cap", points: 60 - probability, max: 0 });
    probability = 60;
  }

  // Keep probFactors+penalties summing to exactly what's displayed/sent —
  // otherwise a maxed-out breakdown could show 100 while the headline score
  // reads 92 (or a heavily-penalized one sums below 5 while the score floors
  // at 5). That silent gap is what the AI second-opinion sees too, since
  // it's handed this same breakdown as source of truth.
  const clamped = Math.max(5, Math.min(92, probability));
  if (clamped !== probability) {
    penalties.push({ label: "Score range clamp", points: clamped - probability, max: 0 });
  }
  probability = clamped;

  // Signal and probability used to be able to flatly contradict each other —
  // a real, trend-aligned breakout stacked with whipsaw/low-volume/range-bound
  // penalties could still show a confident "GO LONG" next to a 5% score. If
  // the score can't back up the call, the call doesn't stand: downgrade to
  // WAIT rather than asserting a direction the number next to it disowns.
  const SIGNAL_PROBABILITY_FLOOR = 30;
  let downgraded = false;
  if (signal !== "WAIT" && probability < SIGNAL_PROBABILITY_FLOOR) {
    signal = "WAIT";
    downgraded = true;
  }

  let message: string;
  if (breakout && breakoutAligned && downgraded) {
    const dirTxt = breakout.direction === "long" ? "up" : "down";
    message = `Level ${fmtPrice(breakout.level)} broke ${dirTxt} with the trend behind it, but the setup itself is weak — only ${probability}% once volume, momentum, and range get weighed in. Too much stacked against it to call this a real trade. Let it go, wait for a cleaner one.`;
  } else if (breakout && breakoutAligned) {
    const dirTxt = breakout.direction === "long" ? "up" : "down";
    message = `Level ${fmtPrice(breakout.level)} broke ${dirTxt} with the trend behind it. Now comes the part that separates the pros: wait for the retest. If price comes back to ${fmtPrice(breakout.level)} and respects it with a confirmation candle — that's your trade. No retest, no entry.`;
  } else if (breakout && !breakoutAligned) {
    const dirTxt = breakout.direction === "long" ? "up" : "down";
    message = `Careful: level ${fmtPrice(breakout.level)} broke ${dirTxt}, but the trend is ${trend.direction} — it's against you. Counter-trend breakouts are usually traps. Stay out unless the retest shows very strong confirmation. Protecting capital is a trade too.`;
  } else {
    const arr = MESSAGES[signal];
    message = arr[Math.floor(Math.random() * arr.length)](msgData);
  }

  return {
    signal,
    message,
    levels,
    trend,
    currentPrice,
    priceChange,
    priceChangePct,
    tradeSetup,
    breakout,
    volume,
    volatilityRatio,
    probability,
    probFactors,
    penalties,
    warnings,
    is24h,
    ...timing,
  };
}
