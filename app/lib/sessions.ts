import type { MarketKey } from "./markets";

// Per-market session intelligence — built for exactly the 4 instruments this
// app tracks (NASDAQ, Dow, Gold, Bitcoin), not a generic "world markets"
// clock. Everything here is judged in US Eastern time, same reference the
// rest of the app already uses for market timing (see getMarketTiming() in
// analysis.ts and Clock in BobbyPanel.tsx) — keeping one clock convention
// everywhere avoids two components disagreeing about what time it "really" is.
export type SessionQuality = "good" | "warn" | "muted";

export interface SessionInfo {
  label: string;
  quality: SessionQuality;
  note: string;
  nextLabel: string; // "" when there's nothing meaningful to count down to
}

const QUALITY_COLOR: Record<SessionQuality, string> = {
  good: "#1c7d4c",
  warn: "#f2f5f8",
  muted: "#9ba5b2",
};

export function sessionColor(q: SessionQuality): string {
  return QUALITY_COLOR[q];
}

function etNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function fmtMins(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

// ─── NASDAQ / Dow — US index session phases ──────────────────────────────
function usIndexSession(): SessionInfo {
  const et = etNow();
  const day = et.getDay();
  const min = et.getHours() * 60 + et.getMinutes();
  const PRE = 4 * 60, OPEN = 9 * 60 + 30, CLOSE = 16 * 60, AH_END = 20 * 60;

  if (day === 0 || day === 6) {
    return { label: "WEEKEND — CLOSED", quality: "muted", note: "US markets are shut. Nothing to trade here until Monday's pre-market.", nextLabel: "" };
  }
  if (min < PRE) {
    return { label: "CLOSED — OVERNIGHT", quality: "muted", note: "Pre-market opens at 4:00 AM ET.", nextLabel: `Pre-market in ${fmtMins(PRE - min)}` };
  }
  if (min < OPEN) {
    return { label: "PRE-MARKET", quality: "warn", note: "Thin liquidity, wide spreads — moves here often reverse right at the open. Not the setup window.", nextLabel: `Open in ${fmtMins(OPEN - min)}` };
  }
  if (min < CLOSE) {
    return { label: "REGULAR SESSION", quality: "good", note: "Full liquidity — this is the window the strategy is actually built for.", nextLabel: `Close in ${fmtMins(CLOSE - min)}` };
  }
  if (min < AH_END) {
    return { label: "AFTER-HOURS", quality: "warn", note: "Thin again — earnings-driven gaps happen here, this isn't the strategy's window.", nextLabel: `Ends in ${fmtMins(AH_END - min)}` };
  }
  return { label: "CLOSED — OVERNIGHT", quality: "muted", note: "Pre-market reopens at 4:00 AM ET.", nextLabel: `Pre-market in ${fmtMins(24 * 60 - min + PRE)}` };
}

// ─── Gold — Asian / London / New York, matches analysis.ts's own
//     "thin session" cutoff (16:00–03:00 ET) so the two never disagree. ──
function goldSession(): SessionInfo {
  const et = etNow();
  const min = et.getHours() * 60 + et.getMinutes();
  const LONDON_OPEN = 3 * 60, NY_OPEN = 8 * 60, LONDON_CLOSE = 12 * 60, NY_CLOSE = 16 * 60;

  if (min >= NY_OPEN && min < LONDON_CLOSE) {
    return { label: "LONDON / NY OVERLAP", quality: "good", note: "The two biggest gold sessions are both open — this is the highest-liquidity window of the day.", nextLabel: `Overlap ends in ${fmtMins(LONDON_CLOSE - min)}` };
  }
  if (min >= LONDON_OPEN && min < NY_CLOSE) {
    const nextEnd = min < NY_OPEN ? NY_OPEN : NY_CLOSE;
    const nextTxt = min < NY_OPEN ? `NY joins in ${fmtMins(nextEnd - min)}` : `NY closes in ${fmtMins(nextEnd - min)}`;
    return { label: "LONDON / NY SESSION", quality: "good", note: "Real liquidity behind moves — one of London or NY is active.", nextLabel: nextTxt };
  }
  // 16:00–03:00 ET — same window analysis.ts flags as "Volatility collapsed" territory
  const untilLondon = min >= LONDON_OPEN ? (24 * 60 - min) + LONDON_OPEN : LONDON_OPEN - min;
  return { label: "ASIAN SESSION — THIN", quality: "warn", note: "Outside London/NY hours — costs eat the edge here, this is the app's own \"thin session\" warning window.", nextLabel: `London opens in ${fmtMins(untilLondon)}` };
}

// ─── Bitcoin — always open, but weekend liquidity genuinely thins out and
//     the CME futures gap (closed Fri ~5pm ET → Sun ~6pm ET) is a real,
//     widely-watched phenomenon: spot often "fills the gap" left behind. ──
function bitcoinSession(): SessionInfo {
  const et = etNow();
  const day = et.getDay();
  const min = et.getHours() * 60 + et.getMinutes();
  const FRI_CME_CLOSE = 17 * 60, SUN_CME_OPEN = 18 * 60;

  const inCmeGap = (day === 6) || (day === 0 && min < SUN_CME_OPEN) || (day === 5 && min >= FRI_CME_CLOSE);
  if (inCmeGap) {
    const minutesToReopen = day === 5
      ? (24 * 60 - min) + 24 * 60 + SUN_CME_OPEN
      : day === 6
        ? (24 * 60 - min) + SUN_CME_OPEN
        : SUN_CME_OPEN - min;
    return {
      label: "WEEKEND — CME GAP OPEN",
      quality: "warn",
      note: "CME Bitcoin futures are closed. Spot keeps trading but institutional liquidity is thinner, and any move now often gets \"filled\" (retraced) once futures reopen.",
      nextLabel: `CME reopens in ${fmtMins(minutesToReopen)}`,
    };
  }
  return {
    label: "24/7 — ACTIVE",
    quality: "good",
    note: "No formal session, but liquidity is deepest while CME futures + the US equity session overlap.",
    nextLabel: "",
  };
}

export function getSessionInfo(market: MarketKey): SessionInfo {
  switch (market) {
    case "nasdaq":
    case "dowjones":
      return usIndexSession();
    case "gold":
      return goldSession();
    case "bitcoin":
      return bitcoinSession();
  }
}
