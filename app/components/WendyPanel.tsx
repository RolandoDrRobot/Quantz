"use client";

import { useMemo } from "react";
import { FiAlertTriangle, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { analyzeEmotions, type WendyAnalysis } from "../lib/wendy";
import type { Opportunity } from "../lib/opportunity";
import type { AnalysisResult } from "../lib/analysis";
import type { TradeRecord } from "../lib/records";
import { loadRecords } from "../lib/records";

interface WendyPanelProps {
  opportunity: Opportunity | null;
  analysis: AnalysisResult | null;
  livePrice: number | null;
}

export default function WendyPanel({ opportunity, analysis, livePrice }: WendyPanelProps) {
  const wendy = useMemo(() => {
    const records = loadRecords().sort((a, b) => b.time - a.time);
    return analyzeEmotions(opportunity, analysis, records, livePrice);
  }, [opportunity, livePrice]);

  const verdictColor = {
    GREEN:  { bg: "rgba(61,200,92,0.10)",   border: "#3dc85c", text: "#3dc85c" },
    YELLOW: { bg: "rgba(155,126,232,0.10)", border: "#9b7ee8", text: "#9b7ee8" },
    RED:    { bg: "rgba(224,82,82,0.10)",   border: "#e05252", text: "#e05252" },
  };

  const verdictIcon = {
    GREEN: <FiCheckCircle size={18} />,
    YELLOW: <FiAlertTriangle size={18} />,
    RED: <FiXCircle size={18} />,
  };

  const colors = verdictColor[wendy.verdict];

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-lg border"
      style={{
        background: colors.bg,
        borderColor: colors.border,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div style={{ color: colors.text }}>{verdictIcon[wendy.verdict]}</div>
        <div className="flex-1 min-w-0">
          <div
            className="font-bold text-sm tracking-wider"
            style={{ color: colors.text, fontFamily: "var(--font-display)" }}
          >
            ANÁLISIS DE BOBBY
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: colors.text }}
          >
            {wendy.title}
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="space-y-1.5">
        {wendy.insights.map((insight, i) => (
          <div
            key={i}
            className="text-xs leading-relaxed"
            style={{ color: "#b0bcd8" }}
          >
            {insight}
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div
        className="text-xs italic border-t pt-3"
        style={{
          color: "#7a90b8",
          borderColor: colors.border + "33",
        }}
      >
        "{wendy.recommendation}"
      </div>
    </div>
  );
}
