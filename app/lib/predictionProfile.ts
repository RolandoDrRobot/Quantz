// Derived, bounded-size view over the automatic prediction log — built for
// the AI second-opinion payload (and mirrored in the UI). Unlike the old
// trader-behavior profile this replaces, this is about the ENGINE's own call
// accuracy (hit rate by market, by probability band), not the trader's
// psychology — there's no more manual journal to derive that from.
import { loadPredictions, computePredictionStats, type PredictionRecord } from "./predictions";

const MIN_SAMPLE = 2; // a single call is noise, not a pattern

export interface MarketBreakdown { market: string; count: number; hitRate: number }
export type ProbabilityBand = "LOW" | "MEDIUM" | "HIGH";
export interface ProbabilityBandBreakdown { band: ProbabilityBand; count: number; hitRate: number }
export interface RecentOutcome {
  market: string;
  direction: "long" | "short";
  outcome: PredictionRecord["outcome"]; // never PENDING — filtered out
  probability: number;
}

export interface PredictionProfileSummary {
  hasHistory: boolean;
  totalPredictions: number;
  resolvedCount: number;
  hitRate: number;
  invalidatedRate: number;
  byMarket: MarketBreakdown[];
  byProbabilityBand: ProbabilityBandBreakdown[];
  recentOutcomes: RecentOutcome[];
}

export const EMPTY_PROFILE: PredictionProfileSummary = {
  hasHistory: false, totalPredictions: 0, resolvedCount: 0, hitRate: 0, invalidatedRate: 0,
  byMarket: [], byProbabilityBand: [], recentOutcomes: [],
};

// Same cuts as probLabel() in BobbyPanel.tsx — the AI's framing should never
// diverge from what the probability ring itself shows.
function bandOf(probability: number): ProbabilityBand {
  if (probability >= 70) return "HIGH";
  if (probability >= 45) return "MEDIUM";
  return "LOW";
}

function hitRateOf(rs: PredictionRecord[]): number {
  const tp = rs.filter(r => r.outcome === "TP_HIT").length;
  const sl = rs.filter(r => r.outcome === "SL_HIT").length;
  const played = tp + sl;
  return played > 0 ? Math.round((tp / played) * 100) : 0;
}

export function computePredictionProfile(records: PredictionRecord[]): PredictionProfileSummary {
  if (records.length === 0) return EMPTY_PROFILE;
  const stats = computePredictionStats(records);

  const resolved = records.filter(r => r.outcome !== "PENDING");
  const played = records.filter(r => r.outcome === "TP_HIT" || r.outcome === "SL_HIT");

  const markets = [...new Set(played.map(r => r.market))];
  const byMarket: MarketBreakdown[] = markets
    .map(market => {
      const rs = played.filter(r => r.market === market);
      return rs.length >= MIN_SAMPLE ? { market, count: rs.length, hitRate: hitRateOf(rs) } : null;
    })
    .filter((m): m is MarketBreakdown => m !== null);

  const bands: ProbabilityBand[] = ["LOW", "MEDIUM", "HIGH"];
  const byProbabilityBand: ProbabilityBandBreakdown[] = bands
    .map(band => {
      const rs = played.filter(r => bandOf(r.probability) === band);
      return rs.length >= MIN_SAMPLE ? { band, count: rs.length, hitRate: hitRateOf(rs) } : null;
    })
    .filter((b): b is ProbabilityBandBreakdown => b !== null);

  const recentOutcomes: RecentOutcome[] = resolved // already newest-first
    .slice(0, 5)
    .map(r => ({ market: r.market, direction: r.direction, outcome: r.outcome, probability: r.probability }));

  return {
    hasHistory: true,
    totalPredictions: stats.total,
    resolvedCount: stats.resolved,
    hitRate: Math.round(stats.hitRate),
    invalidatedRate: Math.round(stats.invalidatedRate),
    byMarket,
    byProbabilityBand,
    recentOutcomes,
  };
}

// The function callers actually use. Wrapped in its own try/catch — on top
// of loadPredictions() already self-guarding — so a corrupted localStorage
// entry degrades to EMPTY_PROFILE instead of throwing into analyze()/fetchAiTake.
export function buildPredictionProfileSummary(): PredictionProfileSummary {
  try {
    return computePredictionProfile(loadPredictions());
  } catch {
    return EMPTY_PROFILE;
  }
}
