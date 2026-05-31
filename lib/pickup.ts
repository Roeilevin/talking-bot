// Helpers for the "I can't find the pickup" inbound scenario.

export function buildMapsLink(hotel: string, city: string): string {
  const query = [hotel, city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Wall-clock parts in Asia/Jerusalem, so we compare like-for-like without
// doing UTC offset math by hand.
function nowInJerusalem(): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

function parseDate(tourDate: string): { y: number; mo: number; d: number } | null {
  if (!tourDate) return null;
  // ISO-ish: 2026-06-15 or 2026-06-15T08:00:00
  const iso = tourDate.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: +iso[1], mo: +iso[2], d: +iso[3] };
  // DD/MM/YYYY or DD.MM.YYYY (Israeli convention)
  const dmy = tourDate.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmy) return { y: +dmy[3], mo: +dmy[2], d: +dmy[1] };
  return null;
}

function parseTime(pickupTime: string): { h: number; mi: number } | null {
  if (!pickupTime) return null;
  const m = pickupTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, mi };
}

// Returns true if the pickup time is in the past, false if upcoming,
// null if the date/time strings could not be parsed.
export function isPickupPassed(tourDate: string, pickupTime: string): boolean | null {
  const d = parseDate(tourDate);
  const t = parseTime(pickupTime);
  if (!d) return null;
  const now = nowInJerusalem();
  const pickup = [d.y, d.mo, d.d, t?.h ?? 0, t?.mi ?? 0];
  const current = [now.y, now.mo, now.d, now.h, now.mi];
  for (let i = 0; i < pickup.length; i++) {
    if (pickup[i] !== current[i]) return pickup[i] < current[i];
  }
  return false; // exactly now → treat as not passed
}
