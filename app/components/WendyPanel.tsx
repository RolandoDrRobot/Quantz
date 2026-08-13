"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiSend, FiHeart } from "react-icons/fi";
import { glassChipStyle } from "../lib/glass";
import { fadeUpVariants, fadeVariants, TRANSITION_FAST } from "../lib/motionVariants";

interface WendyMessage {
  id: string;
  role: "user" | "wendy";
  text: string;
}

// Unlike Taylor's chat (session-only, per-market, tied to a specific setup),
// this is an ongoing relationship — persisted so check-ins accumulate across
// days instead of resetting every reload.
const KEY = "axe-wendy-chat";
const MAX_STORED = 200;

function loadMessages(): WendyMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is WendyMessage =>
      typeof m === "object" && m !== null &&
      typeof (m as WendyMessage).id === "string" &&
      ((m as WendyMessage).role === "user" || (m as WendyMessage).role === "wendy") &&
      typeof (m as WendyMessage).text === "string"
    );
  } catch {
    return [];
  }
}

function saveMessages(all: WendyMessage[]) {
  try {
    const trimmed = all.length > MAX_STORED ? all.slice(all.length - MAX_STORED) : all;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch { /* storage unavailable */ }
}

export default function WendyPanel() {
  const [messages, setMessages] = useState<WendyMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reading localStorage during the initial render would desync the static
  // server-prerendered HTML from the client's first paint — applying it
  // post-mount via an effect is what avoids that hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMessages(loadMessages());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setUnavailable(null);
    const userMsg: WendyMessage = { id: `u-${Date.now()}`, role: "user", text };
    const history = messages.map(m => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.text }));
    setMessages(prev => {
      const next = [...prev, userMsg];
      saveMessages(next);
      return next;
    });
    setSending(true);
    try {
      const res = await fetch("/api/wendy-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, message: text }),
      });
      if (!res.ok) {
        let retryable = false;
        try { retryable = (await res.json())?.retryable === true; } catch { /* body wasn't JSON */ }
        setUnavailable(retryable ? "Wendy's tied up right now — try again in a bit." : "Wendy's not available this round.");
        return;
      }
      const data: { reply: string } = await res.json();
      setMessages(prev => {
        const next = [...prev, { id: `w-${Date.now()}`, role: "wendy" as const, text: data.reply }];
        saveMessages(next);
        return next;
      });
    } catch {
      setUnavailable("Wendy's not available this round.");
    } finally {
      setSending(false);
    }
  }, [input, sending, messages]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
        {messages.length === 0 ? (
          <motion.div
            className="flex-1 flex flex-col items-center justify-center px-5 text-center"
            style={{ color: "var(--text-secondary)" }}
            variants={fadeVariants} initial="hidden" animate="visible" transition={TRANSITION_FAST}
          >
            <FiHeart size={44} className="mb-4 opacity-15" />
            <p className="text-lg">This is between us.</p>
            <p className="text-base mt-2 opacity-70">Not about the chart — about how you&apos;re actually doing in the seat. Talk to me.</p>
          </motion.div>
        ) : (
          messages.map(m => (
            <motion.div
              key={m.id}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              variants={fadeUpVariants} initial="hidden" animate="visible" transition={TRANSITION_FAST}
            >
              <div
                className="rounded-md px-4 py-3 max-w-[88%] whitespace-pre-wrap text-lg lg:text-sm leading-relaxed"
                style={{ ...glassChipStyle(m.role === "wendy" ? "#f2f5f8" : undefined), color: "var(--text-secondary)" }}
              >
                {m.role === "wendy" && (
                  <div className="flex items-center gap-1.5 mb-1 text-sm lg:text-xs font-black tracking-[0.15em]" style={{ color: "#f2f5f8" }}>
                    <FiHeart size={11} /> WENDY
                  </div>
                )}
                {m.text}
              </div>
            </motion.div>
          ))
        )}

        <AnimatePresence>
          {sending && (
            <motion.div
              className="flex justify-start"
              variants={fadeVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
            >
              <div className="rounded-md px-4 py-3 flex items-center gap-2.5" style={glassChipStyle()}>
                <FiHeart size={14} className="animate-pulse" style={{ color: "var(--text-muted)" }} />
                <span className="text-lg lg:text-base" style={{ color: "var(--text-muted)" }}>Wendy&apos;s thinking…</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {unavailable && !sending && (
          <div className="px-2 text-base lg:text-sm" style={{ color: "var(--text-muted)" }}>{unavailable}</div>
        )}

        <div ref={scrollRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="How are you doing right now?"
          className="flex-1 min-w-0 px-4 py-4 rounded text-base lg:text-sm outline-none"
          style={{ ...glassChipStyle(), color: "var(--text-primary)" }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          title="Send"
          className="flex items-center justify-center w-14 h-14 rounded shrink-0 transition-all duration-150"
          style={{
            ...glassChipStyle("#f2f5f8"),
            color: "var(--text-primary)",
            cursor: !input.trim() || sending ? "not-allowed" : "pointer",
            opacity: !input.trim() ? 0.5 : 1,
          }}
        >
          <FiSend size={20} />
        </button>
      </form>
    </div>
  );
}
