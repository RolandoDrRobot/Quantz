// FTMO-style account settings — reflected across the whole app
export const ACCOUNT = {
  balance: 1000,
  riskPerTrade: 25,
};

export const MARKETS = {
  nasdaq: {
    symbol: "^NDX",
    tdSymbol: "NDX",
    binanceSymbol: null,
    label: "NASDAQ 100",
    short: "US100",
    description: "NASDAQ 100 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 20,
    slLabel: "20 pts",
    contractSize: 1,
    spreadPoints: 2.0,
    color: "#1f9d5c",
  },
  dowjones: {
    symbol: "^DJI",
    tdSymbol: "DJI",
    binanceSymbol: null,
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
    tdSymbol: "XAU/USD",
    binanceSymbol: null,
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
    // Twelve Data's free tier never reports volume for crypto — Binance's
    // public REST/WS API is free, needs no key, and gives real price +
    // volume for both history and the live tick stream, so Bitcoin sources
    // everything from Binance instead.
    binanceSymbol: "BTCUSDT",
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
    binanceSymbol: "ETHUSDT",
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
