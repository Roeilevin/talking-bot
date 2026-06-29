import { NextRequest, NextResponse } from "next/server";
import { notifyTeam } from "@/lib/converto";
import { updateCallOutcome } from "@/lib/db";

// Called by the Telnyx AI assistant to update the guide / operations team
// about the outcome of a customer call. Messages are composed here so they
// are always concise and in Hebrew for the team.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: notify-team]", body);

    const { order_id, customer_name, event, eta, note, team_phone } = body;

    if (!order_id || !event) {
      return NextResponse.json(
        { error: "Missing 'order_id' or 'event' parameter" },
        { status: 400 }
      );
    }

    const who = `הזמנה ${order_id}${customer_name ? ` – ${customer_name}` : ""}`;

    let message: string;
    switch (event) {
      case "coming":
        message = `✅ ${who}: הלקוח בדרך${eta ? `, זמן הגעה משוער: ${eta}` : ""}.`;
        break;
      case "transferred":
        message = `↪️ ${who}: השיחה הועברה לנציג אנושי.${note ? ` ${note}` : ""}`;
        break;
      case "human_request":
        message = `🙋 ${who}: הלקוח מבקש לדבר עם נציג אנושי.${note ? ` ${note}` : ""}`;
        break;
      default:
        message = `ℹ️ ${who}: ${note || event}`;
    }

    // Record the call outcome for the dashboard.
    if (
      event === "coming" ||
      event === "transferred" ||
      event === "human_request"
    ) {
      await updateCallOutcome(Number(order_id), event, eta || note);
    }

    await notifyTeam(team_phone, message);

    return NextResponse.json({ ok: true, message: "Team notified" });
  } catch (err) {
    console.error("[Tool: notify-team] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
