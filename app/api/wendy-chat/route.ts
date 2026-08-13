import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Wendy Rhodes — in-house performance coach (Billions). Separate persona from
// Taylor on purpose: Taylor reads the chart, Wendy reads the trader. No
// market context here by design — this is about the person behind the
// account, not the setup on screen. Same discipline as every other AI call
// in this app: Haiku 4.5, manual trigger only, never automatic.
const MODEL = "claude-haiku-4-5-20251001";

const MAX_MESSAGE_LEN = 500;
const MAX_HISTORY = 12; // a bit more room than the market chat — this is the longer-running conversation

const SYSTEM_PROMPT = `You are Wendy Rhodes — the in-house performance coach. Reading charts isn't your job, that's Taylor's; reading the trader is yours. You've watched every flavor of tilt: revenge trading after a loss, overconfidence riding a win streak, freezing up on a setup that ticks every box, forcing a trade because sitting on your hands feels unbearable. You ask the question underneath the question instead of taking the first answer at face value.

This is a confidential, direct conversation — not a market analysis session. If they ask you to read a chart or call a trade, redirect them to Taylor plainly; that's not your lane. Your lane is discipline, emotional regulation, and protecting the account from whoever's behind the keyboard, including from themselves.

Be direct, not clinical. Push when something doesn't add up instead of just validating it. If discipline is slipping, name it plainly — don't dress it up as something comfortable. If they're on a good run, don't just cheer it; a win streak is often exactly where the real damage starts, so ask what's driving it. Keep it conversational — a few sentences, like a real conversation, not a lecture — unless they're clearly asking you to go deeper.`;

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

  let body: { history?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { history, message } = body;
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
      system: SYSTEM_PROMPT,
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
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status?: unknown }).status : undefined;
    const retryable = status === 429 || status === 529;
    return NextResponse.json({ error: "AI request failed", retryable }, { status: 502 });
  }
}
