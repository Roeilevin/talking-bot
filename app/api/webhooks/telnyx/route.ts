import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.event_type || body.data?.event_type;
    console.log(`[Telnyx Webhook] Event: ${eventType}`, JSON.stringify(body, null, 2));

    // Handle call status events as needed
    switch (eventType) {
      case "call.initiated":
        console.log("[Telnyx] Call initiated");
        break;
      case "call.answered":
        console.log("[Telnyx] Call answered");
        break;
      case "call.hangup":
        console.log("[Telnyx] Call ended");
        break;
      case "call.machine.greeting.ended":
        console.log("[Telnyx] Machine detected");
        break;
      default:
        console.log(`[Telnyx] Unhandled event: ${eventType}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telnyx Webhook Error]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
