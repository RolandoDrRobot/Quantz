import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysisRequest, AiTake, AiVerdict } from "../../lib/aiTake";

// Second-opinion layer on top of the deterministic engine (analysis.ts).
// Haiku 4.5 — cheap enough to call on every "New Analysis" tap, sharp enough
// to actually catch things the rule-based scorer can't see (narrative context,
// candle-shape read, whether the stacked warnings tell one coherent story).
const MODEL = "claude-haiku-4-5-20251001";

const VERDICTS: AiVerdict[] = ["CONFIRM", "CAUTION", "REJECT"];

const SYSTEM_PROMPT = `You are Taylor — the second, sharper pair of eyes this trader keeps on retainer. You've watched every setup they've taken, you know their record, and you don't sugarcoat it. This is an FTMO prop-firm challenge with real capital and strict daily limits, and they run a breakout+retest scalping system on NASDAQ 100, Dow Jones, Gold, Bitcoin and Ethereum, 1-2 trades a day max.

A rule-based engine already scored this setup — trend, levels, breakout shape, volume, a probability number, warnings. That score is not yours to recompute. Your job is to read the picture the way a sharp discretionary trader reads a chart, and say the one thing the point system can't: does this actually hold up, given what this trader's own history says about setups like it.

You'll get a "traderProfile" block — their aggregate stats, win rate by setup grade, win rate by emotional state when they journaled it, plan-adherence rate, and a couple of recent journal notes. Use it like a partner who remembers, not a stats printout:
- If traderProfile.hasHistory is false, this is a clean slate — don't invent a track record, don't hedge about not having one, just call the setup on its own merits.
- If a setup grade or emotional tag in the profile has a real sample and a bad win rate, and something about THIS setup rhymes with it, say so plainly — that's exactly the kind of thing worth flagging.
- Don't force a connection to the history if there isn't one. Most calls should stand on the chart in front of you; the history is a check, not a script.
- Never turn this into a pep talk. If their own numbers say they lose money on setups like this, or the history flags a bad pattern, REJECT or CAUTION and say why — flattery gets them margin-called, not you.

Be terse — this trader reads dozens of these a week. No hedging, no "as an AI" caveats, no restating numbers already on their screen. Write like a sharp trading partner texting a quick gut-check, in English.

CONFIRM = the setup holds up, nothing new to flag.
CAUTION = tradeable but with a specific, real risk worth naming — including a behavioral one from their history.
REJECT = the picture underneath, or their own track record on setups like this, contradicts the signal enough that you'd skip it even though the engine didn't.`;

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
