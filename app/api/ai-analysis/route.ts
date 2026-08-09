import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysisRequest, AiTake, AiVerdict } from "../../lib/aiTake";

// Second-opinion layer on top of the deterministic engine (analysis.ts).
// Haiku 4.5 — cheap enough to call on every "New Analysis" tap, sharp enough
// to actually catch things the rule-based scorer can't see (narrative context,
// candle-shape read, whether the stacked warnings tell one coherent story).
const MODEL = "claude-haiku-4-5-20251001";

const VERDICTS: AiVerdict[] = ["CONFIRM", "CAUTION", "REJECT"];

const SYSTEM_PROMPT = `You are a second, independent pair of eyes for a solo prop trader running an FTMO challenge on a breakout+retest scalping system (NASDAQ 100, Dow Jones, Gold, Bitcoin, Ethereum — 1-2 trades/day max, strict daily loss limit).

A rule-based engine already computed a signal, a probability score, and a list of scored factors/penalties/warnings. Your job is NOT to recompute that score. Your job is to read the full picture — trend, volatility ratio, breakout shape, recent candles, warnings — the way an experienced discretionary trader would glance at a chart, and catch anything the point-based scorer might be missing or overweighting: e.g. warnings that individually look minor but together tell a bad story, a breakout candle shape that looks exhausted despite good numbers, a trend reading that contradicts the trade direction, or conversely a genuinely clean setup buried under one noisy penalty.

Be terse and concrete — this trader reads dozens of these a week. No hedging, no "as an AI" caveats, no restating the numbers they already see on screen. Write like a sharp trading partner texting a quick gut-check, in English.

CONFIRM = the setup holds up, nothing new to flag.
CAUTION = tradeable but with a specific, real risk worth naming.
REJECT = the picture underneath contradicts the signal enough that you'd skip it even though the engine didn't.`;

const TOOL_NAME = "submit_take";

function buildUserPrompt(req: AiAnalysisRequest): string {
  return JSON.stringify(req, null, 2);
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI layer not configured" }, { status: 503 });
  }

  let body: AiAnalysisRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body.market !== "string" || typeof body.signal !== "string") {
    return NextResponse.json({ error: "Malformed analysis payload" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(body) }],
      tools: [
        {
          name: TOOL_NAME,
          description: "Submit your second-opinion take on this trade setup.",
          input_schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: VERDICTS },
              confidenceDelta: {
                type: "integer",
                description: "How many points this shifts the trader's confidence, from -20 (much worse than the score suggests) to +10 (cleaner than the score suggests).",
              },
              note: { type: "string", description: "1-2 sentences, trader voice, the actual insight — not a summary of the input numbers." },
              keyRisk: { type: "string", description: "The single biggest concrete risk in one short phrase." },
            },
            required: ["verdict", "confidenceDelta", "note", "keyRisk"],
          },
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    const toolUse = msg.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "AI returned no structured take" }, { status: 502 });
    }

    const input = toolUse.input as Partial<AiTake>;
    if (!input.verdict || !VERDICTS.includes(input.verdict) || typeof input.note !== "string") {
      return NextResponse.json({ error: "AI take failed validation" }, { status: 502 });
    }

    const take: AiTake = {
      verdict: input.verdict,
      confidenceDelta: typeof input.confidenceDelta === "number" ? Math.max(-20, Math.min(10, Math.round(input.confidenceDelta))) : 0,
      note: input.note.slice(0, 400),
      keyRisk: typeof input.keyRisk === "string" ? input.keyRisk.slice(0, 200) : "",
    };

    return NextResponse.json(take);
  } catch {
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }
}
