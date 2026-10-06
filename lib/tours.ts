import toursRaw from "@/data/tours.json";

export type Tour = {
  number: string;
  name: string;
  url: string;
  type: string;
  areas: string[];
  places: string[];
  price: { telAviv: number | null; jerusalem: number | null; herzliya: number | null };
  departureDays: string | null;
};

export const TOURS = toursRaw as Tour[];

const BY_NUMBER = new Map<string, Tour>(TOURS.map((t) => [t.number, t]));

// Words that don't help distinguish one tour from another.
const STOP = new Set(["the", "and", "from", "to", "of", "a", "an", "with", "in", "on", "for", "tour", "tours", "trip"]);

function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w))
  );
}

// Pre-tokenize the catalog once.
const TOKENS = new Map<string, Set<string>>(TOURS.map((t) => [t.number, tokenize(t.name)]));

function extractNumber(query: string): string | null {
  const q = String(query || "").trim();
  if (/^\d+$/.test(q)) return q;
  // "tour number 5", "tour #5", "number 5"
  const m = q.match(/(?:tour\s*(?:number|no\.?|#)?\s*|number\s*|#)\s*(\d{1,4})\b/i);
  return m ? m[1] : null;
}

function scoreTour(qNorm: string, qTokens: Set<string>, tour: Tour): number {
  const nameNorm = norm(tour.name);
  if (nameNorm === qNorm) return 1;

  let score = 0;
  if (qNorm.length >= 4 && (nameNorm.includes(qNorm) || qNorm.includes(nameNorm))) {
    score = Math.max(score, 0.85);
  }

  const tTokens = TOKENS.get(tour.number) || new Set<string>();
  if (qTokens.size && tTokens.size) {
    const inter = [...qTokens].filter((t) => tTokens.has(t)).length;
    const union = new Set([...qTokens, ...tTokens]).size;
    const jaccard = inter / union;
    score = Math.max(score, jaccard);
    // All query words appear in the tour name → strong signal even if name has extras.
    if ([...qTokens].every((t) => tTokens.has(t))) score = Math.max(score, 0.8);
  }

  // Secondary signal: query words matching the tour's places/areas (lower weight).
  if (qTokens.size) {
    const placeTokens = tokenize([...tour.places, ...tour.areas].join(" "));
    const inter = [...qTokens].filter((t) => placeTokens.has(t)).length;
    if (inter) score = Math.max(score, 0.3 + 0.1 * inter);
  }

  return score;
}

export type TourMatch = {
  match: Tour | null;
  score: number;
  byNumber: boolean;
  suggestions: Tour[];
};

const CONFIDENCE = 0.45;

// Resolve a caller's free-text tour reference (name or number) to a catalog entry.
export function findTour(query: string): TourMatch {
  const raw = String(query || "").trim();
  if (!raw) return { match: null, score: 0, byNumber: false, suggestions: [] };

  const num = extractNumber(raw);
  if (num && BY_NUMBER.has(num)) {
    return { match: BY_NUMBER.get(num)!, score: 1, byNumber: true, suggestions: [] };
  }

  const qNorm = norm(raw);
  const qTokens = tokenize(raw);

  const ranked = TOURS.map((t) => ({ t, s: scoreTour(qNorm, qTokens, t) }))
    .sort((a, b) => b.s - a.s);

  const best = ranked[0];
  const suggestions = ranked.slice(0, 3).filter((r) => r.s > 0).map((r) => r.t);

  if (!best || best.s < CONFIDENCE) {
    return { match: null, score: best ? best.s : 0, byNumber: false, suggestions };
  }
  return { match: best.t, score: best.s, byNumber: false, suggestions: suggestions.slice(1) };
}

// The catalog stores departure days as scraped: "Every Day", "Mon; Wed; Sat",
// "Mon; Tues; Wed; Thurs". Semicolons and clipped weekday names are fine in
// writing but wrong out loud, so spoken output goes through here.
const DAY_FULL: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", tues: "Tuesday", wed: "Wednesday",
  weds: "Wednesday", thu: "Thursday", thur: "Thursday", thurs: "Thursday",
  fri: "Friday", sat: "Saturday",
};

export function formatDepartureDays(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^every\s*day$/i.test(s)) return "Every day";

  const parts = s
    .split(/[;,]|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => DAY_FULL[p.toLowerCase().replace(/\.$/, "")] ?? p);
  if (!parts.length) return null;
  if (parts.length === 7) return "Every day";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// descriptions — what the tour actually IS
// ---------------------------------------------------------------------------
// A name plus a link tells the caller nothing they didn't already say on the
// phone. Everything we hand out — spoken, WhatsApp, email — carries a short
// blurb built from the catalog we already have: what kind of tour it is, when
// it departs, what it costs, and the sights it covers.

export function lowestPrice(t: Tour): number | null {
  const vals = Object.values(t.price).filter((n): n is number => typeof n === "number" && n > 0);
  return vals.length ? Math.min(...vals) : null;
}

// Catalog places carry a city qualifier ("Milk Grotto, Bethlehem") that is noise
// once the tour name already says where you're going.
function placeName(raw: string): string {
  return String(raw || "").split(",")[0].trim();
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// NOTE: the catalog's `type` is not trustworthy enough to say out loud — the
// scrape files plain day tours (e.g. #4, "Bethlehem & Church of the Nativity Day
// Tour") under "Tour Package", so calling one a multi-day package would be a
// flat lie to the caller. Duration comes from the live availability API instead;
// everything below sticks to fields the catalog gets right.

// The sights worth naming, cleaned up. Falls back to the areas visited for the
// ~27 catalog entries that list no places.
export function tourHighlights(t: Tour, max = 3): string[] {
  const places = t.places.map(placeName).filter(Boolean);
  return (places.length ? places : t.areas).slice(0, max);
}

// Group tours are priced per person; a private tour's catalog price is the
// whole-vehicle rate on some entries and a per-head rate on others (compare
// #2002 at $860 with the $39 Jaffa walking tour), so private tours get a bare
// "from $X" rather than a unit we'd be guessing at.
export function isPrivateTour(t: Tour): boolean {
  return /private/i.test(`${t.type} ${t.name}`);
}

// "from $121 per person" / "from $860" — null when the catalog has no price.
export function priceFromLabel(t: Tour): string | null {
  const price = lowestPrice(t);
  if (!price) return null;
  return `from $${price}${isPrivateTour(t) ? "" : " per person"}`;
}

// "Departs every day, from $121 per person."
export function tourFacts(t: Tour): string {
  const parts: string[] = [];
  const days = formatDepartureDays(t.departureDays);
  if (days) parts.push(days === "Every day" ? "Departs every day" : `Departs ${days}`);
  const price = priceFromLabel(t);
  if (price) parts.push(parts.length ? price : price[0].toUpperCase() + price.slice(1));
  return parts.length ? `${parts.join(", ")}.` : "";
}

// "Visits the Western Wall, Via Dolorosa and Church of the Nativity."
export function tourHighlightsSentence(t: Tour, max = 3): string {
  const h = tourHighlights(t, max);
  return h.length ? `Visits ${joinList(h)}.` : "";
}

// Multi-line block for an open WhatsApp session or an email body.
export function writtenTourBlock(t: Tour): string {
  return [
    `${t.name} (tour #${t.number})`,
    tourFacts(t),
    tourHighlightsSentence(t),
    affiliateUrl(t.url),
  ]
    .filter(Boolean)
    .join("\n");
}

// Same substance on one line — WhatsApp template variables reject newlines, so
// the template fallback has to say it all in a single run of text.
export function writtenTourLine(t: Tour): string {
  return [`${t.name} (#${t.number}).`, tourFacts(t), tourHighlightsSentence(t), affiliateUrl(t.url)]
    .filter(Boolean)
    .join(" ");
}

// WhatsApp caps a template body at ~1024 characters once the variables are
// substituted, and descriptions are not free. So the fallback list degrades
// instead of being rejected outright: rich lines if they fit, plain
// name-and-link lines if not, and finally fewer tours.
export function fitTemplateList(rich: string[], plain: string[], max = 700): string {
  const join = (xs: string[]) => xs.join(" | ");
  if (join(rich).length <= max) return join(rich);
  if (join(plain).length <= max) return join(plain);

  const kept: string[] = [];
  for (const line of plain) {
    if (join([...kept, line]).length > max) break;
    kept.push(line);
  }
  return kept.length ? join(kept) : String(plain[0] ?? "").slice(0, max);
}

// Bein Harim affiliate id appended to every tour link we hand out, so bookings
// are attributed. Override with BH_AFFILIATE_ID; set to "" to disable.
export const AFFILIATE_ID =
  process.env.BH_AFFILIATE_ID !== undefined ? process.env.BH_AFFILIATE_ID : "2909";

// Append the affiliate code to a tour URL, preserving the trailing slash and any
// existing query params.
export function affiliateUrl(url: string, affiliateId: string = AFFILIATE_ID): string {
  if (!affiliateId) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("affiliate_id", affiliateId);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}affiliate_id=${encodeURIComponent(affiliateId)}`;
  }
}
