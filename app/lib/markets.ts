// FTMO-style account settings — reflected across the whole app
export const ACCOUNT = {
  balance: 1000,
  riskPerTrade: 100,
};

export const MARKETS = {
  nasdaq: {
    symbol: "^NDX",
    tdSymbol: "NDX",
    label: "NASDAQ 100",
    short: "US100",
    description: "NASDAQ 100 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 40,
    slLabel: "40 pts",
    contractSize: 1,
    spreadPoints: 2.0,
    color: "#1f9d5c",
  },
  dowjones: {
    symbol: "^DJI",
    tdSymbol: "DJI",
    label: "Dow Jones",
    short: "US30",
    description: "Dow Jones · 7:30 AM CR Open",
    is24h: false,
    slPoints: 40,
    slLabel: "40 pts",
    contractSize: 1,
    spreadPoints: 2.5,
    color: "#3a72c9",
  },
  gold: {
    symbol: "GC=F",
    tdSymbol: "XAU/USD",
    label: "Gold",
    short: "XAUUSD",
    description: "Gold · 23h/day · Asian Session",
    is24h: true,
    slPoints: 4,
    slLabel: "40 pips ($4.00)",
    contractSize: 100,
    spreadPoints: 0.15,
    color: "#c9a838",
  },
  bitcoin: {
    symbol: "BTC-USD",
    tdSymbol: "BTC/USD",
    label: "Bitcoin",
    short: "BTCUSD",
    description: "Bitcoin · 24/7",
    is24h: true,
    slPoints: 150,
    slLabel: "$150",
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
