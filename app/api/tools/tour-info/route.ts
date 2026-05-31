import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppTemplate } from "@/lib/converto";
import { findTour } from "@/lib/tours";

// Inbound assistant tool: caller asks about a specific tour/product.
// Resolve the tour (by name or number) and WhatsApp the caller a card with
// the tour name, its website tour number, and the page URL.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: tour-info]", body);

    const { tour_query, caller_phone } = body;
    if (!tour_query) {
      return NextResponse.json({ error: "Missing 'tour_query'" }, { status: 400 });
    }

    const { match, suggestions } = findTour(String(tour_query));

    if (!match) {
      const names = suggestions.map((t) => t.name);
      return NextResponse.json({
        action: "not_found",
        suggestions: names,
        message:
          names.length > 0
            ? `No confident match. Ask the caller to clarify which tour they mean. Closest options: ${names.join(", ")}.`
            : "No matching tour found. Ask the caller for the tour name again.",
      });
    }

    const to = String(caller_phone || "").replace(/[^0-9]/g, "");
    if (!to) {
      return NextResponse.json({
        action: "no_phone",
        tour: { number: match.number, name: match.name, url: match.url },
        message:
          "Found the tour but could not determine the caller's WhatsApp number. Ask the caller for a WhatsApp number to send the tour details to.",
      });
    }

    await sendWhatsAppTemplate(to, "tour_info", [match.name, match.number, match.url]);

    return NextResponse.json({
      action: "sent",
      tour: { number: match.number, name: match.name, url: match.url },
      message: `Sent the details for "${match.name}" (tour number ${match.number}) to the caller on WhatsApp. Let them know it's on its way and ask if they need anything else. Do not read the URL out loud.`,
    });
  } catch (err) {
    console.error("[Tool: tour-info] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
