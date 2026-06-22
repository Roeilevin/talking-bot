import { NextRequest, NextResponse } from "next/server";
import { notifyTeam } from "@/lib/converto";
import { getOrderDetails, markOrderNoShow } from "@/lib/bein-harim";
import { startAssistantCall } from "@/lib/telnyx";
import {
  insertCall,
  updateCallStatusByOrder,
  updateCallOutcome,
  getLatestCallOutcome,
  type CallStatus,
} from "@/lib/db";

// The no-show call is retried automatically when the customer can't be reached
// or answers without engaging. This is the TOTAL number of attempts (the first
// call counts as attempt 1), so MAX_CALL_ATTEMPTS = 2 means at most one retry.
const MAX_CALL_ATTEMPTS = 2;

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
    const attempt = Number(params.get("attempt") || "1") || 1;

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

    // Classify the outcome to decide whether to retry the call.
    const noPickup = ["no-answer", "busy", "failed", "canceled"].includes(
      callStatus
    );
    const voicemail =
      callStatus === "completed" && answeredBy.startsWith("machine");
    // The customer answered, but did the assistant get an answer out of them?
    // It records coming / no-show / transferred via its tools; a null outcome
    // means they picked up and didn't engage. `undefined` (DB unavailable) is
    // treated as "can't tell" → no retry, so an outage can't cause a call loop.
    let pickedUpNoAnswer = false;
    if (callStatus === "completed" && !answeredBy.startsWith("machine") && orderNumber) {
      const outcome = await getLatestCallOutcome(Number(orderNumber));
      pickedUpNoAnswer = outcome === null;
    }

    const shouldRetry = noPickup || voicemail || pickedUpNoAnswer;

    // Human-readable reason for the WhatsApp updates, specific to what happened.
    const reasonText = noPickup
      ? `הלקוח לא ענה לשיחה (${callStatus})`
      : voicemail
      ? "התקבל מענה אוטומטי / תא קולי"
      : pickedUpNoAnswer
      ? "הלקוח ענה אך לא נמסר מענה"
      : "";

    // Retry instantly while we still have attempts left. Re-fetch the order so
    // the new call carries fresh dynamic variables, and thread attempt+1 so the
    // next StatusCallback can stop the chain at MAX_CALL_ATTEMPTS.
    if (shouldRetry && attempt < MAX_CALL_ATTEMPTS && orderNumber && teamPhone) {
      try {
        const nextAttempt = attempt + 1;
        const order = await getOrderDetails(Number(orderNumber));
        const call = await startAssistantCall(order, teamPhone, nextAttempt);
        await insertCall({
          call_control_id: call.call_control_id,
          order_number: Number(orderNumber),
          originating_phone: teamPhone,
          customer_name: customerName || undefined,
          customer_phone: order.customer_phone,
          status: "placed",
          tour_date: order.tour_date,
        });
        await notifyTeam(
          teamPhone,
          `🔁 ${who}: ${reasonText} — מתקשרים שוב (ניסיון ${nextAttempt}/${MAX_CALL_ATTEMPTS}).`
        );
        return NextResponse.json({ ok: true, retried: true, attempt: nextAttempt });
      } catch (e) {
        console.error("[Telnyx Webhook] retry failed", e);
        // Fall through to the notifications below.
      }
    }

    // Reached the attempt cap without an answer → automatically mark the order
    // as no-show (same as the assistant's mark_noshow tool) and tell the team.
    if (shouldRetry && attempt >= MAX_CALL_ATTEMPTS && orderNumber) {
      let marked = false;
      try {
        await markOrderNoShow(Number(orderNumber));
        await updateCallOutcome(Number(orderNumber), "no-show");
        marked = true;
      } catch (e) {
        console.error("[Telnyx Webhook] auto no-show failed", e);
      }
      await notifyTeam(
        teamPhone,
        `❌ ${who}: ${reasonText} גם לאחר ${attempt} ניסיונות.` +
          (marked
            ? " ההזמנה סומנה כאי-הגעה (no-show)."
            : " סימון אי-הגעה נכשל — נא לטפל ידנית.")
      );
      return NextResponse.json({ ok: true, no_show: marked });
    }

    // Retryable failure but the retry couldn't be launched (e.g. order lookup
    // or call API error on a non-final attempt) — surface it for manual handling.
    if (shouldRetry) {
      await notifyTeam(
        teamPhone,
        `📵 ${who}: ${reasonText}. ניסיון חוזר נכשל — נא לטפל ידנית.`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telnyx Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
