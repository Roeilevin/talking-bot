import { NextRequest, NextResponse } from "next/server";
import { addOrderComment, markOrderNoShow } from "@/lib/bein-harim";
import { notifyTeam } from "@/lib/converto";
import { alertGuideOfNoShow, describeGuideAlert } from "@/lib/guide-alert";
import { updateCallOutcome } from "@/lib/db";

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
    await updateCallOutcome(Number(order_id), "no-show");

    // Tell the guide running that day's tour, so a traveller who did board can
    // be reported back with one tap. Never throws — see lib/guide-alert.ts.
    const guideAlert = await alertGuideOfNoShow(Number(order_id));

    const who = `הזמנה ${order_id}${customer_name ? ` – ${customer_name}` : ""}`;
    await addOrderComment(Number(order_id), `❌ ${who}: הלקוח אמר שלא יגיע — סומן כאי-הגעה (no-show).`);
    await notifyTeam(
      team_phone,
      `❌ ${who}: סומן כאי-הגעה (no-show).${describeGuideAlert(guideAlert)}`
    );

    return NextResponse.json({
      ok: true,
      message: `Order ${order_id} marked as no-show`,
      guide_notified: guideAlert.status === "sent",
    });
  } catch (err) {
    console.error("[Tool: mark-noshow] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
