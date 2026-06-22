import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DASH_COOKIE, isValidDashCookie } from "@/lib/auth";
import { listAllowedNumbers, type AllowedNumberRow } from "@/lib/db";
import AllowedNumbersManager from "./AllowedNumbersManager";
import styles from "./allowed.module.css";

export const dynamic = "force-dynamic";

export default async function AllowedNumbersPage() {
  // Defense in depth: proxy is optimistic, re-verify here.
  const cookieStore = await cookies();
  if (!isValidDashCookie(cookieStore.get(DASH_COOKIE)?.value)) {
    redirect("/login?next=/allowed-numbers");
  }

  const numbers: AllowedNumberRow[] = await listAllowedNumbers();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Allowed numbers</h1>
          <Link href="/dashboard" className={styles.navLink}>
            ← Back to history
          </Link>
        </div>
        <form method="POST" action="/api/logout">
          <button type="submit" className={styles.logout}>
            Sign out
          </button>
        </form>
      </div>

      <p className={styles.intro}>
        Only the WhatsApp numbers listed here may use the bot. Anyone else who
        messages an order number is told they’re not allowed and to contact the
        administrator. Add numbers one at a time or upload a CSV.
      </p>

      <AllowedNumbersManager initialNumbers={numbers} />
    </div>
  );
}
