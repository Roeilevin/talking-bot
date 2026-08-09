import { requireUser } from "@/lib/auth";
import { listAllowedNumbers, type AllowedNumberRow } from "@/lib/db";
import NavMenu from "../components/NavMenu";
import AllowedNumbersManager from "./AllowedNumbersManager";
import styles from "./allowed.module.css";

export const dynamic = "force-dynamic";

export default async function AllowedNumbersPage() {
  // Defense in depth: proxy is optimistic, re-verify here.
  const user = await requireUser("/allowed-numbers");

  const numbers: AllowedNumberRow[] = await listAllowedNumbers();

  return (
    <>
      <NavMenu email={user.email} />
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Allowed numbers</h1>
        </div>

        <p className={styles.intro}>
          Only the WhatsApp numbers listed here may use the bot. Anyone else who
          messages an order number is told they’re not allowed and to contact the
          administrator. Add numbers one at a time or upload a CSV.
        </p>

        <AllowedNumbersManager initialNumbers={numbers} />
      </div>
    </>
  );
}
