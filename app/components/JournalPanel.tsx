"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FiPlus, FiEdit2, FiTrash2, FiX, FiCheck, FiBookOpen } from "react-icons/fi";
import { loadEntries, addEntry, updateEntry, deleteEntry, computeJournalStats, type JournalEntry, type NewJournalEntry } from "../lib/journal";
import { fmtSignedMoney, fmtPrice, fmtLots } from "../lib/format";
import { glassStyle, glassChipStyle } from "../lib/glass";
import { fadeUpVariants, fadeVariants, TRANSITION_FAST } from "../lib/motionVariants";

const EMPTY_FORM: NewJournalEntry = {
  date: Date.now(),
  market: "",
  direction: "long",
  entry: null,
  exit: null,
  size: null,
  pnl: null,
  notes: "",
};

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateInputValue(v: string): number {
  const t = new Date(`${v}T12:00:00`).getTime();
  return isFinite(t) ? t : Date.now();
}

const inputStyle = { ...glassChipStyle(), color: "var(--text-primary)" };

export default function JournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NewJournalEntry>(EMPTY_FORM);

  // Reading localStorage during the initial render would desync the static
  // server-prerendered HTML from the client's first paint — applying it
  // post-mount via an effect is what avoids that hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setEntries(loadEntries());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const stats = computeJournalStats(entries);

  const openNew = useCallback(() => {
    setForm({ ...EMPTY_FORM, date: Date.now() });
    setEditingId(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((e: JournalEntry) => {
    setForm({ date: e.date, market: e.market, direction: e.direction, entry: e.entry, exit: e.exit, size: e.size, pnl: e.pnl, notes: e.notes });
    setEditingId(e.id);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }, []);

  const submit = useCallback(() => {
    if (!form.market.trim()) return;
    if (editingId) {
      updateEntry(editingId, form);
    } else {
      addEntry(form);
    }
    setEntries(loadEntries());
    closeForm();
  }, [form, editingId, closeForm]);

  const remove = useCallback((id: string) => {
    deleteEntry(id);
    setEntries(loadEntries());
    if (editingId === id) closeForm();
  }, [editingId, closeForm]);

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Stats — the running picture of real capital, not the automatic prediction log */}
      <div className="rounded-lg px-5 py-4 grid grid-cols-3 gap-3" style={glassStyle(stats.totalPnl >= 0 ? "#1c7d4c" : "#8a2f2a")}>
        <div>
          <div className="text-[11px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>TOTAL P/L</div>
          <div className="text-2xl font-black leading-tight" style={{ color: stats.totalPnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
            {fmtSignedMoney(stats.totalPnl)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>WIN RATE</div>
          <div className="text-2xl font-black leading-tight" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            {stats.wins + stats.losses > 0 ? `${stats.winRate}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-widest" style={{ color: "var(--text-muted)" }}>TRADES</div>
          <div className="text-2xl font-black leading-tight" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
            {stats.count}
          </div>
        </div>
      </div>

      {!formOpen && (
        <button
          onClick={openNew}
          className="flex items-center justify-center gap-2 py-3 rounded-md font-black text-sm tracking-wide"
          style={{ ...glassChipStyle(), color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-display)" }}
        >
          <FiPlus size={16} /> ADD TRADE
        </button>
      )}

      {/* Add/edit form — every field is a plain editable input; nothing here is
          verified against real price data, it's whatever the trader typed
          after placing the trade manually in the broker. */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            className="rounded-lg p-4 flex flex-col gap-3"
            style={glassStyle()}
            variants={fadeUpVariants} initial="hidden" animate="visible" exit="hidden" transition={TRANSITION_FAST}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-black tracking-widest" style={{ color: "var(--text-primary)" }}>
                {editingId ? "EDIT TRADE" : "NEW TRADE"}
              </span>
              <button onClick={closeForm} style={{ color: "var(--text-muted)", cursor: "pointer" }}>
                <FiX size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>DATE</span>
                <input
                  type="date"
                  value={toDateInputValue(form.date)}
                  onChange={e => setForm(f => ({ ...f, date: fromDateInputValue(e.target.value) }))}
                  className="px-3 py-2 rounded-md text-sm outline-none"
                  style={inputStyle}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>MARKET</span>
                <input
                  type="text"
                  value={form.market}
                  onChange={e => setForm(f => ({ ...f, market: e.target.value }))}
                  placeholder="US100, XAUUSD…"
                  className="px-3 py-2 rounded-md text-sm outline-none"
                  style={inputStyle}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              {(["long", "short"] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setForm(f => ({ ...f, direction: d }))}
                  className="flex-1 py-2 rounded-md text-sm font-black tracking-wide"
                  style={{
                    ...glassChipStyle(d === "long" ? "#1c7d4c" : "#8a2f2a"),
                    color: form.direction === d ? (d === "long" ? "#1c7d4c" : "#8a2f2a") : "var(--text-muted)",
                    opacity: form.direction === d ? 1 : 0.5,
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {d === "long" ? "▲ LONG" : "▼ SHORT"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>ENTRY</span>
                <input
                  type="number" inputMode="decimal" step="any"
                  value={form.entry ?? ""}
                  onChange={e => setForm(f => ({ ...f, entry: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                  className="px-3 py-2 rounded-md text-sm outline-none"
                  style={inputStyle}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>EXIT</span>
                <input
                  type="number" inputMode="decimal" step="any"
                  value={form.exit ?? ""}
                  onChange={e => setForm(f => ({ ...f, exit: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                  className="px-3 py-2 rounded-md text-sm outline-none"
                  style={inputStyle}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>LOTS</span>
                <input
                  type="number" inputMode="decimal" step="any"
                  value={form.size ?? ""}
                  onChange={e => setForm(f => ({ ...f, size: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                  className="px-3 py-2 rounded-md text-sm outline-none"
                  style={inputStyle}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>P/L ($)</span>
              <input
                type="number" inputMode="decimal" step="any"
                value={form.pnl ?? ""}
                onChange={e => setForm(f => ({ ...f, pnl: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                placeholder="+25 or -18"
                className="px-3 py-2 rounded-md text-sm outline-none"
                style={inputStyle}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>NOTES</span>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="What happened, what you'd do differently…"
                className="px-3 py-2 rounded-md text-sm outline-none resize-none"
                style={inputStyle}
              />
            </label>

            <button
              onClick={submit}
              disabled={!form.market.trim()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-md font-black text-sm tracking-wide"
              style={{
                ...glassChipStyle("#1c7d4c"),
                color: "#1c7d4c",
                cursor: form.market.trim() ? "pointer" : "not-allowed",
                opacity: form.market.trim() ? 1 : 0.5,
                fontFamily: "var(--font-display)",
              }}
            >
              <FiCheck size={16} /> {editingId ? "SAVE CHANGES" : "ADD TRADE"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Entries list */}
      {entries.length === 0 && !formOpen ? (
        <motion.div
          className="flex-1 flex flex-col items-center justify-center px-5 py-16 text-center"
          style={{ color: "var(--text-primary)" }}
          variants={fadeVariants} initial="hidden" animate="visible" transition={TRANSITION_FAST}
        >
          <FiBookOpen size={44} className="mb-4 opacity-15" />
          <p className="text-lg">No trades logged yet.</p>
          <p className="text-base mt-2 opacity-70">Log what you actually took manually — this is your own record, nothing here is automatic.</p>
        </motion.div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map(e => (
            <motion.div
              key={e.id}
              className="rounded-lg px-4 py-3"
              style={glassChipStyle(e.pnl !== null ? (e.pnl >= 0 ? "#1c7d4c" : "#8a2f2a") : undefined)}
              variants={fadeUpVariants} initial="hidden" animate="visible" transition={TRANSITION_FAST}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-black text-sm tracking-wide truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                    {e.market || "—"}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-black tracking-wide shrink-0"
                    style={{ color: e.direction === "long" ? "#1c7d4c" : "#8a2f2a" }}
                  >
                    {e.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {e.pnl !== null && (
                    <span className="text-lg font-black mr-1" style={{ color: e.pnl >= 0 ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
                      {fmtSignedMoney(e.pnl)}
                    </span>
                  )}
                  <button onClick={() => openEdit(e)} className="p-1.5 rounded" style={{ color: "var(--text-muted)", cursor: "pointer" }}>
                    <FiEdit2 size={14} />
                  </button>
                  <button onClick={() => remove(e.id)} className="p-1.5 rounded" style={{ color: "var(--text-muted)", cursor: "pointer" }}>
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>
                {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {e.entry !== null && ` · entry ${fmtPrice(e.entry)}`}
                {e.exit !== null && ` · exit ${fmtPrice(e.exit)}`}
                {e.size !== null && ` · ${fmtLots(e.size)} lots`}
              </div>
              {e.notes && (
                <div className="text-[13px] mt-1.5 leading-snug" style={{ color: "var(--text-primary)" }}>{e.notes}</div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
