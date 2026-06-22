"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./allowed.module.css";

interface AllowedNumber {
  id: string;
  phone_number: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

interface ParsedRow {
  phone_number: string;
  label: string | null;
}

// Parse free-form CSV/pasted text. For each non-empty line we split on comma,
// semicolon or tab and pick the field with the most digits as the phone number;
// the remaining field(s) become the name. Lines with no phone-like field (e.g.
// a "name,phone" header) are skipped. Column order does not matter.
function parseCsv(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split(/[,;\t]/).map((f) => f.trim());
    let phoneIdx = -1;
    let bestDigits = 0;
    fields.forEach((f, i) => {
      const digits = (f.match(/\d/g) || []).length;
      if (digits >= 7 && digits > bestDigits) {
        bestDigits = digits;
        phoneIdx = i;
      }
    });
    if (phoneIdx === -1) continue; // header or non-data line
    const phone_number = fields[phoneIdx];
    const label =
      fields.filter((_, i) => i !== phoneIdx).join(" ").trim() || null;
    rows.push({ phone_number, label });
  }
  return rows;
}

export default function AllowedNumbersManager({
  initialNumbers,
}: {
  initialNumbers: AllowedNumber[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function post(numbers: ParsedRow[]): Promise<boolean> {
    const res = await fetch("/api/allowed-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numbers }),
    });
    return res.ok;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setMsg(null);
    const ok = await post([{ phone_number: phone, label: name || null }]);
    setBusy(false);
    if (ok) {
      setName("");
      setPhone("");
      setMsg({ kind: "ok", text: "Number added." });
      refresh();
    } else {
      setMsg({ kind: "err", text: "Could not add number. Try again." });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setBusy(false);
      setMsg({
        kind: "err",
        text: "No phone numbers found in that file.",
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const ok = await post(rows);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (ok) {
      setMsg({ kind: "ok", text: `Imported ${rows.length} number(s).` });
      refresh();
    } else {
      setMsg({ kind: "err", text: "Import failed. Try again." });
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/allowed-numbers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ kind: "ok", text: "Number removed." });
      refresh();
    } else {
      setMsg({ kind: "err", text: "Could not remove number." });
    }
  }

  return (
    <div>
      <div className={styles.tools}>
        <form className={styles.addForm} onSubmit={onAdd}>
          <input
            className={styles.input}
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <input
            className={styles.input}
            type="tel"
            placeholder="Phone (e.g. 0504425422 or 972504425422)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            required
          />
          <button className={styles.primaryBtn} type="submit" disabled={busy}>
            Add
          </button>
        </form>

        <div className={styles.uploadBox}>
          <label className={styles.secondaryBtn}>
            Upload CSV
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onFile}
              disabled={busy}
              hidden
            />
          </label>
          <span className={styles.hint}>
            One per line: name and phone in any column order.
          </span>
        </div>
      </div>

      {msg ? (
        <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone number</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialNumbers.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  No allowed numbers yet. Add one above.
                </td>
              </tr>
            ) : (
              initialNumbers.map((n) => (
                <tr key={n.id}>
                  <td>{n.label || <span className={styles.muted}>—</span>}</td>
                  <td>{n.phone_number}</td>
                  <td className={styles.muted}>
                    {new Date(n.created_at).toLocaleDateString("en-GB", {
                      timeZone: "Asia/Jerusalem",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => onDelete(n.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {isPending ? <p className={styles.muted}>Refreshing…</p> : null}
    </div>
  );
}
