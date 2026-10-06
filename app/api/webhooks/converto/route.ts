import { NextRequest, NextResponse } from "next/server";
import {
  ensureOrderStatus,
  getOrderDetails,
  OrderNotFoundError,
  sendCheckoutNotification,
} from "@/lib/bein-harim";
import { sendWhatsAppMessage, notifyTeam, verifyConvertoSignature } from "@/lib/converto";
import { config } from "@/lib/config";
import {
  GUIDE_JOINED_BUTTON,
  GUIDE_NOSHOW_KIND,
  readGuideJoined,
} from "@/lib/guide-alert";
import { startAssistantCall } from "@/lib/telnyx";
import {
  findRecentSendOrder,
  insertCall,
  isPhoneAllowed,
  updateCallOutcome,
} from "@/lib/db";

// How far back a tapped "התייר הצטרף" may refer. The alert goes out on the day
// of the tour, so a day is generous — anything older is someone scrolling up,
// and must not re-open a closed order.
const GUIDE_REPLY_WINDOW_HOURS = 24;

// Run a notification without letting it fail the request. A messaging error must
// never escalate a handled failure into a 500: Converto retries 5xx deliveries,
// and on the success path a retry would place a *second* call to the customer.
async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[Converto Webhook] ${label} failed`, e);
  }
}

// Providers report failures as a JSON body tacked onto the thrown Error, e.g.
// `403 {"errors":[{"code":10010,"detail":"...whitelisted countries D13..."}]}`.
// Surface just the readable part so a misconfiguration is diagnosable from the
// WhatsApp notice alone, without opening the Vercel logs.
function describeFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const start = raw.indexOf("{");
  if (start !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start));
      const first = parsed?.errors?.[0];
      const detail: string | undefined = first?.detail || first?.title;
      if (detail) {
        const code = parsed?.telnyx_error?.error_code ?? first?.code;
        return (code ? `${detail} (${code})` : detail).slice(0, 400);
      }
    } catch {
      // Not a JSON-carrying provider error — fall through to the raw message.
    }
  }
  return raw.slice(0, 400);
}

// Shapes an inbound WhatsApp message arrives in. A tapped template button comes
// back as a reply carrying the button's text, but which field holds it depends
// on the message type — `button` for a template quick reply,
// `interactive.button_reply` for an interactive one, plain text when the guide
// typed the words instead — so read all of them.
interface InboundMessage {
  type?: string;
  from?: string;
  text?: string | { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

// The button's machine id, when the tap carried one. Read separately from the
// visible text because only the id pins the reply to an order.
function readButtonPayload(message: InboundMessage): string {
  return String(
    message.button?.payload || message.interactive?.button_reply?.id || ""
  ).trim();
}

function readMessageText(message: InboundMessage): string {
  const raw =
    (typeof message.text === "string" ? message.text : message.text?.body) ||
    message.button?.text ||
    message.button?.payload ||
    message.interactive?.button_reply?.title ||
    message.interactive?.button_reply?.id ||
    "";
  return String(raw).trim();
}

// A guide answered a no-show alert with "התייר הצטרף": the traveller did board
// after all. Which order that refers to comes from the alert we sent that same
// number — it is logged with the order number, so nothing extra is tracked.
//
// The correction is the order status going back to `approved` (BH_SHOW_STATUS)
// — the same call the office would make by hand. A back-office message goes out
// alongside it as the audit trail, and carries the "do this manually" ask if the
// status change failed.
async function handleGuideJoined(
  senderPhone: string,
  replyText: string,
  fromPayload: number | null
): Promise<NextResponse> {
  // An interactive button carries the order in its id, so it needs no lookup.
  // A template quick reply carries only its text — then fall back to the alert
  // we sent this number (logged with the order number).
  const orderNumber =
    fromPayload ??
    (await findRecentSendOrder(
      senderPhone,
      GUIDE_NOSHOW_KIND,
      GUIDE_REPLY_WINDOW_HOURS
    ));

  if (!orderNumber) {
    console.warn(
      `[Converto Webhook] guide-joined reply from ${senderPhone} matched no recent alert`
    );
    await bestEffort("guide-joined unmatched notice", () =>
      notifyTeam(
        undefined,
        `👤 מדריך (${senderPhone}) דיווח "${replyText}" אך לא נמצאה התראת אי-הגעה מתאימה מ-24 השעות האחרונות — נא לטפל ידנית.`
      )
    );
    await bestEffort("guide-joined unmatched reply", () =>
      sendWhatsAppMessage(
        senderPhone,
        "לא הצלחנו לזהות לאיזו הזמנה ההודעה מתייחסת. נא לפנות למשרד עם מספר ההזמנה."
      )
    );
    return NextResponse.json({ ok: true, reason: "guide_joined_unmatched" });
  }

  // Correct the dashboard first: it is the record that survives a messaging
  // failure, and "coming" is exactly what the guide is reporting.
  await updateCallOutcome(orderNumber, "coming", `המדריך דיווח: ${replyText}`);

  // Put the order back the way it was BEFORE telling anyone: the status is the
  // thing that decides whether the traveller is treated as a no-show, and the
  // office message below reports on whether this worked.
  // BH can refuse the change on business grounds — an unpaid booking answers
  // 400 "Order can not be approved: Booking payment status should not be - Not
  // Completed". That is not our bug to swallow: the reason travels into the
  // office message and the ops update so somebody can act on it.
  let statusReverted = false;
  let alreadyThere = false;
  let revertError = "";
  try {
    const { changed } = await ensureOrderStatus(orderNumber, config.beinHarim.showStatus);
    statusReverted = true;
    alreadyThere = !changed;
  } catch (e) {
    revertError = (e instanceof Error ? e.message : String(e))
      .replace(/^Bein Harim API error: \d+ /, "")
      .slice(0, 300);
    console.error("[Converto Webhook] guide-joined status revert failed", e);
  }

  let officeNotified = false;
  await bestEffort("guide-joined office notification", async () => {
    await sendCheckoutNotification(
      orderNumber,
      statusReverted
        ? `המדריך דיווח שהנוסע הצטרף לטיול בפועל — סטטוס ההזמנה הוחזר ל-${config.beinHarim.showStatus}.`
        : `המדריך דיווח שהנוסע הצטרף לטיול בפועל — החזרת הסטטוס נכשלה${
            revertError ? ` (${revertError})` : ""
          }, יש לבטל את סימון אי-ההגעה (no-show) בהזמנה ${orderNumber} ידנית.`
    );
    officeNotified = true;
  });

  console.log(
    `[Guide Joined] order=${orderNumber} guide=${senderPhone} office=${officeNotified} status_reverted=${statusReverted}`
  );

  await bestEffort("guide-joined ops notice", () =>
    notifyTeam(
      undefined,
      `✅ הזמנה ${orderNumber}: המדריך (${senderPhone}) דיווח שהתייר הצטרף לטיול.` +
        (statusReverted
          ? alreadyThere
            ? ` סטטוס ההזמנה כבר היה ${config.beinHarim.showStatus} — לא נדרש שינוי.`
            : ` סטטוס ההזמנה הוחזר ל-${config.beinHarim.showStatus}.`
          : officeNotified
          ? ` ⚠️ החזרת הסטטוס נכשלה${
              revertError ? `: ${revertError}` : ""
            } — נשלחה בקשה למשרד לבטל את סימון אי-ההגעה.`
          : " ⚠️ החזרת הסטטוס נכשלה וגם עדכון המשרד נכשל — נא לטפל ידנית.")
    )
  );

  await bestEffort("guide-joined ack", () =>
    sendWhatsAppMessage(
      senderPhone,
      `תודה! עדכנו שהתייר הצטרף לטיול בהזמנה ${orderNumber}.`,
      { direction: "ops", kind: "guide_joined_ack", orderNumber }
    )
  );

  return NextResponse.json({
    ok: true,
    guide_joined: true,
    order_number: orderNumber,
  });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify webhook signature
    const signature = req.headers.get("X-Converto-Signature");
    if (!verifyConvertoSignature(rawBody, signature)) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const eventType = req.headers.get("X-Converto-Event");

    console.log(`[Converto Webhook] Event: ${eventType}`, rawBody);

    // Only handle inbound messages
    if (eventType !== "message") {
      return NextResponse.json({ ok: true });
    }

    const message: InboundMessage | undefined = body.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const senderPhone: string = message.from || "";
    const messageText = readMessageText(message);
    if (!senderPhone || !messageText) {
      return NextResponse.json({ ok: true });
    }

    // A guide answering a no-show alert — checked before the 6-digit branch
    // because it arrives from a number that is NOT on the caller allowlist: the
    // authorisation is that we messaged that number about this order minutes
    // ago, and the only thing the reply can do is flag a wrongly-marked order.
    // Prefer the button id ("guide_joined:394118") — it names the order. The
    // visible text ("התייר הצטרף") is the fallback, and covers a template
    // quick reply, which carries no payload at all.
    const byPayload = readGuideJoined(readButtonPayload(message));
    const guideJoined = byPayload.joined ? byPayload : readGuideJoined(messageText);
    if (guideJoined.joined) {
      // The payload id is machine text ("guide_joined:394118") — report the
      // button's own wording back to ops instead.
      return await handleGuideJoined(
        senderPhone,
        byPayload.joined ? GUIDE_JOINED_BUTTON : messageText,
        guideJoined.orderNumber
      );
    }

    // Must be exactly 6 digits (order number)
    if (!/^\d{6}$/.test(messageText)) {
      return NextResponse.json({ ok: true, reason: "not_6_digits" });
    }

    const orderNumber = parseInt(messageText, 10);

    // Enforce the sender allowlist (managed at /allowed-numbers). Only numbers
    // on the active list may trigger a call. `null` = enforcement unavailable
    // (Supabase down/unconfigured) → fail open so the bot keeps working.
    const allowed = await isPhoneAllowed(senderPhone);
    if (allowed === false) {
      await bestEffort("not-allowed reply", () =>
        sendWhatsAppMessage(
          senderPhone,
          "You are not allowed to use this service. Please contact the administrator to be added to the approved list.",
          { orderNumber }
        )
      );
      return NextResponse.json({ ok: true, reason: "not_allowed" });
    }

    // Fetch order details from Bein Harim. An unknown order number is the
    // sender's mistake (or an order living in the other BH environment), so
    // tell them rather than failing the webhook silently.
    let order;
    try {
      order = await getOrderDetails(orderNumber);
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        await bestEffort("order-not-found reply", () =>
          sendWhatsAppMessage(
            senderPhone,
            `Order ${orderNumber} was not found. Please check the order number and try again.`,
            { orderNumber }
          )
        );
        return NextResponse.json({ ok: true, reason: "order_not_found" });
      }

      // Not a bad order number but a BH outage or misconfiguration (auth
      // failure, wrong base URL, timeout). The requester is standing at a
      // pickup waiting for a call that will never be placed — say so.
      console.error(`[Order Lookup Failed] Order ${orderNumber}`, err);
      await bestEffort("lookup-failure notice", () =>
        notifyTeam(
          senderPhone,
          `⚠️ הזמנה ${orderNumber}: לא ניתן לשלוף את פרטי ההזמנה כרגע.\n` +
            `סיבה: ${describeFailure(err)}`
        )
      );
      return NextResponse.json({ ok: false, reason: "order_lookup_failed" });
    }

    // Check if tour date is today
    const today = new Date().toISOString().split("T")[0];
    if (order.tour_date !== today) {
      await bestEffort("date-mismatch reply", () =>
        sendWhatsAppMessage(
          senderPhone,
          `This order's tour date (${order.tour_date}) is not today. Please check the order number.`,
          { orderNumber }
        )
      );
      return NextResponse.json({ ok: true, reason: "tour_date_mismatch" });
    }

    const customerName = `${order.customer_first_name} ${order.customer_last_name}`;

    // Tour is today — trigger AI assistant call with order details as dynamic
    // variables. Status updates go back to whoever requested the call.
    let call;
    try {
      call = await startAssistantCall(order, senderPhone);
    } catch (err) {
      // The call never got off the ground: destination country missing from the
      // Telnyx outbound profile, no balance, unusable customer number. This used
      // to escape to the outer catch as a bare 500 — no reply, no dashboard row,
      // and Converto retrying the same doomed delivery three times. Report it to
      // the requester and record the attempt instead.
      console.error(`[Call Failed] Order ${orderNumber}`, err);

      await insertCall({
        order_number: orderNumber,
        originating_phone: senderPhone,
        customer_name: customerName,
        customer_phone: order.customer_phone,
        status: "failed",
        tour_date: order.tour_date,
      });

      await bestEffort("call-failure notice", () =>
        notifyTeam(
          senderPhone,
          `⚠️ הזמנה ${orderNumber} – ${customerName}: לא ניתן להתקשר ללקוח (${order.customer_phone}).\n` +
            `סיבה: ${describeFailure(err)}`
        )
      );

      // 200, not 500: the failure is handled and reported, and replaying an
      // identical request only reproduces the identical failure.
      return NextResponse.json({ ok: false, reason: "call_failed" });
    }

    console.log(
      `[Call Started] Order ${orderNumber}, Customer: ${order.customer_phone}, Call Control ID: ${call.call_control_id}`
    );

    // Record the call (and the originating 6-digit WhatsApp message via
    // originating_phone + order_number + created_at). Best-effort; never throws.
    await insertCall({
      call_control_id: call.call_control_id,
      order_number: orderNumber,
      originating_phone: senderPhone,
      customer_name: customerName,
      customer_phone: order.customer_phone,
      status: "placed",
      tour_date: order.tour_date,
    });

    // Best-effort: the call is already ringing, so a messaging hiccup must not
    // produce a 500 that has Converto replay the delivery and dial the customer
    // a second time.
    await bestEffort("call-started notice", () =>
      notifyTeam(
        senderPhone,
        `📞 הזמנה ${orderNumber} – ${customerName}: מתקשרים ללקוח (${order.customer_phone}).\n` +
          `סיור ${order.tour_date}, איסוף ${order.pickup_hotel} ${order.pickup_city} בשעה ${order.pickup_time}.`
      )
    );

    return NextResponse.json({ ok: true, call_control_id: call.call_control_id });
  } catch (err) {
    // Genuinely unexpected (malformed payload, Supabase down mid-request). Left
    // as a 500 so it surfaces in Vercel's error tracking and Converto retries —
    // every failure we can attribute is handled above and answers 200.
    console.error("[Converto Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
