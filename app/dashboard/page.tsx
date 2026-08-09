import { requireUser } from "@/lib/auth";
import { listCalls, listWhatsAppSends, getSetting, type CallRow, type WhatsAppSendRow } from "@/lib/db";
import { listInboundConversations, type InboundConversation } from "@/lib/telnyx";
import NavMenu from "../components/NavMenu";
import ExpandableRow from "./ExpandableRow";
import BhEnvToggle from "./BhEnvToggle";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cls(prefix: string, value: string | null | undefined): string {
  if (!value) return "";
  const key = prefix + value.replace(/[^a-z]/gi, "").toLowerCase();
  return (styles as Record<string, string>)[key] ?? "";
}

export default async function DashboardPage() {
  // Defense in depth: proxy is optimistic, re-verify here.
  const user = await requireUser("/dashboard");

  const [calls, sends, inbound, bhEnvRaw] = await Promise.all([
    listCalls(200),
    listWhatsAppSends(200),
    listInboundConversations(50),
    getSetting("bh_env"),
  ]);
  const bhEnv: "production" | "test" = bhEnvRaw === "test" ? "test" : "production";

  return (
    <>
      <NavMenu email={user.email} />
      <div className={styles.page}>
      {bhEnv === "test" && (
        <div className={styles.testBanner}>
          ⚠️ TEST environment active — the bot is reading/writing the Bein Harim
          <strong> test</strong> backend, not production.
        </div>
      )}
      <div className={styles.header}>
        <h1>Talking Bot — History</h1>
        <BhEnvToggle initialEnv={bhEnv} />
      </div>

      {/* Outbound no-show calls */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Outbound no-show calls ({calls.length})</h2>
        <p className={styles.sectionHint}>
          Each call started from a 6-digit WhatsApp message. Expand a row for the AI
          transcript (pulled live from Telnyx).
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>From (sender)</th>
                <th>Customer</th>
                <th>Customer phone</th>
                <th>Status</th>
                <th>Outcome</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.empty}>
                    No calls recorded yet.
                  </td>
                </tr>
              ) : (
                calls.map((c: CallRow) => (
                  <ExpandableRow
                    key={c.id}
                    totalCols={8}
                    query={`callControlId=${encodeURIComponent(c.call_control_id ?? "")}`}
                  >
                    <td>{fmt(c.created_at)}</td>
                    <td>{c.order_number}</td>
                    <td>{c.originating_phone ?? "—"}</td>
                    <td>{c.customer_name ?? "—"}</td>
                    <td>{c.customer_phone ?? "—"}</td>
                    <td>
                      <span className={`${styles.badge} ${cls("status", c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className={cls("outcome", c.outcome)}>
                      {c.outcome ?? <span className={styles.muted}>—</span>}
                    </td>
                  </ExpandableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Inbound support calls */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Inbound support calls ({inbound.length})</h2>
        <p className={styles.sectionHint}>
          Recent conversations with the inbound assistant, pulled live from Telnyx.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Caller</th>
                <th>Last message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inbound.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    No inbound conversations found (or Telnyx not configured).
                  </td>
                </tr>
              ) : (
                inbound.map((conv: InboundConversation) => (
                  <ExpandableRow
                    key={conv.id}
                    totalCols={4}
                    query={`conversationId=${encodeURIComponent(conv.id)}`}
                  >
                    <td>{fmt(conv.createdAt)}</td>
                    <td>{conv.caller ?? "—"}</td>
                    <td>{fmt(conv.lastMessageAt)}</td>
                  </ExpandableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* WhatsApp sends */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>WhatsApp sends ({sends.length})</h2>
        <p className={styles.sectionHint}>
          Summaries and status notifications sent to customers and the ops/guide team.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>To</th>
                <th>Recipient</th>
                <th>Kind</th>
                <th>Channel</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {sends.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    No WhatsApp messages sent yet.
                  </td>
                </tr>
              ) : (
                sends.map((s: WhatsAppSendRow) => (
                  <tr key={s.id}>
                    <td>{fmt(s.created_at)}</td>
                    <td>{s.direction ?? "—"}</td>
                    <td>{s.recipient}</td>
                    <td>{s.kind ?? "—"}</td>
                    <td>{s.channel ?? "—"}</td>
                    <td className={styles.wrapCell}>{s.text ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </>
  );
}
