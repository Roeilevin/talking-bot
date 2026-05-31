import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate } from "@/lib/converto";
import { config } from "@/lib/config";

// Inbound assistant tool: caller has a custom / group / church tour inquiry.
// Collect the details and forward them to the operations team on WhatsApp.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: submit-inquiry]", body);

    const {
      inquiry_type,
      tour_details,
      preferred_dates,
      group_size,
      contact_name,
      contact_phone,
      contact_email,
      notes,
    } = body;

    if (!tour_details && !contact_name && !contact_phone) {
      return NextResponse.json(
        { error: "Need at least tour_details and a way to contact the caller" },
        { status: 400 }
      );
    }

    const fields = [
      inquiry_type ? `Type: ${inquiry_type}` : null,
      tour_details ? `Tour: ${tour_details}` : null,
      preferred_dates ? `Dates: ${preferred_dates}` : null,
      group_size ? `Group size: ${group_size}` : null,
      contact_name ? `Contact: ${contact_name}` : null,
      contact_phone ? `Phone: ${contact_phone}` : null,
      contact_email ? `Email: ${contact_email}` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean);

    await sendWhatsAppTemplate(config.opsWhatsAppNumber, "inbound_inquiry", [
      fields.join("; "),
    ]);

    return NextResponse.json({
      ok: true,
      message:
        "Inquiry forwarded to the operations team. Tell the caller someone will get back to them.",
    });
  } catch (err) {
    console.error("[Tool: submit-inquiry] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
