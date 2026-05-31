import { NextRequest, NextResponse } from "next/server";
import { markOrderNoShow } from "@/lib/bein-harim";
import { notifyTeam } from "@/lib/converto";

// Called by Telnyx AI assistant webhook tool to mark an order as no-show,
// then notify the guide / operations team.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: mark-noshow]", body);

    const { order_id, customer_name, team_phone } = body;

    if (!order_id) {
      return NextResponse.json(
        { error: "Missing 'order_id' parameter" },
        { status: 400 }
      );
    }

    await markOrderNoShow(Number(order_id));

    const who = `הזמנה ${order_id}${customer_name ? ` – ${customer_name}` : ""}`;
    await notifyTeam(team_phone, `❌ ${who}: סומן כאי-הגעה (no-show).`);

    return NextResponse.json({ ok: true, message: `Order ${order_id} marked as no-show` });
  } catch (err) {
    console.error("[Tool: mark-noshow] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
