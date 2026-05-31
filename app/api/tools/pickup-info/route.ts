import { NextRequest, NextResponse } from "next/server";
import { getOrderDetails } from "@/lib/bein-harim";
import { sendWhatsAppMessage } from "@/lib/converto";
import { buildMapsLink, isPickupPassed } from "@/lib/pickup";

// Inbound assistant tool: caller can't find the pickup point.
// If the pickup time has not passed, WhatsApp the Google Maps link to the
// caller. If it has passed, signal the assistant to transfer to ops.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: pickup-info]", body);

    const { order_id, caller_phone } = body;
    if (!order_id) {
      return NextResponse.json({ error: "Missing 'order_id'" }, { status: 400 });
    }

    const order = await getOrderDetails(Number(order_id));
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

    const to = String(caller_phone || "").replace(/[^0-9]/g, "");
    if (!to) {
      return NextResponse.json({
        action: "no_phone",
        maps_link: mapsLink,
        message:
          "Could not determine the caller's WhatsApp number. Read out the pickup location instead.",
      });
    }

    const text =
      `Bein Harim Tours – your pickup point:\n` +
      `${order.pickup_hotel}, ${order.pickup_city}\n` +
      `Pickup time: ${order.pickup_time}\n` +
      `Map: ${mapsLink}`;
    await sendWhatsAppMessage(to, text);

    return NextResponse.json({
      action: "sent",
      maps_link: mapsLink,
      message:
        "Pickup location sent to the caller on WhatsApp. Confirm they received it and ask if they need anything else.",
    });
  } catch (err) {
    console.error("[Tool: pickup-info] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
