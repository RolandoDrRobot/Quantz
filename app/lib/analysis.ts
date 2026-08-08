import { RawCandle } from "../api/market/route";
import { ACCOUNT } from "./markets";

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
  volume: VolumeInfo;
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

// ─── Volume ──────────────────────────────────────────────────────────────────
// Yahoo (NASDAQ/Dow) reports real traded volume. Twelve Data's forex/crypto
// spot feed (Gold, Bitcoin) does not — every candle comes back with
// volume: 0. `hasData` distinguishes the two so we never score or warn on
// fabricated "zero volume" for an instrument that simply has no volume feed.
export interface VolumeInfo {
  hasData: boolean;
  relativeVolume: number; // recent activity vs baseline average; 1 = normal
}

function analyzeVolume(candles: RawCandle[]): VolumeInfo {
  const recent = candles.slice(-30);
  const hasData = recent.some(c => c.volume > 0);
  if (!hasData) return { hasData: false, relativeVolume: 1 };

  // Baseline = average volume over the hour before "now", current = last
  // 5 candles — relative volume answers "is there real participation behind
  // what's happening right now, or is this move on thin air?"
  const baseline = candles.slice(-60, -5);
  const baselineAvg = baseline.length > 0 ? baseline.reduce((s, c) => s + c.volume, 0) / baseline.length : 0;
  const current = candles.slice(-5);
  const currentAvg = current.length > 0 ? current.reduce((s, c) => s + c.volume, 0) / current.length : 0;

  const relativeVolume = baselineAvg > 0 ? currentAvg / baselineAvg : 1;
  return { hasData: true, relativeVolume };
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
      // This candle+level pierce already failed — keep scanning older
      // candles/other levels instead of abandoning the whole search, so a
      // still-valid earlier breakout isn't discarded because of it.
      if (failed) continue;

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
  const rewardAmount = parseFloat((ACCOUNT.riskPerTrade * rrRatio).toFixed(0));

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
    d => `${d.mkt} está ${d.chg} — tape es alcista, tradea arriba de la MA ${d.ma20} con momentum ${d.mom}. Resistencia clave: ${d.r1}${d.r1s ? ` (${d.r1s}x touches)` : ""}. Ese es tu nivel trigger. Espera un break abrupto arriba, vigila que el retest sostega como soporte — esa es tu entrada larga. Sin retest, sin trade.`,
    d => `Tendencia arriba en ${d.chg}. Precio arriba de la MA 20 en ${d.ma20} con ${d.mom} conviction. Tienes un muro en ${d.r1}. Cuando ese nivel se quiebra en el open y vuelve a testar — entras largo. No antes. Deja que el mercado confirme.`,
    d => `Los toros de ${d.mkt} están en control, ${d.chg} con momentum ${d.mom}. Vigila resistencia en ${d.r1}${d.r1s ? ` — ha sido testeada ${d.r1s} veces, se debilita` : ""}. Breakout + retest de ese nivel es tu luz verde para ir largo.`,
  ],
  GO_SHORT: [
    d => `${d.mkt} está ${d.chg} — los osos controlan el tape. Tradea abajo de la MA ${d.ma20} con ${d.mom} presión vendedora. Soporte clave: ${d.s1}${d.s1s ? ` (${d.s1s}x touches)` : ""}. Cuando ese piso se quiebra en el open y retesta como resistencia — cargas corto.`,
    d => `Tendencia abajo en ${d.chg}. Precio se quebró abajo de la MA 20 en ${d.ma20}. Soporte crítico en ${d.s1}. Cuanto más lo testee ese nivel, más se debilita. Espera el break, espera el retest — luego shorteen y monta el flush.`,
    d => `Momentum ${d.mom} bajista en ${d.chg}. Todo apunta más bajo. Soporte en ${d.s1}${d.s1s ? ` ha sostenido ${d.s1s} veces` : ""} — pero se le está acabando la fuerza. Cuando se quiebra en el open con volumen y retesta — esa es tu entrada corta.`,
  ],
  WAIT: [
    d => `Mercado en ${d.chg} — sin edge ahora. ${d.r1 ? `Resistencia en ${d.r1}` : "Sin resistencia clara"}. ${d.s1 ? `Soporte en ${d.s1}.` : ""} Momentum es ${d.mom} y tendencia es mixta. No fuerces un trade. La ventana de setup es 30 minutos — o consigues un break limpio con retest, o te vas.`,
    d => `Tape choppy en ${d.chg} con momentum ${d.mom}. Estructura unclear. Tienes niveles en el gráfico pero sin conviction direccional. Deja que los primeros 15 minutos del open te digan la historia antes de comprometerte. La paciencia es el edge.`,
    d => `${d.chg} — es un coin flip. ${d.r1 ? `Vigila ${d.r1} como resistencia` : ""}${d.r1 && d.s1 ? " y " : ""}${d.s1 ? `${d.s1} como soporte` : ""}. Espera un break decisivo de uno de esos niveles con volumen real. Si el retest confirma — toma el trade. Si no, siéntate con las manos quietas.`,
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
  const volume = analyzeVolume(candles);
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
    const dirTxt = breakout.direction === "long" ? "arriba" : "abajo";
    message = `Nivel ${breakout.level.toFixed(2)} quebrado ${dirTxt} con la tendencia detrás. Ahora viene la parte que separa los pros: espera el retest. Si el precio vuelve a ${breakout.level.toFixed(2)} y lo respeta con una vela de confirmación — ese es tu trade. Sin retest, sin entrada.`;
  } else if (breakout && !breakoutAligned) {
    const dirTxt = breakout.direction === "long" ? "arriba" : "abajo";
    message = `Cuidado: nivel ${breakout.level.toFixed(2)} se quebró ${dirTxt}, pero la tendencia es ${trend.direction} — está en contra tuyo. Los breakouts contra-tendencia usualmente son traps. Mantente fuera a menos que el retest muestre confirmación muy fuerte. Proteger capital también es un trade.`;
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

  // Volume only scores when the data source actually reports it (Yahoo:
  // NASDAQ/Dow) — Twelve Data's forex/crypto feed (Gold, Bitcoin) has no
  // volume, so those instruments keep the original weights unchanged rather
  // than being scored against a fabricated "zero volume".
  const volPoints = !volume.hasData ? 0
    : volume.relativeVolume >= 1.4 ? 15
    : volume.relativeVolume >= 1.0 ? 10
    : volume.relativeVolume >= 0.6 ? 5
    : 0;

  const probFactors: ProbFactor[] = volume.hasData ? [
    { label: "Breakout confirmado", max: 22, points: breakout ? 22 : 0 },
    { label: "Tendencia alineada",      max: 18, points: trendAligned ? 18 : 0 },
    { label: "Volumen",            max: 15, points: volPoints },
    { label: "Momentum",           max: 12, points: trend.momentum === "strong" ? 12 : trend.momentum === "moderate" ? 7 : 2 },
    { label: "Fuerza del nivel",     max: 12, points: lvlStrength >= 4 ? 12 : lvlStrength === 3 ? 9 : lvlStrength === 2 ? 6 : lvlStrength === 1 ? 3 : 0 },
    { label: "Risk:Reward",        max: 12, points: rr >= 2 ? 12 : rr >= 1.5 ? 8 : rr >= 1 ? 5 : 2 },
    { label: "Ventana de sesión",     max: 9,  points: timing.inSetupWindow ? 9 : 2 },
  ] : [
    { label: "Breakout confirmado", max: 25, points: breakout ? 25 : 0 },
    { label: "Tendencia alineada",      max: 20, points: trendAligned ? 20 : 0 },
    { label: "Momentum",           max: 15, points: trend.momentum === "strong" ? 15 : trend.momentum === "moderate" ? 9 : 3 },
    { label: "Fuerza del nivel",     max: 15, points: lvlStrength >= 4 ? 15 : lvlStrength === 3 ? 12 : lvlStrength === 2 ? 8 : lvlStrength === 1 ? 4 : 0 },
    { label: "Risk:Reward",        max: 15, points: rr >= 2 ? 15 : rr >= 1.5 ? 10 : rr >= 1 ? 6 : 2 },
    { label: "Ventana de sesión",     max: 10, points: timing.inSetupWindow ? 10 : 2 },
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
        title: "Whipsaw en el nivel",
        detail: `${breakout.level.toFixed(2)} se quebró en AMBAS direcciones en la última hora — los breakouts aquí se comen unos a otros. Ruido de rango clásico.`,
      });
      penalties.push({ label: "Whipsaw en nivel", points: -20, max: 0 });
    }
  }

  // Thin volume: real participation is running well below its recent
  // baseline — a breakout on thin volume often lacks the conviction to
  // survive a retest, so this is worth surfacing loudly.
  if (volume.hasData && volume.relativeVolume < 0.6) {
    warnings.push({
      severity: "high",
      title: "Volumen bajo",
      detail: `Volumen actual es ~${Math.round(volume.relativeVolume * 100)}% del promedio reciente — poca participación real detrás del movimiento. Los breakouts con este perfil suelen fallar el retest. Piénsalo dos veces antes de entrar.`,
    });
    penalties.push({ label: "Volumen bajo", points: -12, max: 0 });
  }

  // Dead momentum: abrupt candles with no follow-through
  if (trend.momentum === "weak") {
    warnings.push({
      severity: "high",
      title: "Momentum muerto",
      detail: `Solo ${trend.change1h.toFixed(2)}% de movimiento en la última hora. Cada vela abrupta se está revirtiendo — los breakouts carecen de follow-through.`,
    });
  }

  // Range-bound: 2h range too small relative to the SL
  const range2h = hi2h - lo2h;
  if (range2h < slPoints * 3) {
    warnings.push({
      severity: "medium",
      title: "Mercado rango-limitado",
      detail: `El rango de 2h es solo ${range2h.toFixed(2)} pts vs tu SL de ${slPoints} pts. El chop normal puede tocar tu stop sin un movimiento real.`,
    });
    penalties.push({ label: "Tape rango-limitado", points: -10, max: 0 });
  }

  // SL exposed: the stop sits inside the recent price range
  if (tradeSetup) {
    const slExposed = tradeSetup.direction === "short"
      ? tradeSetup.stopLoss <= hi2h
      : tradeSetup.stopLoss >= lo2h;
    if (slExposed) {
      warnings.push({
        severity: "medium",
        title: "SL dentro del rango reciente",
        detail: `Tu stop en ${tradeSetup.stopLoss.toFixed(2)} está dentro del rango de últimas 2h (${lo2h.toFixed(2)}–${hi2h.toFixed(2)}). Un whipsaw normal puede sacarlo.`,
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
        title: "Sesión delgada",
        detail: "NY está cerrado — horas asiáticas significan menor liquidez y movimientos más chopy. Niveles se piersan sin conviction.",
      });
      penalties.push({ label: "Sesión delgada", points: -8, max: 0 });
    }
  }

  let probability = probFactors.reduce((s, f) => s + f.points, 0)
    + penalties.reduce((s, p) => s + p.points, 0);

  // Weak momentum caps the score — a breakout without fuel can't be high probability
  if (trend.momentum === "weak" && probability > 60) {
    penalties.push({ label: "Cap momentum débil", points: 60 - probability, max: 0 });
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
    volume,
    probability,
    probFactors,
    penalties,
    warnings,
    is24h,
    ...timing,
  };
}
