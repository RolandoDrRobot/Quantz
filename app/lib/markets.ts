// FTMO-style account settings — reflected across the whole app
export const ACCOUNT = {
  balance: 1000,
  riskPerTrade: 25,
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
  ethereum: {
    symbol: "ETH-USD",
    tdSymbol: "ETH/USD",
    coinbaseProduct: "ETH-USD",
    label: "Ethereum",
    short: "ETHUSD",
    description: "Ethereum · 24/7",
    is24h: true,
    // Same SL-to-price ratio as Bitcoin (~0.13%) for a consistent scalping
    // feel across both crypto instruments — ETH trades far cheaper than BTC.
    slPoints: 2.5,
    slLabel: "$2.50",
    contractSize: 1,
    spreadPoints: 0.5,
    color: "#627eea",
  },
  ethbtc: {
    symbol: "ETH-BTC",
    tdSymbol: null,
    coinbaseProduct: "ETH-BTC",
    label: "Ethereum / Bitcoin",
    short: "ETHBTC",
    description: "ETH/BTC · 24/7",
    is24h: true,
    // Priced in BTC, not USD (~0.03), so slPoints/spreadPoints live on that
    // same tiny scale — 0.00005 BTC is roughly a $3 stop at today's BTC/USD
    // rate. contractSize converts that BTC-denominated distance into the
    // account's fixed USD risk (ACCOUNT.riskPerTrade), so it's pinned to
    // BTC/USD at the time this was set (~$65k) — if BTC's dollar price moves
    // a lot from there, the real dollar risk per trade drifts with it and
    // this should get re-tuned (same static-contractSize tradeoff Gold's
    // 100oz contractSize already makes, just more volatile here since BTC/USD
    // itself moves far more than gold/USD does).
    slPoints: 0.00005,
    slLabel: "0.00005 BTC (~$3)",
    contractSize: 65000,
    // Live Coinbase spread runs ~0.000006-0.000007 BTC; this keeps a bit of
    // retail-broker markup above that (same logic as every other market's
    // spreadPoints here) without being ~2x it like the original guess was.
    spreadPoints: 0.000008,
    color: "#22d3ee",
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
