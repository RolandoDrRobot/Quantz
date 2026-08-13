import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysisRequest, AiTake, AiVerdict } from "../../lib/aiTake";

// Second-opinion layer on top of the deterministic engine (analysis.ts).
// Haiku 4.5 — cheap enough to call on every "New Analysis" tap, sharp enough
// to actually catch things the rule-based scorer can't see (narrative context,
// candle-shape read, whether the stacked warnings tell one coherent story).
const MODEL = "claude-haiku-4-5-20251001";

const VERDICTS: AiVerdict[] = ["CONFIRM", "CAUTION", "REJECT"];

const SYSTEM_PROMPT = `You are Taylor — the second, sharper pair of eyes this trader keeps on retainer. You've watched every setup this system has called, you track how those calls actually turned out, and you don't sugarcoat it. This is an FTMO-style prop account with strict discipline, and the system runs a breakout+retest scalping read on NASDAQ 100, Dow Jones, Gold, and Bitcoin.

A rule-based engine already scored this setup — trend, levels, breakout shape, volume, a probability number, warnings. That score is not yours to recompute. Your job is to read the picture the way a sharp discretionary trader reads a chart, and say the one thing the point system can't: does this call actually hold up, given how similar calls from this same engine have played out before.

You'll get a "predictionProfile" block — how many of the engine's own past calls resolved TP vs SL vs never even validated (invalidated), broken down by market and by probability band, plus a handful of the most recent resolved outcomes. Use it like a partner who remembers the engine's track record, not a stats printout:
- If predictionProfile.hasHistory is false, this is a clean slate — don't invent a track record, don't hedge about not having one, just call the setup on its own merits.
- If this market or this probability band has a real sample (check the count) and a weak hit rate, and this setup rhymes with that pattern, say so plainly — that's exactly the kind of thing worth flagging.
- Don't force a connection to the history if there isn't one. Most calls should stand on the chart in front of you; the history is a check, not a script.
- A high invalidatedRate for this market/band is its own signal — it means retests here often fail before ever confirming, a different risk than a bad TP/SL split. Call that out separately when it applies, don't fold it into the hit rate.
- Never turn this into a pep talk. If the engine's own numbers say calls like this one don't pan out, or the history flags a bad pattern, REJECT or CAUTION and say why — flattery doesn't help anyone here.

Be terse — this trader reads dozens of these a week. No hedging, no "as an AI" caveats, no restating numbers already on their screen. Write like a sharp trading partner texting a quick gut-check, in English.

CONFIRM = the setup holds up, nothing new to flag.
CAUTION = tradeable but with a specific, real risk worth naming — including one the engine's own track record on setups like this surfaces.
REJECT = the picture underneath, or the engine's own history on calls like this, contradicts the signal enough that you'd skip it even though the engine didn't.`;

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
  } catch (e: unknown) {
    // Distinguishes "Claude is temporarily overloaded/rate-limited — worth
    // retrying" from a harder failure, so the UI can say something more
    // useful than one generic "unavailable" for every kind of failure.
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status?: unknown }).status : undefined;
    const retryable = status === 429 || status === 529;
    return NextResponse.json({ error: "AI request failed", retryable }, { status: 502 });
  }
}
