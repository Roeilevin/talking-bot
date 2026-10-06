import { NextRequest, NextResponse } from "next/server";
import { getOrderDetails, OrderNotFoundError } from "@/lib/bein-harim";
import { sendWhatsAppTemplate } from "@/lib/converto";
import {
  buildMapsLink,
  isPickupPassed,
  PICKUP_MAY_CHANGE_SPOKEN,
  PICKUP_MAY_CHANGE_WRITTEN,
} from "@/lib/pickup";
import { findTour, tourFacts, tourHighlightsSentence, writtenTourBlock } from "@/lib/tours";
import { getTourPickups, pickupsForVoice } from "@/lib/tour-pickup";
import { alreadySent, markSent, releaseSend, sendKey } from "@/lib/send-once";

// Inbound assistant tool: "where and when is the pickup?"
//
// Two different questions wear the same words, and the tool used to answer only
// the first:
//   - A BOOKED caller ("I can't find my pickup") -> their order's own hotel,
//     city and time, WhatsApped as a map link.
//   - A caller with NO order, asking before booking -> the tour's standard
//     pickup points and departure times. This previously dead-ended in "what's
//     your order number?", which the caller does not have.
// So order_id is optional: with it we answer from the booking, without it we
// answer from the tour. Group-tour pickup is a fixed meeting point per city,
// never "your hotel" — only a booking carries a hotel.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: pickup-info]", body);

    const { order_id, tour_query, caller_phone } = body;
    if (!order_id) {
      return tour_query
        ? await defaultPickup(String(tour_query))
        : NextResponse.json({
            action: "need_tour_or_order",
            message:
              "Ask which tour they're asking about — then call this tool again with tour_query. Only ask for an order number if they say they have already booked.",
          });
    }

    let order;
    try {
      order = await getOrderDetails(Number(order_id));
    } catch (err) {
      // Unknown order number — let the assistant ask the caller to repeat it
      // instead of hitting a generic tool failure.
      if (err instanceof OrderNotFoundError) {
        return NextResponse.json({
          action: "order_not_found",
          message:
            "No booking matches that order number. Ask the caller to repeat it, then try again.",
        });
      }
      throw err;
    }
    console.log("[Tool: pickup-info] order", {
      tour_date: order.tour_date,
      pickup_time: order.pickup_time,
      pickup_hotel: order.pickup_hotel,
      pickup_city: order.pickup_city,
    });

    const passed = isPickupPassed(order.tour_date, order.pickup_time);
    const mapsLink = buildMapsLink(order.pickup_hotel, order.pickup_city);

    // If the pickup already happened, the guide/bus has likely left — hand off.
    if (passed === true) {
      return NextResponse.json({
        action: "transfer_to_ops",
        message:
          "The pickup time has already passed. Tell the caller you are connecting them to the operations team and transfer the call.",
      });
    }

    const spoken = `Your pickup is from ${order.pickup_hotel}, ${order.pickup_city}, at ${order.pickup_time}.`;
    const to = String(caller_phone || "").replace(/[^0-9]/g, "");
    if (!to) {
      return NextResponse.json({
        action: "no_phone",
        spoken,
        maps_link: mapsLink,
        message: "Read the 'spoken' text aloud. Do not read the map URL out loud.",
      });
    }

    const key = sendKey(to, "pickup_location", [String(order_id)]);
    if (alreadySent(key)) {
      console.log("[Tool: pickup-info] duplicate send suppressed", key);
      return NextResponse.json({
        action: "already_sent",
        spoken,
        maps_link: mapsLink,
        message:
          "The pickup location was ALREADY sent to this caller moments ago. Do NOT send again and do NOT tell them again that you've sent it.",
      });
    }
    // Claim before sending, release on failure — see tour-info.
    markSent(key);
    try {
      await sendWhatsAppTemplate(to, "pickup_location", [
        `${order.pickup_hotel}, ${order.pickup_city}`,
        order.pickup_time,
        mapsLink,
      ]);
    } catch (err) {
      releaseSend(key);
      throw err;
    }

    return NextResponse.json({
      action: "sent",
      spoken,
      maps_link: mapsLink,
      message:
        "Read the 'spoken' text aloud, then say ONCE that you've also sent the location to their WhatsApp. Do not read the URL out loud.",
    });
  } catch (err) {
    console.error("[Tool: pickup-info] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// No booking yet: the tour's own standard pickup points and times.
async function defaultPickup(tourQuery: string) {
  const { match, suggestions } = findTour(tourQuery);
  if (!match) {
    return NextResponse.json({
      action: "not_found",
      suggestions: suggestions.map((t) => t.name),
      message: suggestions.length
        ? `Not sure which tour they mean. Ask them to choose: ${suggestions.map((t) => t.name).join(", ")}.`
        : "Could not identify the tour. Ask the caller for the tour name again.",
    });
  }

  const pickups = await getTourPickups(match);
  // A caller asking where a tour leaves from is usually still deciding whether
  // to take it, so the answer carries what the tour actually is, not just a
  // street corner and a time.
  const about = [`${match.name}.`, tourFacts(match), tourHighlightsSentence(match)]
    .filter(Boolean)
    .join(" ");
  const spoken = `${about} ${pickupsForVoice(match.name, pickups)}`;

  if (!pickups.length) {
    return NextResponse.json({
      action: "no_pickup_data",
      tour: { number: match.number, name: match.name },
      spoken,
      written: writtenTourBlock(match),
      message:
        "Say the 'spoken' text — it describes the tour — then offer to check the pickup with the team or transfer. Do not guess a pickup time or place, and do not say the pickup is from their hotel.",
    });
  }

  const written = [
    writtenTourBlock(match),
    "",
    "Pickup points and times:",
    ...pickups.map((p) => `${p.address ? `${p.address}, ` : ""}${p.area} — ${p.time}`),
    "",
    PICKUP_MAY_CHANGE_WRITTEN,
  ].join("\n");

  return NextResponse.json({
    action: "default_pickup",
    tour: { number: match.number, name: match.name },
    pickups,
    spoken,
    written,
    pickup_note: PICKUP_MAY_CHANGE_WRITTEN,
    message:
      `Read the 'spoken' text aloud, one pickup point per sentence. It opens with a short description of the tour — say that too, not just the pickup. These are the standard pickup points for this tour — a fixed meeting point per city, NOT hotel pickup, so never tell the caller they'll be collected from their hotel. Say the tour name once. The 'spoken' text ends with the required caveat — always say it in the caller's language: "${PICKUP_MAY_CHANGE_SPOKEN}" If they want this in writing, send the 'written' text (WhatsApp or email); it carries the same caveat.`,
  });
}
