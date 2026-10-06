import { getOrderDetails, guideForDate, type OrderDetails } from "./bein-harim";
import {
  sendWhatsAppButtons,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
} from "./converto";
import { normalizePhone } from "./db";
import { alreadySent, markSent, releaseSend, sendKey } from "./send-once";

// Everything the guide-facing no-show alert is keyed on. The `kind` is what
// links an inbound button reply back to an order: the send is logged in
// talking_bot_whatsapp_sends with this kind + the order number, so the Converto
// webhook can resolve "who tapped the button" without a new table (see
// findRecentSendOrder in lib/db.ts).
export const GUIDE_NOSHOW_KIND = "guide_noshow_alert";
export const GUIDE_NOSHOW_TEMPLATE = "guide_noshow_alert";
export const GUIDE_NOSHOW_TEMPLATE_LANG = "he";

// The quick-reply button on that template. WhatsApp delivers a tapped quick
// reply as an ordinary inbound message carrying the button's text, so this one
// string is both what the guide sees and what we match on the way back.
export const GUIDE_JOINED_BUTTON = "התייר הצטרף";

// Tolerate the near-misses of a guide who typed the answer instead of tapping:
// quotes, trailing punctuation, and the two other obvious phrasings.
const JOINED_PATTERNS = [
  /^התייר\s+הצטרף$/,
  /^התייר\s+הגיע$/,
  /^הנוסע\s+הצטרף$/,
  /^הנוסע\s+הגיע$/,
];

// Id put on the interactive button. A tap comes back carrying it, which pins
// the reply to one order exactly — no lookup, no ambiguity. Template quick
// replies carry no payload (Converto's send_template accepts none), so the
// phone-based lookup in the webhook stays as the fallback.
export const GUIDE_JOINED_PAYLOAD = "guide_joined";

export function guideJoinedButtonId(orderNumber: number): string {
  return `${GUIDE_JOINED_PAYLOAD}:${orderNumber}`;
}

// Did this inbound message report that the traveller joined — and if the button
// carried an order number, which one? Covers the payload id, the button text,
// and a guide who typed the words instead.
export function readGuideJoined(text: string): {
  joined: boolean;
  orderNumber: number | null;
} {
  const raw = String(text ?? "").trim();
  const payload = raw.match(/^guide_joined(?::(\d+))?$/);
  if (payload) {
    return { joined: true, orderNumber: payload[1] ? Number(payload[1]) : null };
  }
  return { joined: isGuideJoinedText(raw), orderNumber: null };
}

