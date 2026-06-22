import { NextRequest, NextResponse } from "next/server";
import { notifyTeam } from "@/lib/converto";
import { updateCallStatusByOrder, type CallStatus } from "@/lib/db";

// Receives the per-call TeXML StatusCallback. Order context is carried in the
// query string (set in startAssistantCall) so we can tell the ops team which
// customer didn't pick up. Answered-call outcomes (coming / no-show /
// transferred) are reported by the AI assistant tools, not here.
// Map a TeXML CallStatus (+ AnsweredBy) to our stored call status enum.
// Returns null for transient statuses we don't persist (e.g. ringing/in-progress).
function mapCallStatus(
  callStatus: string,
  answeredBy: string
): CallStatus | null {
  if (["no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
    return callStatus === "canceled" ? "failed" : (callStatus as CallStatus);
  }
  if (callStatus === "completed") {
    return answeredBy.startsWith("machine") ? "voicemail" : "completed";
  }
  return null;
}

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

    // Persist the call outcome for the dashboard FIRST (best-effort, never throws)
    // so a WhatsApp notification failure can't lose the status. Map TeXML → enum.
    const mappedStatus = mapCallStatus(callStatus, answeredBy);
    if (orderNumber && mappedStatus) {
      await updateCallStatusByOrder(Number(orderNumber), mappedStatus);
    }

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
