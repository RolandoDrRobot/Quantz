// Centralized number formatting — every price/dollar/percent/lot shown in the
// UI goes through here so thousands separators, decimal places, and sign
// conventions ("+"/"−", not "-") stay consistent everywhere instead of each
// component hand-rolling its own toFixed()/template-literal formatting.

const MINUS = "−"; // typographic minus, matches the rest of the app's convention

const number2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Only ever used for sub-$1 prices (e.g. the ETH/BTC ratio pair, ~0.03) —
// every other instrument's price is always well above 1, so this never
// changes their formatting. 2 decimals would round 0.029528 to "0.03",
// making every nearby level look identical.
const numberSmall = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const moneyWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sign(n: number): string {
  return n > 0 ? "+" : n < 0 ? MINUS : "";
}

// Price/level/points — 2 decimals, thousands-grouped. e.g. 29722.3 -> "29,722.30".
// Sub-$1 prices get up to 6 decimals instead, so a BTC-denominated pair
// like ETH/BTC still reads as a real, distinguishable price.
export function fmtPrice(n: number): string {
  return Math.abs(n) < 1 ? numberSmall.format(n) : number2.format(n);
}

// Percentage — 2 decimals, grouped. e.g. 1.2 -> "1.20%"
export function fmtPct(n: number): string {
  return `${number2.format(n)}%`;
}

// Signed percentage — "+1.23%" / "−0.50%"
export function fmtSignedPct(n: number): string {
  return `${sign(n)}${number2.format(Math.abs(n))}%`;
}

// Dollar amount, whole — "$1,234"
export function fmtMoney(n: number): string {
  return moneyWhole.format(n);
}

// Dollar amount, 2 decimals — "$1,234.56"
export function fmtMoney2(n: number): string {
  return money2.format(n);
}

// Signed dollar amount, whole — "+$1,234" / "−$500"
export function fmtSignedMoney(n: number): string {
  return `${sign(n)}${moneyWhole.format(Math.abs(n))}`;
}

// Lot size — 2 decimals, grouped
export function fmtLots(n: number): string {
  return number2.format(n);
}

// Unsigned ratio (R:R, profit factor) — 2 decimals, grouped
export function fmtRatio(n: number): string {
  return number2.format(n);
}

// Plain grouped integer — counts, whole percentages, etc. e.g. 12345 -> "12,345"
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
