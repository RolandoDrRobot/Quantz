import type { Opportunity } from "./opportunity";
import type { AnalysisResult } from "./analysis";
import type { TradeRecord } from "./records";

export interface WendyAnalysis {
  verdict: "GREEN" | "YELLOW" | "RED";
  title: string;
  insights: string[];
  recommendation: string;
}

export function analyzeEmotions(
  opportunity: Opportunity | null,
  analysis: AnalysisResult | null,
  recentRecords: TradeRecord[],
  livePrice: number | null
): WendyAnalysis {
  const now = Date.now();
  const insights: string[] = [];
  let riskLevel = 0; // 0-10 scale: 0=green, 10=red

  // ── Check 1: Trade already passed? ──────────────────────────────────
  if (opportunity && opportunity.phase === "AWAIT_RETEST") {
    const timeSinceBreak = (now - opportunity.updatedAt) / 1000 / 60; // minutes
    if (timeSinceBreak > 30) {
      insights.push(`⏰ El breakout fue hace ${Math.round(timeSinceBreak)} minutos. El setup está viejo.`);
      riskLevel += 3;
    } else if (timeSinceBreak > 10) {
      insights.push(`⏰ El breakout fue hace ${Math.round(timeSinceBreak)} minutos. Aún no hay retest.`);
      riskLevel += 1;
    }
  }

  // ── Check 2: Chasing the move? ──────────────────────────────────────
  if (opportunity && livePrice !== null) {
    const distFromBreak = Math.abs(livePrice - opportunity.level);
    const slDist = opportunity.slPoints;
    const chaseFactor = distFromBreak / slDist;

    if (chaseFactor > 3) {
      insights.push(`🏃 Estás chaseando — el precio está ${chaseFactor.toFixed(1)}× tu SL lejos del nivel.`);
      riskLevel += 4;
    } else if (chaseFactor > 1.5) {
      insights.push(`📍 El precio ya corrió ${chaseFactor.toFixed(1)}× tu SL. La mejor parte pasó.`);
      riskLevel += 2;
    }
  }

  // ── Check 3: Revenge trading? ──────────────────────────────────────
  if (recentRecords.length > 0) {
    const lastTrade = recentRecords[0];
    const timeSinceLastTrade = (now - lastTrade.time) / 1000 / 60; // minutes

    if (lastTrade.pnl < 0 && timeSinceLastTrade < 5) {
      insights.push(`💔 Tu último trade perdió $${Math.abs(lastTrade.pnl).toFixed(0)} hace ${Math.round(timeSinceLastTrade)} min. Esto es venganza.`);
      riskLevel += 5;
    } else if (lastTrade.pnl < 0 && timeSinceLastTrade < 15) {
      insights.push(`🔥 SL hit hace ${Math.round(timeSinceLastTrade)} min. Respira antes del siguiente trade.`);
      riskLevel += 2;
    }
  }

  // ── Check 4: Over-trading? ─────────────────────────────────────────
  const last60min = recentRecords.filter(r => (now - r.time) / 1000 / 60 < 60);
  if (last60min.length >= 4) {
    insights.push(`⚡ Hiciste ${last60min.length} trades en la última hora. Estás sobre-tradiendo. Para.`);
    riskLevel += 3;
  } else if (last60min.length >= 3) {
    insights.push(`⚡ 3 trades en la última hora. ¿Buscas trades o los haces sin pensar?`);
    riskLevel += 1;
  }

  // ── Check 5: Win rate signal ───────────────────────────────────────
  if (recentRecords.length >= 3) {
    const last3 = recentRecords.slice(0, 3);
    const losses = last3.filter(r => r.pnl < 0).length;
    if (losses === 3) {
      insights.push(`📉 Estás 0/3 en los últimos 3 trades. PARA YA. No es sobre encontrar oportunidades.`);
      riskLevel += 5;
    } else if (losses === 2) {
      insights.push(`📉 2 pérdidas en los últimos 3 trades. Las probabilidades están en contra. Salte.`);
      riskLevel += 3;
    }
  }

  // ── Check 6: Probability mismatch ──────────────────────────────────
  if (analysis) {
    if (analysis.probability < 50 && opportunity?.phase !== "CONFIRMED") {
      insights.push(`⚠️ Bobby dice <50% probabilidad. Si tomas esto, ignoras la señal.`);
      riskLevel += 2;
    }
  }

  // ── Check 7: Optimal hours? ────────────────────────────────────────
  if (opportunity && !analysis?.is24h) {
    const now = new Date();
    const crTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Costa_Rica" }));
    const hour = crTime.getHours();

    if (hour < 7 || (hour >= 14 && hour < 19)) {
      insights.push(`⏰ Son las ${hour}:00 CR — fuera de tu ventana (7:30–14:00). Se ve forzado.`);
      riskLevel += 2;
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────
  let verdict: "GREEN" | "YELLOW" | "RED";
  let title: string;
  let recommendation: string;

  if (riskLevel <= 2) {
    verdict = "GREEN";
    title = "Mente clara, trade limpio.";
    recommendation = "El setup está fresco y tradeas con lógica, no con miedo. Tómalo si Bobby está de acuerdo.";
  } else if (riskLevel <= 5) {
    verdict = "YELLOW";
    title = "Cuidado: Señales emocionales.";
    recommendation = "Hay banderas emocionales aquí. Espera un setup más limpio, o tradea con la mitad del tamaño.";
  } else {
    verdict = "RED";
    title = "Para. No tradees.";
    recommendation = "Estás tradiendo por emoción — venganza, chasing, o sobre-trading. Salte. Revísalo cuando tengas la cabeza fría.";
  }

  return {
    verdict,
    title,
    insights: insights.length > 0 ? insights : [`Estás pensando claro. Sin banderas emocionales.`],
    recommendation,
  };
}
