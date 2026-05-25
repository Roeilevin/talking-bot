import { NextRequest, NextResponse } from "next/server";
import { markOrderNoShow } from "@/lib/bein-harim";

// Called by Telnyx AI assistant webhook tool to mark an order as no-show
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[Tool: mark-noshow]", body);

    const { order_id } = body;

    if (!order_id) {
      return NextResponse.json(
        { error: "Missing 'order_id' parameter" },
        { status: 400 }
      );
    }

    await markOrderNoShow(Number(order_id));

    return NextResponse.json({ ok: true, message: `Order ${order_id} marked as no-show` });
  } catch (err) {
    console.error("[Tool: mark-noshow] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
