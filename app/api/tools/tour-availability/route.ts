import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate } from "@/lib/converto";
import {
  getTourAvailability,
  summarizeForVoice,
  listForWhatsApp,
  type AvailabilityParams,
} from "@/lib/tour-availability";

// Inbound assistant tool: caller asks what tours are available. We resolve their
// free-text criteria (destination/pickup/type/language/dates) to the BH
// /api/v2/tours filters, do the area+language filtering the API can't, and hand
// the assistant a spoken shortlist. If the caller wants it in writing and gave a
// number, we also WhatsApp the list — best-effort, so a missing/unapproved
// template never breaks the call (the spoken result still stands).
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: tour-availability]", body);

    const params: AvailabilityParams = {
      destination: body.destination,
      pickup: body.pickup,
      tourType: body.tour_type,
      language: body.language,
      fromDate: body.from_date,
      toDate: body.to_date,
      limit: body.limit,
    };

    const result = await getTourAvailability(params);
    const spoken = summarizeForVoice(result);

    if (!result.tours.length) {
      return NextResponse.json({
        action: "no_results",
        spoken,
        notes: result.notes,
        message: `${spoken} ${result.notes.join(" ")}`.trim(),
      });
    }

    const tours = result.tours.map((t) => ({
      tour_number: t.tourNum,
      name: t.name,
      type: t.typeName,
      duration_days: t.durationDays,
      areas: t.areas,
      languages: t.languages,
      from_price: t.fromPrice,
      price_unit: t.priceUnit,
      url: t.url,
    }));

    // Send the written list only when asked and we have a number.
    const wantsWhatsApp = body.send_whatsapp === true || body.send_whatsapp === "true";
    const to = String(body.caller_phone || "").replace(/[^0-9]/g, "");

    if (wantsWhatsApp && to) {
      const { summary, list } = listForWhatsApp(result);
      try {
        await sendWhatsAppTemplate(to, "tour_availability", [summary, list]);
        return NextResponse.json({
          action: "sent",
          spoken,
          tours,
          notes: result.notes,
          message: `${spoken} Told the caller the list is on its way to their WhatsApp. Do not read URLs aloud. Ask if they'd like to book one or refine the search.`,
        });
      } catch (err) {
        console.error("[Tool: tour-availability] WhatsApp send failed", err);
        return NextResponse.json({
          action: "results",
          spoken,
          tours,
          notes: [...result.notes, "WhatsApp list could not be sent right now."],
          message: `${spoken} (Could not send the WhatsApp list this time — just read out the top options and offer to send details for a specific tour.)`,
        });
      }
    }

    const caveat = result.notes.length ? ` ${result.notes.join(" ")} If something wasn't understood, confirm it with the caller before reading results.` : "";
    return NextResponse.json({
      action: "results",
      spoken,
      tours,
      notes: result.notes,
      message: `${spoken}${caveat} Read out the top 2-3 and ask which one interests them, or offer to send the full list to their WhatsApp. Do not read URLs aloud.`,
    });
  } catch (err) {
    console.error("[Tool: tour-availability] Error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", detail }, { status: 500 });
  }
}
