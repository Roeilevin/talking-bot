import { NextRequest, NextResponse } from "next/server";
import { sendCheckoutNotification } from "@/lib/bein-harim";
import { insertWhatsAppSend } from "@/lib/db";

// Called by the Telnyx AI assistant to forward a customer's request/message to
// the Bein Harim back office. Posts to the BH checkout_notification endpoint so
// the operations team sees it tied to the order. Server-side so the BH-API-KEY
// never leaves the backend.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: notify-office]", body);

    const { order_id, message } = body;

    if (!order_id || !message) {
      return NextResponse.json(
        { error: "Missing 'order_id' or 'message' parameter" },
        { status: 400 }
      );
    }

    const { office_message_id } = await sendCheckoutNotification(
      Number(order_id),
      String(message)
    );

    // Best-effort log for the dashboard (never blocks the call flow).
    await insertWhatsAppSend({
      recipient: "office",
      direction: "outbound",
      kind: "office_notification",
      channel: "bein_harim",
      text: String(message),
      order_number: Number(order_id),
    });

    return NextResponse.json({ ok: true, office_message_id });
  } catch (err) {
    console.error("[Tool: notify-office] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
