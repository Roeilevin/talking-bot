import { NextRequest, NextResponse } from "next/server";
import { getOrderDetails } from "@/lib/bein-harim";
import { sendWhatsAppMessage } from "@/lib/converto";
import {
  updateAssistantInstructions,
  formatAssistantInstructions,
  startCall,
  formatPhoneNumber,
} from "@/lib/telnyx";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
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

    // Tour is today — update AI assistant and trigger call
    const instructions = formatAssistantInstructions(order);
    await updateAssistantInstructions(instructions);

    const customerPhone = formatPhoneNumber(order.customer_phone);
    const call = await startCall(customerPhone);

    console.log(
      `[Call Started] Order ${orderNumber}, Customer: ${customerPhone}, Call Control ID: ${call.call_control_id}`
    );

    return NextResponse.json({ ok: true, call_control_id: call.call_control_id });
  } catch (err) {
    console.error("[Converto Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
