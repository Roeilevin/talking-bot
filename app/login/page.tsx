import { redirect } from "next/navigation";
import {
  getCurrentUser,
  safeNextPath,
  supabaseAuthConfigured,
} from "@/lib/auth";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);

  if (await getCurrentUser()) {
    redirect(next);
  }

  const configured = supabaseAuthConfigured();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>Bein Harim</p>
        <h1 className={styles.title}>Talking Bot</h1>
        <p className={styles.subtitle}>
          {configured
            ? "Sign in with your email and password."
            : "Sign-in is unavailable."}
        </p>
        {configured ? (
          <LoginForm next={next} />
        ) : (
          <p className={styles.err}>
            Supabase Auth is not configured. Set <code>SUPABASE_URL</code> and{" "}
            <code>SUPABASE_PUBLISHABLE_KEY</code> in the environment, then
            redeploy.
          </p>
        )}
      </div>
    </div>
  );
}
