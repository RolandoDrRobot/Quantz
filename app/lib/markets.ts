export const MARKETS = {
  nasdaq: {
    symbol: "^NDX",
    tdSymbol: "NDX",
    label: "NASDAQ 100",
    short: "US100",
    description: "NASDAQ 100 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 30,
    color: "#00d26a",
  },
  dowjones: {
    symbol: "^DJI",
    tdSymbol: "DJI",
    label: "Dow Jones",
    short: "US30",
    description: "Dow Jones · 7:30 AM CR Open",
    is24h: false,
    slPoints: 30,
    color: "#3b82f6",
  },
  gold: {
    symbol: "GC=F",
    tdSymbol: "XAU/USD",
    label: "Gold",
    short: "XAUUSD",
    description: "Oro · 23h/día · Sesión Asiática",
    is24h: true,
    slPoints: 20,
    color: "#ffd700",
  },
  sp500: {
    symbol: "^GSPC",
    tdSymbol: "SPX",
    label: "S&P 500",
    short: "US500",
    description: "S&P 500 · 7:30 AM CR Open",
    is24h: false,
    slPoints: 30,
    color: "#a78bfa",
  },
} as const;

export type MarketKey = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[MarketKey];
