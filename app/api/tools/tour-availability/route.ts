import { NextRequest, NextResponse } from "next/server";
import { sendCallerMessage } from "@/lib/converto";
import { PICKUP_MAY_CHANGE_SPOKEN, PICKUP_MAY_CHANGE_WRITTEN } from "@/lib/pickup";
import {
  getTourAvailability,
  summarizeForVoice,
  listForWhatsApp,
  writtenList,
  type AvailabilityParams,
} from "@/lib/tour-availability";

// Inbound assistant tool: caller asks what tours are available. We resolve their
// free-text criteria (destination/pickup/type/language/dates) to the BH
// /api/v2/tours filters, do the area+language filtering the API can't, and hand
// the assistant a spoken shortlist. If the caller wants it in writing and gave a
// number, we also WhatsApp the list — best-effort, so a missing/unapproved
// template never breaks the call (the spoken result still stands).
//
// `spoken` is the exact wording to say, already paced for voice (see
// summarizeForVoice); `message` carries only directions for the assistant. They
// used to be one string, which had the assistant racing through — and sometimes
// reading out — its own instructions.
const READ_SPOKEN =
  "Read the 'spoken' text aloud exactly as written, at a calm pace, pausing between options. Do not add options, prices or details that are not in it. It already says what each tour visits — never reduce a tour to its name alone.";

// Said whenever a pickup time or point from `tours[].pickups` is quoted: these
// are the standard departures, not the traveler's confirmed pickup.
const PICKUP_RULE = `If you tell the caller a pickup point or pickup time from 'pickups', you MUST add, in their language: "${PICKUP_MAY_CHANGE_SPOKEN}"`;

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
        message: `Say the 'spoken' text, then offer to broaden the dates, destination, or tour type. ${result.notes.join(" ")}`.trim(),
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
      // So the assistant can answer "which days does it run?" and "where does
      // it pick up from?" without a second lookup.
      departure_days: t.departureDays,
      pickups: t.pickups,
      // The main sights, so the assistant can say what a tour actually covers
      // instead of reading back a name and a duration.
      highlights: t.highlights,
      url: t.url,
    }));

    // Exactly what we WhatsApp — handed back so an email fallback carries the
    // same descriptions rather than a thinner list of names.
    const written = writtenList(result);

    // Send the written list only when asked and we have a number.
    const wantsWhatsApp = body.send_whatsapp === true || body.send_whatsapp === "true";
    const to = String(body.caller_phone || "").replace(/[^0-9]/g, "");

    if (wantsWhatsApp && to) {
      const { summary, list } = listForWhatsApp(result);
      try {
        // Session-first (the full multi-line list with descriptions), falling
        // back to the approved template when the 24h window is closed.
        await sendCallerMessage(
          to,
          written,
          [{ name: "tour_availability", params: [summary, list] }],
          { direction: "customer", kind: "tour_availability" }
        );
        return NextResponse.json({
          action: "sent",
          spoken,
          written,
          tours,
          pickup_note: PICKUP_MAY_CHANGE_WRITTEN,
          notes: result.notes,
          message: `${READ_SPOKEN} Then say the full list — with what each tour includes — is on its way to their WhatsApp, and ask if they'd like to book one or refine the search. Do not read URLs aloud. ${PICKUP_RULE} If they want it by email instead, send the 'written' text as the body.`,
        });
      } catch (err) {
        console.error("[Tool: tour-availability] WhatsApp send failed", err);
        return NextResponse.json({
          action: "results",
          spoken,
          written,
          tours,
          pickup_note: PICKUP_MAY_CHANGE_WRITTEN,
          notes: [...result.notes, "WhatsApp list could not be sent right now."],
          message: `${READ_SPOKEN} The WhatsApp list could not be sent this time — do not mention sending it; offer to send the details by email (use the 'written' text as the body) or for one specific tour instead. ${PICKUP_RULE}`,
        });
      }
    }

    const caveat = result.notes.length ? ` ${result.notes.join(" ")} If something wasn't understood, confirm it with the caller before reading results.` : "";
    return NextResponse.json({
      action: "results",
      spoken,
      written,
      tours,
      pickup_note: PICKUP_MAY_CHANGE_WRITTEN,
      notes: result.notes,
      message: `${READ_SPOKEN}${caveat} Then ask which one interests them, or offer to send the full list to their WhatsApp. Do not read URLs aloud. ${PICKUP_RULE}`,
    });
  } catch (err) {
    console.error("[Tool: tour-availability] Error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "internal_error", detail }, { status: 500 });
  }
}
