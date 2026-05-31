import { NextRequest, NextResponse } from "next/server";
import { markOrderNoShow } from "@/lib/bein-harim";
import { sendWhatsAppMessage } from "@/lib/converto";

// Called by Telnyx AI assistant webhook tool to mark an order as no-show
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: mark-noshow]", body);

    const { order_id, customer_phone, message } = body;

    if (!order_id) {
      return NextResponse.json(
        { error: "Missing 'order_id' parameter" },
        { status: 400 }
      );
    }

    await markOrderNoShow(Number(order_id));

    if (customer_phone && message) {
      await sendWhatsAppMessage(customer_phone, message);
    }

    return NextResponse.json({ ok: true, message: `Order ${order_id} marked as no-show` });
  } catch (err) {
    console.error("[Tool: mark-noshow] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
