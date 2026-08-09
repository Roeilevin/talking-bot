"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./users.module.css";

export interface DashboardUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  hasAccess: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsersManager({
  initialUsers,
  currentUserId,
  minPasswordLength,
}: {
  initialUsers: DashboardUser[];
  currentUserId: string;
  minPasswordLength: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function call(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown>
  ): Promise<string | null> {
    const res = await fetch("/api/users", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.error || "Something went wrong. Try again.";
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const error = await call("POST", { email, password });
    setBusy(false);
    if (error) {
      setMsg({ kind: "err", text: error });
      return;
    }
    setMsg({ kind: "ok", text: `Created ${email.trim().toLowerCase()}.` });
    setEmail("");
    setPassword("");
    refresh();
  }

  async function onChangePassword(user: DashboardUser) {
    const next = window.prompt(
      `New password for ${user.email} (at least ${minPasswordLength} characters):`
    );
    if (next === null) return;
    setBusy(true);
    setMsg(null);
    const error = await call("PATCH", { id: user.id, password: next });
    setBusy(false);
    setMsg(
      error
        ? { kind: "err", text: error }
        : { kind: "ok", text: `Password changed for ${user.email}.` }
    );
    if (!error) refresh();
  }

  async function onToggleAccess(user: DashboardUser) {
    setBusy(true);
    setMsg(null);
    const error = await call("PATCH", {
      id: user.id,
      hasAccess: !user.hasAccess,
    });
    setBusy(false);
    setMsg(
      error
        ? { kind: "err", text: error }
        : {
            kind: "ok",
            text: `${user.hasAccess ? "Revoked" : "Granted"} access for ${
              user.email
            }.`,
          }
    );
    if (!error) refresh();
  }

  async function onDelete(user: DashboardUser) {
    if (
      !window.confirm(
        `Delete ${user.email}? This removes the account permanently and cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const error = await call("DELETE", { id: user.id });
    setBusy(false);
    setMsg(
      error
        ? { kind: "err", text: error }
        : { kind: "ok", text: `Deleted ${user.email}.` }
    );
    if (!error) refresh();
  }

  return (
    <div>
      <form className={styles.addForm} onSubmit={onCreate}>
        <input
          className={styles.input}
          type="email"
          placeholder="Email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
        <input
          className={styles.input}
          type="password"
          placeholder="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
          minLength={minPasswordLength}
        />
        <button className={styles.primaryBtn} type="submit" disabled={busy}>
          Add user
        </button>
      </form>
      <span className={styles.hint}>
        The account is created already confirmed — no verification email is sent.
        Minimum {minPasswordLength} characters.
      </span>

      {msg ? (
        <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Access</th>
              <th>Created</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No accounts yet.
                </td>
              </tr>
            ) : (
              initialUsers.map((u) => {
                const isMe = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.email}
                      {isMe ? <span className={styles.you}>you</span> : null}
                    </td>
                    <td
                      className={u.hasAccess ? styles.badgeOk : styles.badgeOff}
                    >
                      {u.hasAccess ? "Allowed" : "No access"}
                    </td>
                    <td className={styles.muted}>{fmt(u.createdAt)}</td>
                    <td className={styles.muted}>{fmt(u.lastSignInAt)}</td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => onChangePassword(u)}
                          disabled={busy}
                        >
                          Change password
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          onClick={() => onToggleAccess(u)}
                          disabled={busy || isMe}
                          title={
                            isMe ? "You can't revoke your own access" : undefined
                          }
                        >
                          {u.hasAccess ? "Revoke" : "Grant"}
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => onDelete(u)}
                          disabled={busy || isMe}
                          title={
                            isMe ? "You can't delete your own account" : undefined
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {isPending ? <p className={styles.muted}>Refreshing…</p> : null}
    </div>
  );
}
