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

function detectBreakout(candles: RawCandle[], levels: Level[]): BreakoutEvent | null {
  if (candles.length < 15) return null;

  // Look only at last 24 candles (2 hours) — stale breakouts don't matter
  const window = candles.slice(-24);

  for (let i = window.length - 1; i >= 2; i--) {
    const curr = window[i];
    const prev = window[i - 1];

    // Candle must have a real body (not a doji)
    const bodySize = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0 || bodySize / range < 0.45 || bodySize / curr.close < 0.0006) continue;

    for (const level of levels) {
      // Bullish breakout: prev closed below, curr opens below and closes above (pierces through)
      if (
        prev.close < level.price &&
        curr.close > level.price &&
        curr.open < level.price  // started below — not a gap
      ) {
        return { level: level.price, direction: "long", breakoutTime: curr.time, strength: level.strength };
      }

      // Bearish breakout: prev closed above, curr opens above and closes below
      if (
        prev.close > level.price &&
        curr.close < level.price &&
        curr.open > level.price  // started above — not a gap
      ) {
        return { level: level.price, direction: "short", breakoutTime: curr.time, strength: level.strength };
      }
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
  trendDirection: "bullish" | "bearish" | "neutral"
): TradeSetup | null {
  const resistances = levels.filter(l => l.type === "resistance").sort((a, b) => a.price - b.price);
  const supports    = levels.filter(l => l.type === "support").sort((a, b) => b.price - a.price);

  if (resistances.length === 0 && supports.length === 0) return null;

  // For WAIT, pick direction from trend; if neutral, pick nearest level
  let direction: "long" | "short";
  if (signal === "GO_LONG") {
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

  const entryPrice = direction === "long"
    ? (resistances[0]?.price ?? currentPrice)
    : (supports[0]?.price ?? currentPrice);

  const stopLoss = direction === "long" ? entryPrice - slPoints : entryPrice + slPoints;

  let takeProfit: number;
  if (direction === "long") {
    const next = resistances.find(r => r.price > entryPrice + slPoints * 0.5);
    takeProfit = next?.price ?? entryPrice + slPoints * 2;
  } else {
    const next = supports.find(s => s.price < entryPrice - slPoints * 0.5);
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

  // Signal based purely on technicals — no time gate
  let signal: Signal;
  if (trend.direction === "bullish" && trend.momentum !== "weak" && r1) {
    signal = "GO_LONG";
  } else if (trend.direction === "bearish" && trend.momentum !== "weak" && s1) {
    signal = "GO_SHORT";
  } else {
    signal = "WAIT";
  }

  const arr = MESSAGES[signal];
  const message = arr[Math.floor(Math.random() * arr.length)](msgData);
  const tradeSetup = calculateTradeSetup(signal, currentPrice, levels, slPoints, trend.direction);
  const breakout = detectBreakout(candles, levels);

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
    is24h,
    ...timing,
  };
}
