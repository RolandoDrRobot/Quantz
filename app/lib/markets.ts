// FTMO-style account settings — reflected across the whole app
export const ACCOUNT = {
  balance: 1000,
  // Trimmed from 25 alongside the loosened thresholds in analysis.ts (see
  // SIGNAL_PROBABILITY_FLOOR and the breakout body-size filter) — more setups
  // now clear the bar, so risk-per-trade comes down proportionally to keep
  // total exposure roughly where it was rather than compounding with the
  // higher trade frequency. Same lever a risk desk pulls before loosening
  // entry criteria: size down first, then widen the funnel.
  riskPerTrade: 18,
};

export const MARKETS = {
  nasdaq: {
    symbol: "^NDX",
    tdSymbol: "NDX",
    coinbaseProduct: null,
    label: "NASDAQ 100",
    short: "US100",
    description: "NASDAQ 100 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 20,
    slLabel: "20 pts",
    contractSize: 1,
    spreadPoints: 2.0,
    color: "#1c7d4c",
  },
  dowjones: {
    symbol: "^DJI",
    tdSymbol: "DJI",
    coinbaseProduct: null,
    label: "Dow Jones",
    short: "US30",
    description: "Dow Jones · 7:30 AM CR Open",
    is24h: false,
    slPoints: 20,
    slLabel: "20 pts",
    contractSize: 1,
    spreadPoints: 2.5,
    color: "#3a72c9",
  },
  gold: {
    symbol: "GC=F",
    // Twelve Data's free-tier XAU/USD feed (candles + WS) was found frozen
    // for 40+ minutes at a time, $50+ stale vs. the real spot price — that's
    // what was painting broken candles. Gold now sources candles from Yahoo's
    // GC=F futures (same reliable path as NASDAQ/Dow) and polls /api/tick for
    // its live price instead of a WebSocket (see AxeChart.tsx).
    tdSymbol: null,
    coinbaseProduct: null,
    label: "Gold",
    short: "XAUUSD",
    description: "Gold · 23h/day · Asian Session",
    is24h: true,
    slPoints: 2,
    slLabel: "20 pips ($2.00)",
    contractSize: 100,
    spreadPoints: 0.15,
    color: "#c9a838",
  },
  bitcoin: {
    symbol: "BTC-USD",
    tdSymbol: "BTC/USD",
    // Twelve Data's free tier never reports volume for crypto, and Binance
    // blocks requests from US-based servers — Coinbase Exchange is US-
    // compliant (doesn't block Vercel), free, needs no key, and gives real
    // price + volume for both history and the live tick stream.
    coinbaseProduct: "BTC-USD",
    label: "Bitcoin",
    short: "BTCUSD",
    description: "Bitcoin · 24/7",
    is24h: true,
    slPoints: 75,
    slLabel: "$75",
    contractSize: 1,
    spreadPoints: 20,
    color: "#f7931a",
  },
} as const;

export type MarketKey = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[MarketKey];

// Lot size so that hitting the SL loses exactly the risk amount
export function lotsFor(market: Market): number {
  return ACCOUNT.riskPerTrade / (market.slPoints * market.contractSize);
}

// Estimated Exness round-trip cost in dollars (spread crossed at entry),
// scaled by the position size implied by the fixed risk
export function tradeCostFor(market: Market): number {
  const perPoint = ACCOUNT.riskPerTrade / market.slPoints;
  return parseFloat((market.spreadPoints * perPoint).toFixed(2));
}
