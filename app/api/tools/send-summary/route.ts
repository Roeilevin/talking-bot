import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate } from "@/lib/converto";

// Called by the inbound AI assistant at the end of a support call to send
// a short WhatsApp summary to the caller (or fall back to ops).
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: send-summary]", body);

    const { to, summary } = body;
    if (!to || !summary) {
      return NextResponse.json(
        { error: "Missing 'to' or 'summary' parameter" },
        { status: 400 }
      );
    }

    const normalized = String(to).replace(/[^0-9]/g, "");
    await sendWhatsAppTemplate(normalized, "call_summary", [summary]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Tool: send-summary] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
