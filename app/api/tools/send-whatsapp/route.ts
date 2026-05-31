import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "@/lib/converto";
import { config } from "@/lib/config";

// Called by Telnyx AI assistant webhook tool to send a WhatsApp message
// with the customer's ETA or other info
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: send-whatsapp]", body);

    const { to, text } = body;

    if (!to || !text) {
      return NextResponse.json(
        { error: "Missing 'to' or 'text' parameter" },
        { status: 400 }
      );
    }

    await sendWhatsAppMessage(to, text);

    return NextResponse.json({ ok: true, message: "WhatsApp message sent" });
  } catch (err) {
    console.error("[Tool: send-whatsapp] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
