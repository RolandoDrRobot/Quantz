"use client";

import { useState, useCallback, useMemo } from "react";
import { FiX, FiArrowUpRight, FiArrowDownRight, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { LuNotebookPen } from "react-icons/lu";
import { loadRecords, type TradeRecord } from "../lib/records";
import { loadJournal, saveJournal, EMOTIONS, EMPTY_ENTRY, type JournalEntry, type SetupGrade } from "../lib/journal";

const GRADES: SetupGrade[] = ["A+", "A", "B", "C"];

function EntryRow({ record, entry, onChange }: { record: TradeRecord; entry: JournalEntry; onChange: (patch: Partial<JournalEntry>) => void }) {
  const [open, setOpen] = useState(false);
  const win = record.pnl > 0;
  const hasNotes = entry.followedPlan !== null || entry.setupGrade !== null || entry.emotion !== null || entry.notes.trim().length > 0;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors"
        style={{ background: "var(--bg-card)", cursor: "pointer" }}
      >
        <span className="flex items-center gap-1 font-bold text-sm shrink-0" style={{ color: record.direction === "long" ? "#1c7d4c" : "#8a2f2a" }}>
          {record.direction === "long" ? <FiArrowUpRight size={15} /> : <FiArrowDownRight size={15} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>{record.market}</span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {new Date(record.time).toLocaleString("en-US", { timeZone: "America/Costa_Rica", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
            </span>
            {hasNotes && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--gold)" }} title="Has journal notes" />}
          </div>
        </div>
        <span className="font-black text-sm shrink-0" style={{ color: win ? "#1c7d4c" : "#8a2f2a", fontFamily: "var(--font-display)" }}>
          {win ? "+" : "−"}${Math.abs(record.pnl).toFixed(0)}
        </span>
        {open ? <FiChevronUp size={16} color="var(--text-muted)" /> : <FiChevronDown size={16} color="var(--text-muted)" />}
      </button>

      {open && (
        <div className="px-4 py-4 flex flex-col gap-4" style={{ background: "var(--bg-panel)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div className="text-xs font-bold tracking-[0.15em] mb-2" style={{ color: "var(--text-muted)" }}>FOLLOWED THE PLAN?</div>
            <div className="flex gap-2">
              {[{ v: true, label: "YES" }, { v: false, label: "NO" }].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => onChange({ followedPlan: entry.followedPlan === opt.v ? null : opt.v })}
                  className="px-4 py-2 rounded-md text-sm font-bold"
                  style={{
                    background: entry.followedPlan === opt.v ? (opt.v ? "rgba(28,125,76,0.15)" : "rgba(138,47,42,0.15)") : "rgba(255,255,255,0.05)",
                    color: entry.followedPlan === opt.v ? (opt.v ? "#1c7d4c" : "#8a2f2a") : "var(--text-secondary)",
                    border: `1px solid ${entry.followedPlan === opt.v ? (opt.v ? "#1c7d4c" : "#8a2f2a") : "rgba(255,255,255,0.1)"}`,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold tracking-[0.15em] mb-2" style={{ color: "var(--text-muted)" }}>SETUP QUALITY</div>
            <div className="flex gap-2">
              {GRADES.map(g => (
                <button
                  key={g}
                  onClick={() => onChange({ setupGrade: entry.setupGrade === g ? null : g })}
                  className="px-4 py-2 rounded-md text-sm font-bold"
                  style={{
                    background: entry.setupGrade === g ? "var(--gold-dim)" : "rgba(255,255,255,0.05)",
                    color: entry.setupGrade === g ? "var(--gold)" : "var(--text-secondary)",
                    border: `1px solid ${entry.setupGrade === g ? "var(--gold-border)" : "rgba(255,255,255,0.1)"}`,
                    cursor: "pointer",
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold tracking-[0.15em] mb-2" style={{ color: "var(--text-muted)" }}>EMOTIONAL STATE ON ENTRY</div>
            <div className="flex gap-2 flex-wrap">
              {EMOTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => onChange({ emotion: entry.emotion === e ? null : e })}
                  className="px-3 py-1.5 rounded-md text-sm font-bold"
                  style={{
                    background: entry.emotion === e ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                    color: entry.emotion === e ? "var(--text-primary)" : "var(--text-secondary)",
                    border: `1px solid ${entry.emotion === e ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)"}`,
                    cursor: "pointer",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold tracking-[0.15em] mb-2" style={{ color: "var(--text-muted)" }}>NOTES</div>
            <textarea
              value={entry.notes}
              onChange={ev => onChange({ notes: ev.target.value })}
              placeholder="What happened? What would you do differently?"
              rows={3}
              className="w-full rounded-md px-3 py-2 text-sm resize-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-primary)" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function JournalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Records only change via addRecord (a new trade resolving) or clearRecords,
  // neither of which happens while this modal is mounted and closed, so a
  // lazy initializer read once on open is enough.
  const records = useMemo(() => (open ? loadRecords() : []), [open]);
  const [entries, setEntries] = useState<Record<string, JournalEntry>>(() => loadJournal());

  const updateEntry = useCallback((id: string, patch: Partial<JournalEntry>) => {
    setEntries(prev => {
      const next = { ...prev, [id]: { ...(prev[id] ?? EMPTY_ENTRY), ...patch } };
      saveJournal(next);
      return next;
    });
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center lg:p-6" style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="w-full lg:max-w-3xl h-[92dvh] lg:h-[88vh] rounded-t-lg lg:rounded-lg overflow-hidden flex flex-col"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--gold-border)", boxShadow: "0 -8px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 shrink-0" style={{ borderBottom: "1px solid var(--gold-border)" }}>
          <div>
            <div className="flex items-center gap-2 font-black text-xl tracking-[0.25em]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              <LuNotebookPen size={18} /> JOURNAL
            </div>
            <div className="text-base mt-0.5" style={{ color: "var(--text-secondary)" }}>Tap a trade to log the plan, setup grade, and headspace behind it</div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-bold"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
          >
            <FiX size={13} /> CLOSE
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-7 flex flex-col gap-3">
          {records.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center" style={{ color: "var(--text-muted)" }}>
              <LuNotebookPen size={48} className="mb-4 opacity-15" />
              <p className="text-lg">No trades to journal yet.</p>
              <p className="text-base mt-2 opacity-70">Every closed trade shows up here — tap one to write it up.</p>
            </div>
          ) : (
            records.map(r => (
              <EntryRow
                key={r.id}
                record={r}
                entry={entries[r.id] ?? EMPTY_ENTRY}
                onChange={patch => updateEntry(r.id, patch)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
