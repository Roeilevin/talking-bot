// Default pickup points and times for a tour, for callers who have NOT booked
// yet ("where and when do you pick up for the Masada tour?").
//
// Bein Harim runs one fixed meeting point per pickup AREA with a fixed
// departure time — the API's pick_up rows are { pu_area, pu_time, ... }. There
// is no hotel-by-hotel pickup on group tours, so nothing here should ever tell
// a caller they'll be collected from their hotel; an order's own pickup_hotel
// is the exception and comes from the booking, not from here.
//
// The exact street address of each meeting point is not in the BH API yet. Drop
// it into data/pickup-points.json (see MEETING_POINTS below) and it is spoken
// automatically; until then callers get the city and the time, which is what
// the API actually knows.

import { getActiveBeinHarim } from "./bein-harim";
import { PICKUP_MAY_CHANGE_SPOKEN } from "./pickup";
import type { Tour } from "./tours";
import areasRaw from "@/data/areas.json";
import meetingPointsRaw from "@/data/pickup-points.json";

type Area = { id: string; name: string };
const AREA_NAME = new Map<string, string>((areasRaw as Area[]).map((a) => [a.id, a.name]));

// Operator-maintained addresses, keyed by area name exactly as it appears in
// data/areas.json ("Tel Aviv", "Jerusalem", ...). Empty until filled in; "_"
// keys are documentation, not data.
const MEETING_POINTS: Record<string, string> = Object.fromEntries(
  Object.entries(meetingPointsRaw as Record<string, string>).filter(
    ([k, v]) => !k.startsWith("_") && typeof v === "string" && v.trim()
  )
);

export type TourPickup = { area: string; time: string; address: string | null };

function toPickups(rows: Array<Record<string, string>>): TourPickup[] {
  const seen = new Set<string>();
  const out: TourPickup[] = [];
  for (const p of rows || []) {
    const area = AREA_NAME.get(String(p.pu_area)) || "";
    const time = String(p.pu_time || "").trim();
    if (!area || !time || seen.has(area)) continue;
    seen.add(area);
    out.push({ area, time, address: MEETING_POINTS[area] ?? null });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

// Look the tour up by its BH tour number over a window starting today, since
// pick_up only comes back on rows the availability endpoint returns.
export async function getTourPickups(tour: Tour, days = 60): Promise<TourPickup[]> {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    page: "1",
    per_page: "50",
    from_date: from,
    to_date: to,
    fields: "tour_num,name,pick_up",
  });

  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const res = await fetch(`${baseUrl}/tours?${qs.toString()}`, {
    headers: { Accept: "application/json", "Content-Type": "application/json", "BH-API-KEY": apiKey },
  });
  if (!res.ok) throw new Error(`Bein Harim tours API error: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as {
    error: string | null;
    data: Array<{ tour_num: number | string; pick_up?: Array<Record<string, string>> }>;
  };
  if (json.error) throw new Error(`Bein Harim tours API error: ${json.error}`);

  const row = (json.data || []).find((t) => String(t.tour_num) === tour.number);
  return row ? toPickups(row.pick_up || []) : [];
}

// "07:15" is a written time; said aloud it wants to be "7:15 AM".
function spokenTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

// Spoken form. Names the meeting point when we have an address, the city
// otherwise — and never implies hotel pickup. Always ends with the caveat: these
// are the tour's standard departures, and the traveler's own pickup point and
// time are the ones confirmed on their order confirmation.
export function pickupsForVoice(tourName: string, pickups: TourPickup[]): string {
  if (!pickups.length) {
    return `I don't have the pickup times for ${tourName} in front of me.`;
  }
  const lines = pickups.map((p) => {
    const where = p.address ? `${p.address} in ${p.area}` : p.area;
    return `From ${where}, at ${spokenTime(p.time)}.`;
  });
  return `${tourName} picks up from ${
    pickups.length === 1 ? "one point" : `${pickups.length} points`
  }. ${lines.join(" ")} ${PICKUP_MAY_CHANGE_SPOKEN}`;
}