export function isGuideJoinedText(text: string): boolean {
  const clean = String(text ?? "")
    .replace(/[."'״׳!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return JOINED_PATTERNS.some((re) => re.test(clean));
}

export type GuideAlertResult =
  | {
      status: "sent";
      channel: "template" | "buttons" | "session";
      phone: string;
      guideName: string;
    }
  | { status: "skipped"; reason: "duplicate" | "no_guide_phone" | "no_days"; guideName: string }
  | { status: "failed"; reason: string; phone: string; guideName: string };

function travellerName(order: OrderDetails): string {
  return (
    `${order.customer_first_name ?? ""} ${order.customer_last_name ?? ""}`.trim() ||
    "הנוסע"
  );
}

// What the guide reads when the template can't be used (i.e. there is an open
// 24h session, or the template isn't approved yet). Mirrors the template body
// so the guide gets the same instruction either way.
function sessionText(
  order: OrderDetails,
  traveller: string,
  ask: "button" | "text"
): string {
  return (
    `❌ הזמנה ${order.order_number} – ${traveller} סומנה כאי-הגעה (no-show).\n` +
    `סיור ${order.tour_date}, איסוף ${order.pickup_hotel} ${order.pickup_city} בשעה ${order.pickup_time}.\n\n` +
    `אם הנוסע/ת בכל זאת הצטרף/ה לטיול, ` +
    (ask === "button"
      ? `יש ללחוץ על הכפתור למטה ונעדכן את המשרד.`
      : `יש להשיב "${GUIDE_JOINED_BUTTON}" ונעדכן את המשרד.`)
  );
}

// Tell the day's guide that an order was marked no-show, so a traveller who
// actually did board can be reported back with one tap.
//
// Business-initiated, so the approved template is tried FIRST (the guide almost
// never has an open 24h session) and free text is the fallback — the reverse of
// sendCallerMessage, which answers callers who just hung up. Never throws: a
// messaging failure must not undo a no-show that is already recorded.
export async function alertGuideOfNoShow(
  orderNumber: number,
  preloaded?: OrderDetails
): Promise<GuideAlertResult> {
  let order = preloaded;
  if (!order) {
    try {
      order = await getOrderDetails(orderNumber);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[guide-alert] order ${orderNumber} lookup failed`, e);
      return { status: "failed", reason, phone: "", guideName: "" };
    }
  }

  const guide = guideForDate(order);
  const guideName = (guide?.name || "").trim();
  if (!order.days || order.days.length === 0) {
    return { status: "skipped", reason: "no_days", guideName };
  }

  const phone = normalizePhone(guide?.phone || "");
  if (!phone) {
    return { status: "skipped", reason: "no_guide_phone", guideName };
  }

  // The same no-show can arrive twice (assistant tool + status-callback race);
  // the guide should be told once.
  const key = sendKey(phone, GUIDE_NOSHOW_KIND, [order.order_number]);
  if (alreadySent(key)) {
    return { status: "skipped", reason: "duplicate", guideName };
  }
  markSent(key);

  const traveller = travellerName(order);
  const meta = {
    direction: "ops" as const,
    kind: GUIDE_NOSHOW_KIND,
    orderNumber: order.order_number,
  };

  try {
    await sendWhatsAppTemplate(
      phone,
      GUIDE_NOSHOW_TEMPLATE,
      [guideName || "מדריך/ה", String(order.order_number), traveller],
      GUIDE_NOSHOW_TEMPLATE_LANG,
      meta
    );
    return { status: "sent", channel: "template", phone, guideName };
  } catch (err) {
    console.warn(
      `[guide-alert] template failed for order ${order.order_number}: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  // Refused (not approved yet, or a session is already open): keep the tap if we
  // can — an interactive message carries real buttons, but Meta allows it only
  // inside the 24h window, so plain text is the last resort.
  try {
    await sendWhatsAppButtons(
      phone,
      sessionText(order, traveller, "button"),
      [{ id: guideJoinedButtonId(order.order_number), title: GUIDE_JOINED_BUTTON }],
      meta
    );
    return { status: "sent", channel: "buttons", phone, guideName };
  } catch (err) {
    console.warn(
      `[guide-alert] interactive send failed for order ${order.order_number}: ` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  try {
    await sendWhatsAppMessage(phone, sessionText(order, traveller, "text"), meta);
    return { status: "sent", channel: "session", phone, guideName };
  } catch (err) {
    releaseSend(key); // nothing reached the guide — let a retry through
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[guide-alert] send failed for order ${order.order_number}`, err);
    return { status: "failed", reason, phone, guideName };
  }
}

// One Hebrew line about the guide alert, appended to the ops WhatsApp update so
// the team can see at a glance whether the guide was actually reached.
export function describeGuideAlert(result: GuideAlertResult): string {
  const who = result.guideName ? ` (${result.guideName})` : "";
  switch (result.status) {
    case "sent":
      return `\n👤 המדריך${who} עודכן בוואטסאפ.`;
    case "skipped":
      if (result.reason === "duplicate") return "";
      return `\n⚠️ לא נמצא טלפון מדריך בהזמנה${who} — המדריך לא עודכן.`;
    case "failed":
      return `\n⚠️ עדכון המדריך${who} נכשל: ${result.reason.slice(0, 200)}`;
  }
}
