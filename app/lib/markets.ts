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
    color: "#00b868",
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
    color: "#c9a838",
  },
  sp500: {
    symbol: "^GSPC",
    tdSymbol: "SPX",
    label: "S&P 500",
    short: "US500",
    description: "S&P 500 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 40,
    slLabel: "40 pts",
    contractSize: 1,
    color: "#8468c9",
  },
} as const;

export type MarketKey = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[MarketKey];

// Lot size so that hitting the SL loses exactly the risk amount
export function lotsFor(market: Market): number {
  return ACCOUNT.riskPerTrade / (market.slPoints * market.contractSize);
}
