import { NextRequest, NextResponse } from "next/server";
import { getOrderDetails } from "@/lib/bein-harim";
import { sendWhatsAppMessage, notifyTeam, verifyConvertoSignature } from "@/lib/converto";
import { startAssistantCall } from "@/lib/telnyx";
import { insertCall, isPhoneAllowed } from "@/lib/db";

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

    // Enforce the sender allowlist (managed at /allowed-numbers). Only numbers
    // on the active list may trigger a call. `null` = enforcement unavailable
    // (Supabase down/unconfigured) → fail open so the bot keeps working.
    const allowed = await isPhoneAllowed(senderPhone);
    if (allowed === false) {
      await sendWhatsAppMessage(
        senderPhone,
        "You are not allowed to use this service. Please contact the administrator to be added to the approved list."
      );
      return NextResponse.json({ ok: true, reason: "not_allowed" });
    }

    const orderNumber = parseInt(messageText, 10);

    // Fetch order details from Bein Harim
    const order = await getOrderDetails(orderNumber);

    // Check if tour date is today
    const today = new Date().toISOString().split("T")[0];
    if (order.tour_date !== today) {
      await sendWhatsAppMessage(
        senderPhone,
        `This order's tour date (${order.tour_date}) is not today. Please check the order number.`
      );
      return NextResponse.json({ ok: true, reason: "tour_date_mismatch" });
    }

    // Tour is today — trigger AI assistant call with order details as dynamic
    // variables. Status updates go back to whoever requested the call.
    const call = await startAssistantCall(order, senderPhone);

    console.log(
      `[Call Started] Order ${orderNumber}, Customer: ${order.customer_phone}, Call Control ID: ${call.call_control_id}`
    );

    const customerName = `${order.customer_first_name} ${order.customer_last_name}`;

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

    await notifyTeam(
      senderPhone,
      `📞 הזמנה ${orderNumber} – ${customerName}: מתקשרים ללקוח.\n` +
        `סיור ${order.tour_date}, איסוף ${order.pickup_hotel} ${order.pickup_city} בשעה ${order.pickup_time}.`
    );

    return NextResponse.json({ ok: true, call_control_id: call.call_control_id });
  } catch (err) {
    console.error("[Converto Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
