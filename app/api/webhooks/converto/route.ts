import { NextRequest, NextResponse } from "next/server";
import { getOrderDetails, OrderNotFoundError } from "@/lib/bein-harim";
import { sendWhatsAppMessage, notifyTeam, verifyConvertoSignature } from "@/lib/converto";
import { startAssistantCall } from "@/lib/telnyx";
import { insertCall, isPhoneAllowed } from "@/lib/db";

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

    const message = body.message;
    if (!message || message.type !== "text" || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const messageText: string = message.text.trim();
    const senderPhone: string = message.from;

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
        `📞 הזמנה ${orderNumber} – ${customerName}: מתקשרים ללקוח.\n` +
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
