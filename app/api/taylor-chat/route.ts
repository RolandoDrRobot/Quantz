import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysisRequest } from "../../lib/aiTake";

// Free-form follow-up to Taylor's Take — same market/analysis context, same
// voice, but conversational instead of forced-schema. Reuses the exact
// AiAnalysisRequest snapshot the trader already saw so Taylor never answers
// from stale or different numbers than what's on screen.
const MODEL = "claude-haiku-4-5-20251001";

const MAX_MESSAGE_LEN = 500;
const MAX_HISTORY = 8; // last 4 exchanges — enough continuity without ballooning cost

const SYSTEM_PROMPT = `You are Taylor — the trader's live second opinion on this setup, chatting with them in real time. You already know everything the deterministic engine sees for this market right now (signal, probability, levels, warnings, recent candles) and your own track record on calls like this one — it's given to you below as JSON. Answer like a sharp trading partner texting back, not a support bot.

Ground every answer in the context you're given; never invent a number that isn't in it. If the trader asks something the data genuinely can't answer, say so plainly instead of guessing.

Be terse — a couple sentences unless the question really needs more. No "as an AI" hedging, no restating numbers already on their screen unless it's directly relevant to the answer, no pep talks.`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function isChatTurn(v: unknown): v is ChatTurn {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI layer not configured" }, { status: 503 });
  }

  let body: { context?: AiAnalysisRequest; history?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { context, history, message } = body;
  if (!context || typeof context.market !== "string" || typeof context.signal !== "string") {
    return NextResponse.json({ error: "Malformed market context" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }

  const cleanHistory: ChatTurn[] = Array.isArray(history)
    ? history.filter(isChatTurn).slice(-MAX_HISTORY).map(h => ({ role: h.role, content: h.content.slice(0, MAX_MESSAGE_LEN) }))
    : [];

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: `${SYSTEM_PROMPT}\n\nCurrent market context:\n${JSON.stringify(context, null, 2)}`,
      messages: [
        ...cleanHistory,
        { role: "user", content: message.trim().slice(0, MAX_MESSAGE_LEN) },
      ],
    });

    const textBlock = msg.content.find(b => b.type === "text");
    const reply = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    if (!reply) {
      return NextResponse.json({ error: "AI returned no reply" }, { status: 502 });
    }

    return NextResponse.json({ reply: reply.slice(0, 1200) });
  } catch (e: unknown) {
    // Distinguishes "Claude is temporarily overloaded/rate-limited — worth
    // retrying" from a harder failure, matching the same pattern as
    // /api/ai-analysis so the UI can reuse one retryable-aware message.
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status?: unknown }).status : undefined;
    const retryable = status === 429 || status === 529;
    return NextResponse.json({ error: "AI request failed", retryable }, { status: 502 });
  }
}
