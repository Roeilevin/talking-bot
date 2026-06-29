import { NextRequest, NextResponse } from "next/server";
import { sendMail, type MailAttachment } from "@/lib/graph-mail";
import { normalizeEmail } from "@/lib/email";
import { renderBrandedEmail } from "@/lib/email-template";
import { getOrderDetails } from "@/lib/bein-harim";
import { insertWhatsAppSend } from "@/lib/db";

// Inbound assistant tool: deliver content to the caller by EMAIL — the fallback
// channel for callers who don't use WhatsApp. Sent from the info@ shared mailbox
// via Microsoft Graph (app-only), so it lands in Outlook Sent. The agent composes
// the subject/body; we validate the address, optionally attach the voucher PDF,
// send, and log to the dashboard.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: send-email]", body);

    const { to_email, subject, body: message } = body;
    if (!to_email || !subject || !message) {
      return NextResponse.json(
        { error: "Missing 'to_email', 'subject', or 'body'" },
        { status: 400 }
      );
    }

    const normalized = normalizeEmail(String(to_email));
    if (!normalized) {
      return NextResponse.json({
        action: "invalid_email",
        message:
          "That email address isn't valid. Ask the caller to spell it slowly, letter by letter, read it back to confirm, then call send_email again.",
      });
    }

    // A domain typo was auto-corrected — don't send yet. Have the agent read the
    // suggestion back and re-call with the confirmed address (which won't trigger
    // another correction, so it sends).
    if (normalized.corrected) {
      return NextResponse.json({
        action: "confirm_email",
        suggested_email: normalized.email,
        message: `The address may have a typo. Confirm with the caller that they mean ${normalized.email} (read it back), then call send_email again with to_email set to that confirmed address.`,
      });
    }

    // Optionally attach the booking voucher PDF (best-effort).
    const attachments: MailAttachment[] = [];
    const orderId = body.order_id ? String(body.order_id).replace(/\D/g, "") : "";
    if (body.attach_voucher && orderId) {
      try {
        const order = await getOrderDetails(Number(orderId));
        if (order.pdf_link) {
          const pdfRes = await fetch(order.pdf_link);
          if (pdfRes.ok) {
            const buf = Buffer.from(await pdfRes.arrayBuffer());
            attachments.push({
              name: `BeinHarim-Voucher-${orderId}.pdf`,
              contentType: "application/pdf",
              contentBytes: buf.toString("base64"),
            });
          }
        }
      } catch (e) {
        console.warn("[Tool: send-email] voucher attach failed", e);
      }
    }

    const { html, text } = renderBrandedEmail(String(subject), String(message));

    await sendMail({
      to: normalized.email,
      subject: String(subject),
      bodyHtml: html,
      bodyText: text,
      attachments,
    });

    // Best-effort dashboard log (reuses the sends table; channel = "email").
    await insertWhatsAppSend({
      recipient: normalized.email,
      direction: "customer",
      kind: attachments.length ? "email:voucher" : "email",
      text: `${subject}\n\n${String(message)}`,
      channel: "email",
      order_number: orderId ? Number(orderId) : null,
    });

    return NextResponse.json({
      action: "sent",
      to: normalized.email,
      attached_voucher: attachments.length > 0,
      message: `Sent the email to ${normalized.email}. Tell the caller it's on its way (ask them to check spam if it doesn't arrive) and confirm there's nothing else.`,
    });
  } catch (err) {
    console.error("[Tool: send-email] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
