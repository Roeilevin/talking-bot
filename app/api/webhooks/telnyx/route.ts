import { NextRequest, NextResponse } from "next/server";
import { notifyTeam } from "@/lib/converto";

// Receives the per-call TeXML StatusCallback. Order context is carried in the
// query string (set in startAssistantCall) so we can tell the ops team which
// customer didn't pick up. Answered-call outcomes (coming / no-show /
// transferred) are reported by the AI assistant tools, not here.
export async function POST(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const orderNumber = params.get("order_number") || "";
    const customerName = params.get("customer_name") || "";
    const teamPhone = params.get("team_phone") || undefined;

    // TeXML status callbacks are form-encoded; call-control events are JSON.
    let callStatus = "";
    let answeredBy = "";
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      callStatus = body.CallStatus || body.data?.payload?.state || "";
      answeredBy = body.AnsweredBy || "";
    } else {
      const form = await req.formData();
      callStatus = String(form.get("CallStatus") || "");
      answeredBy = String(form.get("AnsweredBy") || "");
    }

    console.log(
      `[Telnyx Webhook] order=${orderNumber} status=${callStatus} answeredBy=${answeredBy}`
    );

    const who = `הזמנה ${orderNumber}${customerName ? ` – ${customerName}` : ""}`;

    if (["no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
      await notifyTeam(teamPhone, `📵 ${who}: הלקוח לא ענה לשיחה (${callStatus}).`);
    } else if (callStatus === "completed" && answeredBy.startsWith("machine")) {
      await notifyTeam(teamPhone, `📭 ${who}: התקבל מענה אוטומטי / תא קולי.`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telnyx Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
