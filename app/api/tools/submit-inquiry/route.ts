import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate } from "@/lib/converto";
import { sendMail, isGraphMailConfigured } from "@/lib/graph-mail";
import { config } from "@/lib/config";

// Deliver inquiries to ops by email (info@ shared mailbox). Flip to true to also
// forward them to the ops WhatsApp again — the send below is already wired.
const SEND_WHATSAPP = false;

// Inbound assistant tool: caller has a custom / group / church tour inquiry.
// Collect the details and forward them to the operations team. Currently sent by
// email to the info@ mailbox; WhatsApp forwarding is gated behind SEND_WHATSAPP.
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

    const rows: Array<[string, string]> = [
      ["Type", inquiry_type],
      ["Tour", tour_details],
      ["Dates", preferred_dates],
      ["Group size", group_size],
      ["Contact", contact_name],
      ["Phone", contact_phone],
      ["Email", contact_email],
      ["Notes", notes],
    ].filter(([, v]) => Boolean(v)) as Array<[string, string]>;

    const fields = rows.map(([k, v]) => `${k}: ${v}`);

    // Email is the primary (and currently only) channel. If it fails, tell the
    // agent so it can retry or take the details another way — don't falsely
    // promise a follow-up.
    if (!isGraphMailConfigured()) {
      console.error("[Tool: submit-inquiry] Graph mail not configured");
      return NextResponse.json(
        {
          ok: false,
          error: "email_not_configured",
          message:
            "Could not forward the inquiry right now. Ask the caller to email info@beinharimtours.com directly, or try again shortly.",
        },
        { status: 502 }
      );
    }

    const subject = `New tour inquiry${contact_name ? ` — ${contact_name}` : ""}${
      inquiry_type ? ` (${inquiry_type})` : ""
    }`;
    const bodyHtml = `<p>New tour inquiry received via the phone assistant:</p>
<ul>${rows.map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(v)}</li>`).join("")}</ul>`;

    try {
      await sendMail({
        to: config.microsoft.senderMailbox,
        subject,
        bodyHtml,
        bodyText: fields.join("\n"),
      });
    } catch (mailErr) {
      console.error("[Tool: submit-inquiry] email send failed", mailErr);
      return NextResponse.json(
        {
          ok: false,
          error: "email_send_failed",
          message:
            "Could not forward the inquiry right now. Apologize, and ask the caller to email info@beinharimtours.com directly or try again shortly.",
        },
        { status: 502 }
      );
    }

    // Optional secondary channel — off by default (see SEND_WHATSAPP).
    if (SEND_WHATSAPP) {
      try {
        await sendWhatsAppTemplate(config.opsWhatsAppNumber, "inbound_inquiry", [
          fields.join("; "),
        ]);
      } catch (waErr) {
        console.error("[Tool: submit-inquiry] WhatsApp forward failed", waErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message:
        "Inquiry emailed to the operations team. Tell the caller someone will get back to them.",
    });
  } catch (err) {
    console.error("[Tool: submit-inquiry] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
