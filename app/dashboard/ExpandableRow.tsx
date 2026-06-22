"use client";

import { useState, type ReactNode } from "react";
import styles from "./dashboard.module.css";

interface TranscriptMessage {
  role: string;
  content: string;
  timestamp: string | null;
}

// Renders a table row whose leading cells are passed as `children`, plus a final
// cell with a Transcript toggle. When opened it renders a second row spanning the
// table and lazy-loads the transcript from /api/dashboard/transcript.
export default function ExpandableRow({
  children,
  query,
  totalCols,
}: {
  children: ReactNode; // the leading <td> cells for this row
  query: string; // e.g. "callControlId=..." or "conversationId=..."
  totalCols: number; // total columns in the table (for the transcript colSpan)
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/dashboard/transcript?${query}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <tr>
        {children}
        <td>
          <button type="button" className={styles.expandBtn} onClick={toggle}>
            {open ? "Hide" : "Transcript"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={totalCols}>
            <div className={styles.transcript}>
              {loading ? (
                <span className={styles.muted}>Loading transcript…</span>
              ) : error ? (
                <span className={styles.muted}>
                  Couldn’t load transcript ({error}).
                </span>
              ) : messages.length === 0 ? (
                <span className={styles.muted}>
                  No transcript available for this call.
                </span>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={styles.msg}>
                    <span className={styles.msgRole}>
                      {m.role === "assistant"
                        ? "Agent"
                        : m.role === "user"
                        ? "Caller"
                        : m.role}
                    </span>
                    <span>{m.content}</span>
                  </div>
                ))
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
