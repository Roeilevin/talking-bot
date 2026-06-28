"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./dashboard.module.css";

type BhEnv = "production" | "test";

// Toggle controlling which Bein Harim backend the bot reads/writes (production
// vs test). Persisted server-side via /api/dashboard/bh-env so every serverless
// instance picks it up (within the resolver's short cache window).
export default function BhEnvToggle({ initialEnv }: { initialEnv: BhEnv }) {
  const router = useRouter();
  const [env, setEnv] = useState<BhEnv>(initialEnv);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(next: BhEnv) {
    if (next === env || busy) return;
    if (
      next === "production" &&
      !window.confirm(
        "Switch to PRODUCTION? The bot will read and write live Bein Harim data."
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/dashboard/bh-env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to switch");
      setEnv(data.env as BhEnv);
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to switch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.envToggle}>
      <span className={styles.envLabel}>Bein Harim data:</span>
      <div className={styles.envSwitch} data-env={env}>
        <button
          type="button"
          className={`${styles.envOption} ${env === "production" ? styles.envActiveProd : ""}`}
          onClick={() => change("production")}
          disabled={busy || isPending}
        >
          Production
        </button>
        <button
          type="button"
          className={`${styles.envOption} ${env === "test" ? styles.envActiveTest : ""}`}
          onClick={() => change("test")}
          disabled={busy || isPending}
        >
          Test
        </button>
      </div>
      {err && <span className={styles.envErr}>{err}</span>}
    </div>
  );
}
