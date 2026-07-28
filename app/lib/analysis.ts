import { RawCandle } from "../api/market/route";

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
  change1h: number;
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

export function findLevels(candles: RawCandle[], currentPrice: number): Level[] {
  if (candles.length < 10) return [];

  // Use only the last 500 candles (~2 weeks on 5min) for level detection
  const slice = candles.slice(-500);
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

  return clusters
    .filter(c => {
      const dist = Math.abs(c.price - currentPrice) / currentPrice;
      return dist > 0.0003 && dist < 0.025;
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 12)
    .map(({ price, type, strength }) => ({ price, type, strength }));
}

// ─── Trend ───────────────────────────────────────────────────────────────────

function detectTrend(candles: RawCandle[]): TrendInfo {
  const slice = candles.slice(-60); // last 5 hours of 5min candles
  if (slice.length < 20) return { direction: "neutral", momentum: "weak", ma20: 0, change1h: 0 };

  const ma20 = slice.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const current = slice[slice.length - 1].close;
  const oneHourAgo = slice[Math.max(0, slice.length - 12)].close;
  const change1h = ((current - oneHourAgo) / oneHourAgo) * 100;

  const direction = current > ma20 ? "bullish" : current < ma20 ? "bearish" : "neutral";
  const abs = Math.abs(change1h);
  const momentum = abs > 0.5 ? "strong" : abs > 0.15 ? "moderate" : "weak";

  return { direction, momentum, ma20, change1h };
}

// ─── Breakout Detection ──────────────────────────────────────────────────────

function detectBreakout(candles: RawCandle[], levels: Level[], slPoints: number): BreakoutEvent | null {
  if (candles.length < 15) return null;

  // Look only at last 24 candles (2 hours) — stale breakouts don't matter
  const window = candles.slice(-24);
  const retestZone = slPoints * 0.25; // retest = price within 1/4 SL of the level
  const failDist  = slPoints * 0.75; // close beyond this against the break = failed breakout

  for (let i = window.length - 1; i >= 2; i--) {
    const curr = window[i];
    const prev = window[i - 1];

    // Candle must have a real body (not a doji)
    const bodySize = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0 || bodySize / range < 0.45 || bodySize / curr.close < 0.0006) continue;

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
      if (failed) return null;

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
  let takeProfit: number;
  if (direction === "long") {
    const next = resistances.find(r => r.price >= entryPrice + slPoints * 1.5);
    takeProfit = next?.price ?? entryPrice + slPoints * 2;
  } else {
    const next = supports.find(s => s.price <= entryPrice - slPoints * 1.5);
    takeProfit = next?.price ?? entryPrice - slPoints * 2;
  }

  const tpPoints = Math.abs(takeProfit - entryPrice);
  const rrRatio = parseFloat((tpPoints / slPoints).toFixed(2));
  const rewardAmount = parseFloat((100 * rrRatio).toFixed(0));

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
    d => `${d.mkt} is ${d.chg} — tape is bullish, trading above the ${d.ma20} MA with ${d.mom} momentum. Key resistance: ${d.r1}${d.r1s ? ` (${d.r1s}x touches)` : ""}. That's your trigger level. Wait for a sharp break above it, watch for the retest to hold as support — that's your long entry. No retest, no trade.`,
    d => `Trend is up at ${d.chg}. Price above the 20 MA at ${d.ma20} with ${d.mom} conviction. You've got a wall at ${d.r1}. When that level breaks abrupto at the open and comes back to retest — you're in long. Not before. Let the market confirm.`,
    d => `${d.mkt} bulls are in control, ${d.chg} with ${d.mom} momentum. Watch resistance at ${d.r1}${d.r1s ? ` — it's been tested ${d.r1s} times, getting weaker` : ""}. Breakout + retest of that level is your green light to go long.`,
  ],
  GO_SHORT: [
    d => `${d.mkt} is ${d.chg} — bears are running this tape. Trading below the ${d.ma20} MA with ${d.mom} selling pressure. Key support: ${d.s1}${d.s1s ? ` (${d.s1s}x touches)` : ""}. When that floor cracks at the open and retests as resistance — you load short.`,
    d => `Trend is down at ${d.chg}. Price has broken below the 20 MA at ${d.ma20}. Critical support sits at ${d.s1}. The more it tests that level, the weaker it gets. Wait for the break, wait for the retest — then you short it and ride the flush.`,
    d => `${d.mom} downside momentum at ${d.chg}. Everything is pointing lower. Support at ${d.s1}${d.s1s ? ` has held ${d.s1s} times` : ""} — but it's running out of strength. When it breaks at the open with volume and retests — that's your short entry.`,
  ],
  WAIT: [
    d => `Market's at ${d.chg} — no edge right now. ${d.r1 ? `Resistance at ${d.r1}` : "No clear resistance nearby"}. ${d.s1 ? `Support at ${d.s1}.` : ""} Momentum is ${d.mom} and trend is mixed. Don't force a trade. The setup window is 30 minutes — either you get a clean break with retest, or you walk.`,
    d => `Choppy tape at ${d.chg} with ${d.mom} momentum. Structure is unclear. You've got levels on the chart but no directional conviction. Let the first 15 minutes of the open tell you the story before you commit. Patience is the edge.`,
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
  const chg = `${priceChange >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%`;

  const levels = findLevels(candles, currentPrice);
  const trend  = detectTrend(candles);
  const timing = getMarketTiming(is24h);

  const resistances = levels.filter(l => l.type === "resistance").sort((a, b) => a.price - b.price);
  const supports    = levels.filter(l => l.type === "support").sort((a, b) => b.price - a.price);

  const r1 = resistances[0]?.price.toFixed(2) ?? null;
  const r1s = resistances[0]?.strength ?? null;
  const s1 = supports[0]?.price.toFixed(2) ?? null;
  const s1s = supports[0]?.strength ?? null;

  const msgData = { chg, r1, r1s, s1, s1s, ma20: trend.ma20.toFixed(2), mom: trend.momentum, mkt: marketLabel };

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

  let message: string;
  if (breakout && breakoutAligned) {
    const dirTxt = breakout.direction === "long" ? "to the upside" : "to the downside";
    message = `Level ${breakout.level.toFixed(2)} broken ${dirTxt} with the trend behind it. Now comes the part that separates the pros: wait for the retest. If price comes back to ${breakout.level.toFixed(2)} and respects it with a confirmation candle — that's your trade. No retest, no entry.`;
  } else if (breakout && !breakoutAligned) {
    const dirTxt = breakout.direction === "long" ? "to the upside" : "to the downside";
    message = `Heads up: level ${breakout.level.toFixed(2)} broke ${dirTxt}, but the trend is ${trend.direction} — it's against you. Counter-trend breakouts are usually traps. Stay out unless the retest shows very strong confirmation. Protecting capital is also a trade.`;
  } else {
    const arr = MESSAGES[signal];
    message = arr[Math.floor(Math.random() * arr.length)](msgData);
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

  const probFactors: ProbFactor[] = [
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
  const recent2h = candles.slice(-24);
  const hi2h = Math.max(...recent2h.map(c => c.high));
  const lo2h = Math.min(...recent2h.map(c => c.low));

  // Whipsaw: the breakout level was crossed in BOTH directions in the last hour
  if (breakout) {
    const w = candles.slice(-12);
    let up = 0, down = 0;
    for (let i = 1; i < w.length; i++) {
      if (w[i - 1].close < breakout.level && w[i].close > breakout.level) up++;
      if (w[i - 1].close > breakout.level && w[i].close < breakout.level) down++;
    }
    if (up >= 1 && down >= 1) {
      warnings.push({
        severity: "high",
        title: "Whipsaw at the level",
        detail: `${breakout.level.toFixed(2)} broke in BOTH directions within the last hour — breakouts here are eating each other. Classic range noise.`,
      });
      penalties.push({ label: "Whipsaw at level", points: -20, max: 0 });
    }
  }

  // Dead momentum: abrupt candles with no follow-through
  if (trend.momentum === "weak") {
    warnings.push({
      severity: "high",
      title: "Dead momentum",
      detail: `Only ${trend.change1h.toFixed(2)}% move in the last hour. Each abrupt candle is getting reversed — breakouts lack follow-through.`,
    });
  }

  // Range-bound: 2h range too small relative to the SL
  const range2h = hi2h - lo2h;
  if (range2h < slPoints * 3) {
    warnings.push({
      severity: "medium",
      title: "Range-bound market",
      detail: `The 2h range is only ${range2h.toFixed(2)} pts vs your ${slPoints}-pt SL. Normal chop can hit your stop without a real move.`,
    });
    penalties.push({ label: "Range-bound tape", points: -10, max: 0 });
  }

  // SL exposed: the stop sits inside the recent price range
  if (tradeSetup) {
    const slExposed = tradeSetup.direction === "short"
      ? tradeSetup.stopLoss <= hi2h
      : tradeSetup.stopLoss >= lo2h;
    if (slExposed) {
      warnings.push({
        severity: "medium",
        title: "SL inside recent range",
        detail: `Your stop at ${tradeSetup.stopLoss.toFixed(2)} sits inside the last 2h range (${lo2h.toFixed(2)}–${hi2h.toFixed(2)}). A normal whipsaw can take it out.`,
      });
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
        detail: "NY is closed — Asian hours mean lower liquidity and choppier moves. Levels get pierced without conviction.",
      });
      penalties.push({ label: "Thin session", points: -8, max: 0 });
    }
  }

  let probability = probFactors.reduce((s, f) => s + f.points, 0)
    + penalties.reduce((s, p) => s + p.points, 0);

  // Weak momentum caps the score — a breakout without fuel can't be high probability
  if (trend.momentum === "weak" && probability > 60) {
    penalties.push({ label: "Weak momentum cap", points: 60 - probability, max: 0 });
    probability = 60;
  }
  probability = Math.max(5, Math.min(92, probability));

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
    probability,
    probFactors,
    penalties,
    warnings,
    is24h,
    ...timing,
  };
}
