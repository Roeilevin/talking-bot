import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { listDashboardUsers, MIN_PASSWORD_LENGTH } from "@/lib/admin-users";
import NavMenu from "../components/NavMenu";
import UsersManager, { type DashboardUser } from "./UsersManager";
import styles from "./users.module.css";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Defense in depth: proxy is optimistic, re-verify here.
  const user = await requireUser("/users");

  let users: DashboardUser[] = [];
  let loadError: string | null = null;
  try {
    users = await listDashboardUsers();
  } catch (e) {
    console.error("[users] listDashboardUsers failed", e);
    loadError =
      "Could not load accounts from Supabase. Check SUPABASE_SERVICE_ROLE_KEY.";
  }

  const allowlistActive = config.dashboardAllowedEmails.length > 0;

  return (
    <>
      <NavMenu email={user.email} />
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Users</h1>
        </div>

        <p className={styles.intro}>
          Accounts that can sign in to this dashboard. Adding a user here creates
          a confirmed Supabase Auth account and grants it dashboard access;
          accounts without that grant are rejected at sign-in even with a valid
          password.
        </p>

        {allowlistActive ? (
          <p className={styles.warn}>
            <strong>DASHBOARD_ALLOWED_EMAILS is set</strong>, so it overrides the
            grants below — only {config.dashboardAllowedEmails.join(", ")} can
            sign in. Users you add here stay locked out until they are added to
            that environment variable too.
          </p>
        ) : null}

        {loadError ? <p className={styles.err}>{loadError}</p> : null}

        <UsersManager
          initialUsers={users}
          currentUserId={user.id}
          minPasswordLength={MIN_PASSWORD_LENGTH}
        />
      </div>
    </>
  );
}
