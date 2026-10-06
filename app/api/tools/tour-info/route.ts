import { NextRequest, NextResponse } from "next/server";
import { sendCallerMessage } from "@/lib/converto";
import {
  findTour,
  affiliateUrl,
  fitTemplateList,
  formatDepartureDays,
  isPrivateTour,
  lowestPrice,
  tourHighlights,
  writtenTourBlock,
  writtenTourLine,
  type Tour,
} from "@/lib/tours";
import { alreadySent, markSent, releaseSend, sendKey } from "@/lib/send-once";

// Inbound assistant tool: caller asks about specific tour(s).
//
// Two things this owes the caller beyond a link:
//  - Details ON THE PHONE. It used to answer "I've sent it to your WhatsApp"
//    and nothing else, so a caller who just wanted to know what the tour
//    includes had to go read a message. `spoken` now carries the substance.
//  - EVERY tour discussed. `tour_query` accepts a list, because a caller who
//    was offered three Bethlehem options and says "send them" expects three.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: tour-info]", body);

    const queries = parseQueries(body.tour_query ?? body.tour_queries);
    if (!queries.length) {
      return NextResponse.json({ error: "Missing 'tour_query'" }, { status: 400 });
    }

    const matched: Tour[] = [];
    const unmatched: string[] = [];
    const suggestions: string[] = [];
    for (const q of queries) {
      const r = findTour(q);
      if (r.match) {
        if (!matched.some((t) => t.number === r.match!.number)) matched.push(r.match);
      } else {
        unmatched.push(q);
        for (const s of r.suggestions) if (!suggestions.includes(s.name)) suggestions.push(s.name);
      }
    }

    if (!matched.length) {
      return NextResponse.json({
        action: "not_found",
        suggestions,
        unmatched,
        message: suggestions.length
          ? `No confident match. Ask the caller which tour they mean. Closest options: ${suggestions.join(", ")}.`
          : "No matching tour found. Ask the caller for the tour name again.",
      });
    }

    const tours = matched.map((t) => ({
      number: t.number,
      name: t.name,
      departure_days: formatDepartureDays(t.departureDays),
      highlights: t.places.slice(0, 6),
      price_from: lowestPrice(t),
      url: affiliateUrl(t.url),
    }));
    const spoken = describeForVoice(matched);
    // The exact text we WhatsApp. Handed back so an email fallback carries the
    // same description instead of the agent inventing a thinner one.
    const written = writtenTours(matched);

    const to = String(body.caller_phone || "").replace(/[^0-9]/g, "");
    if (!to) {
      return NextResponse.json({
        action: "no_phone",
        spoken,
        written,
        tours,
        unmatched,
        message: `${SAY_SPOKEN} Then ask for a WhatsApp number if they'd like the booking link in writing. If they'd rather have it by email, send the 'written' text as the body — do not shorten it to just the name and link.`,
      });
    }

    // Same tours, same caller, moments ago → the assistant is repeating itself.
    const key = sendKey(to, "tour_info", matched.map((t) => t.number).sort());
    if (alreadySent(key)) {
      console.log("[Tool: tour-info] duplicate send suppressed", key);
      return NextResponse.json({
        action: "already_sent",
        spoken,
        written,
        tours,
        message:
          "These details were ALREADY sent to this caller moments ago. Do NOT send again and do NOT tell them again that you've sent it — you already did. Just answer their question or ask what else they need.",
      });
    }
    // Claim before sending so two in-flight calls can't both send, but release
    // on failure so a retry isn't mistaken for a duplicate.
    markSent(key);
    try {
      await sendTours(to, matched);
    } catch (err) {
      releaseSend(key);
      throw err;
    }

    return NextResponse.json({
      action: "sent",
      spoken,
      written,
      tours,
      message: `${SAY_SPOKEN} Then say ONCE — and only once in the whole call — that you've sent the ${
        matched.length === 1 ? "details and booking link" : "details and booking links"
      } to their WhatsApp. Do not read the URL out loud. The message already describes each tour (what it is, when it departs, the price it starts from and the main sights) — if they ask for it by email instead, send that same 'written' text.`,
    });
  } catch (err) {
    console.error("[Tool: tour-info] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

const SAY_SPOKEN =
  "Read the 'spoken' text aloud, at a calm pace. Say each tour name once — do not repeat it.";

// Accepts "Masada tour", ["a", "b"], or "a, b" — the assistant is inconsistent
// about which it sends when the caller mentions several tours at once.
// Only commas and semicolons separate tours: " and " does NOT, because half the
// catalog is named with it ("Jerusalem and Bethlehem Tour"), and splitting there
// turned one tour into two bogus lookups.
function parseQueries(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/\s*[;,]\s*/);
  return raw.map((q) => String(q ?? "").trim()).filter(Boolean).slice(0, 5);
}

// Spoken tour detail: what it is, when it runs, what it costs, what you see.
// One sentence at a time so the voice pauses (see summarizeForVoice).
function describeForVoice(tours: Tour[]): string {
  return tours
    .map((t) => {
      const name = t.name.replace(/&/g, " and ").replace(/\s+/g, " ").trim();
      const spokenDays = formatDepartureDays(t.departureDays);
      const days = spokenDays
        ? spokenDays === "Every day"
          ? " It departs every day."
          : ` It departs ${spokenDays}.`
        : "";
      const from = lowestPrice(t);
      // No unit on private tours — the catalog rate is per vehicle on some and
      // per person on others, and guessing wrong misquotes the caller.
      const price = from
        ? ` Prices start at ${from} dollars${isPrivateTour(t) ? "" : " per person"}.`
        : "";
      const highlights = tourHighlights(t, 3);
      const seen = highlights.length ? ` You'll visit ${highlights.join(", ")}.` : "";
      return `${name}.${days}${price}${seen}`;
    })
    .join(" ");
}

// The written version of the same thing, for WhatsApp and (via the tool result)
// email: a block per tour — name and number, when it departs, what it starts
// at, the main sights, then the booking link.
function writtenTours(tours: Tour[]): string {
  const heading =
    tours.length === 1
      ? "Here are the details for your tour:"
      : `Here are the ${tours.length} tours we discussed:`;
  return `${heading}\n\n${tours.map(writtenTourBlock).join("\n\n")}`;
}

// One message carrying every tour. Free-text while the caller's 24h WhatsApp
// session is open (clickable links, a block per tour); otherwise fall back to
// the approved templates — the multi-tour list template first, because its
// free-form {{2}} still fits the descriptions, and the single-tour card
// (name/number/link only, no room for a description) as the last resort.
async function sendTours(to: string, tours: Tour[]): Promise<void> {
  const sessionText = writtenTours(tours);

  const summary = `${tours.length} tour${tours.length === 1 ? "" : "s"} from Bein Harim`;
  const list = fitTemplateList(
    tours.map(writtenTourLine),
    tours.map((t) => `${t.name} (#${t.number}) ${affiliateUrl(t.url)}`)
  );

  const templates = [{ name: "tour_availability", params: [summary, list] }];
  if (tours.length === 1) {
    templates.push({
      name: "tour_info",
      params: [tours[0].name, tours[0].number, affiliateUrl(tours[0].url)],
    });
  }

  await sendCallerMessage(to, sessionText, templates, {
    direction: "customer",
    kind: "tour_info",
  });
}
