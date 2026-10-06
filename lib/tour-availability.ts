// Live tour-availability lookup for the inbound assistant's get_tour_availability
// tool. The caller speaks in natural language ("packages to the Dead Sea next
// week, pickup in Tel Aviv, in Spanish"); we resolve those slots to the IDs the
// BH /api/v2/tours endpoint understands, query it, then finish the filtering it
// can't do server-side (city/area and language) against each tour's own data.
//
// What the API filters server-side: from_date/to_date (required), tour_type,
// place_id (a specific place), pickup_place_id. Area and language are NOT
// server-side params — we filter those locally via associate_areas /
// language_availability. See memory: tours-availability-api.

import { getActiveBeinHarim } from "./bein-harim";
import {
  TOURS,
  affiliateUrl,
  fitTemplateList,
  formatDepartureDays,
  tourHighlights,
  type Tour,
} from "./tours";
import { PICKUP_MAY_CHANGE_WRITTEN } from "./pickup";
import tourTypesRaw from "@/data/tour-types.json";
import languagesRaw from "@/data/languages.json";
import visitPlacesRaw from "@/data/visit-places.json";
import pickupPlacesRaw from "@/data/pickup-places.json";
import areasRaw from "@/data/areas.json";

type TourType = { id: string; name: string };
type Language = { id: string; short_name: string; full_name: string };
type Place = { id: string; name: string; area_id: string; area: string };
type Area = { id: string; name: string };

const TOUR_TYPES = tourTypesRaw as TourType[];
const LANGUAGES = languagesRaw as Language[];
const VISIT_PLACES = visitPlacesRaw as Place[];
const PICKUP_PLACES = pickupPlacesRaw as Place[];
const AREAS = areasRaw as Area[];

const AREA_NAME = new Map<string, string>(AREAS.map((a) => [a.id, a.name]));
const CATALOG_BY_NUM = new Map<string, Tour>(TOURS.map((t) => [String(t.number), t]));

// ---------------------------------------------------------------------------
// text utilities (same normalisation approach as lib/tours.ts)
// ---------------------------------------------------------------------------
function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// slot resolvers — free text -> the IDs the API / our filters need
// ---------------------------------------------------------------------------

const TOUR_TYPE_SYNONYMS: Record<string, string> = {
  daily: "1", day: "1", "day tour": "1", "daily tour": "1", regular: "1", group: "1", shared: "1",
  private: "2", "private tour": "2", "private day": "2",
  package: "3", packages: "3", "tour package": "3", multiday: "3", "multi day": "3", "multi-day": "3", overnight: "3",
  transfer: "5", transfers: "5", shuttle: "5", transport: "5",
};

export function resolveTourType(text?: string): TourType | null {
  const q = norm(text || "");
  if (!q) return null;
  // direct id ("3")
  const byId = TOUR_TYPES.find((t) => t.id === q);
  if (byId) return byId;
  // synonym table (check longer keys first so "private day" beats "day")
  for (const key of Object.keys(TOUR_TYPE_SYNONYMS).sort((a, b) => b.length - a.length)) {
    if (q.includes(key)) return TOUR_TYPES.find((t) => t.id === TOUR_TYPE_SYNONYMS[key]) || null;
  }
  // fall back to the option label ("tour packages")
  const byName = TOUR_TYPES.find((t) => norm(t.name).includes(q) || q.includes(norm(t.name)));
  return byName || null;
}

const LANGUAGE_SYNONYMS: Record<string, string> = {
  english: "en", en: "en", eng: "en",
  french: "fr", francais: "fr", fr: "fr",
  spanish: "es", espanol: "es", castellano: "es", es: "es", spa: "es",
  russian: "ru", russ: "ru", ru: "ru",
  german: "ger", deutsch: "ger", de: "ger", ger: "ger", deu: "ger",
};

// Accepts a name ("Spanish"), a short code ("es"), or a guide_language_code
// like the order's (he/en/es/fr/ru/de/it). Returns null for unsupported langs.
export function resolveLanguage(text?: string): Language | null {
  const q = norm(text || "");
  if (!q) return null;
  const byId = LANGUAGES.find((l) => l.id === q);
  if (byId) return byId;
  const short = LANGUAGE_SYNONYMS[q] || q;
  return LANGUAGES.find((l) => l.short_name === short) || null;
}

export type PickupMatch = { id: string; name: string; areaId: string; area: string } | null;

// Resolve a pickup city/place to a single pickup_place_id. Any id within the
// caller's area works (the API resolves pickup by area), so we prefer an exact
// place-name hit, else the first place in a matching area.
export function resolvePickup(text?: string): PickupMatch {
  const q = norm(text || "");
  if (!q) return null;
  const exact = PICKUP_PLACES.find((p) => norm(p.name) === q);
  if (exact) return { id: exact.id, name: exact.name, areaId: exact.area_id, area: exact.area };
  const byArea = PICKUP_PLACES.find((p) => norm(p.area) === q);
  if (byArea) return { id: byArea.id, name: byArea.name, areaId: byArea.area_id, area: byArea.area };
  const partialPlace = PICKUP_PLACES.find((p) => norm(p.name).includes(q) && q.length >= 3);
  if (partialPlace) return { id: partialPlace.id, name: partialPlace.name, areaId: partialPlace.area_id, area: partialPlace.area };
  const partialArea = PICKUP_PLACES.find((p) => norm(p.area).includes(q) && q.length >= 3);
  if (partialArea) return { id: partialArea.id, name: partialArea.name, areaId: partialArea.area_id, area: partialArea.area };
  return null;
}

export type DestinationMatch =
  | { kind: "place"; placeId: string; label: string; areaId: string }
  | { kind: "area"; areaId: string; label: string }
  | null;

// A caller's "where do you want to go" — resolve to a specific place_id (when
// they name a site we can pin) or an area_id (when they name a city, which we
// then filter locally via associate_areas).
export function resolveDestination(text?: string): DestinationMatch {
  const q = norm(text || "");
  if (!q) return null;

  // City / area takes precedence when the term IS an area name — that's what
  // callers usually mean ("tours to Jerusalem"), and it's the broader filter.
  const areaExact = AREAS.find((a) => norm(a.name) === q);
  if (areaExact) return { kind: "area", areaId: areaExact.id, label: areaExact.name };

  const placeExact = VISIT_PLACES.find((p) => norm(p.name) === q);
  if (placeExact) return { kind: "place", placeId: placeExact.id, label: placeExact.name, areaId: placeExact.area_id };

  const areaPartial = AREAS.find((a) => q.length >= 3 && (norm(a.name).includes(q) || q.includes(norm(a.name))));
  if (areaPartial) return { kind: "area", areaId: areaPartial.id, label: areaPartial.name };

  const placePartial = VISIT_PLACES.find((p) => q.length >= 3 && norm(p.name).includes(q));
  if (placePartial) return { kind: "place", placeId: placePartial.id, label: placePartial.name, areaId: placePartial.area_id };

  return null;
}

// ---------------------------------------------------------------------------
// dates (Asia/Jerusalem)
// ---------------------------------------------------------------------------
function jerusalemToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA → YYYY-MM-DD
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isoDate(s?: string): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dmy = String(s).match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  return null;
}

// Default window: today → today+`defaultDays` (Asia/Jerusalem). The API
// requires both dates, so we always produce a range.
export function resolveDateRange(fromDate?: string, toDate?: string, defaultDays = 60): { from: string; to: string } {
  const today = jerusalemToday();
  const from = isoDate(fromDate) || today;
  let to = isoDate(toDate) || addDays(from, defaultDays);
  // The API rejects from_date > to_date with a 400. A caller-supplied date in
  // the past (from defaults to today) or a reversed range shouldn't crash the
  // lookup — widen the window instead. (YYYY-MM-DD compares lexicographically.)
  if (to < from) to = addDays(from, defaultDays);
  return { from, to };
}

// ---------------------------------------------------------------------------
// API call + local filtering
// ---------------------------------------------------------------------------
const FIELDS = [
  "tour_num", "name", "type_id", "is_private", "duration", "min_participants",
  "associate_areas", "language_availability", "prices", "pick_up", "score",
].join(",");

type RawTour = {
  tour_num: number | string;
  name: string;
  type_id: string;
  is_private: string;
  duration: number | string;
  min_participants: number | string;
  associate_areas?: string[];
  language_availability?: Record<string, Record<string, string>>;
  prices?: unknown;
  pick_up?: Array<Record<string, string>>;
  // BH popularity/priority score (numeric string, e.g. "137"; higher = recommend
  // first). Present on every tour; the API already returns rows sorted by it
  // desc, but we re-sort locally so ranking survives our area/language filters.
  score?: number | string;
};

export type AvailabilityParams = {
  destination?: string;
  pickup?: string;
  tourType?: string;
  language?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

export type PickupPoint = { area: string; time: string };

export type AvailableTour = {
  tourNum: string;
  name: string;
  typeId: string;
  typeName: string;
  isPrivate: boolean;
  durationDays: number;
  areas: string[];
  languages: string[];
  fromPrice: number | null;
  priceUnit: string | null;
  url: string | null;
  // Which days the tour departs, e.g. "Every day" or "Mon, Wed, Sat". Derived
  // from language_availability for the language the caller asked about (it
  // differs per language), falling back to the scraped catalog.
  departureDays: string | null;
  // Where and when the bus actually leaves: BH gives one meeting point per
  // pickup *area* with a fixed time — there is no hotel-by-hotel pickup. These
  // are the standard times, not a promise: the traveler's final pickup is
  // confirmed on their order confirmation (see PICKUP_MAY_CHANGE_*).
  pickups: PickupPoint[];
  // The main sights, from the scraped catalog — the API has no description, and
  // a shortlist of bare names tells the caller nothing about the tours.
  highlights: string[];
  // BH recommendation score (higher = listed first); null if unscored.
  score: number | null;
};

export type AvailabilityResult = {
  resolved: {
    from: string;
    to: string;
    tourType?: TourType;
    destination?: DestinationMatch;
    pickup?: PickupMatch;
    language?: Language;
  };
  totalFromApi: number;
  tours: AvailableTour[];
  notes: string[];
};

const TYPE_NAME = new Map<string, string>(TOUR_TYPES.map((t) => [t.id, t.name]));

// BH `score` arrives as a numeric string ("137"); higher means recommend first.
// Unscored/garbage → null so it sorts to the bottom.
function parseScore(s?: number | string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// language_availability is keyed by day-of-week flags per language:
//   { en: { sun: "1", mon: "1", ... }, fr: { sun: "0", mon: "1", ... } }
// so departure days are language-specific — an English departure every day may
// be a Monday/Thursday departure in French.
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_NAMES: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

function departureDaysFor(
  la: Record<string, Record<string, string>> | undefined,
  shortName: string
): string | null {
  const days = la?.[shortName];
  if (!days) return null;
  const running = DAY_KEYS.filter((d) => String(days[d]) === "1");
  if (!running.length) return null;
  if (running.length === 7) return "Every day";
  // "Monday, Wednesday and Saturday" — a bare comma list runs into the price
  // that follows it, both on the page and in the voice.
  const names = running.map((d) => DAY_NAMES[d]);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// BH's pick_up rows are { pu_area, pu_time, base_price, biz_price } — one fixed
// meeting point and departure time per area.
function pickupPoints(pickUp?: Array<Record<string, string>>): PickupPoint[] {
  const seen = new Set<string>();
  const out: PickupPoint[] = [];
  for (const p of pickUp || []) {
    const area = AREA_NAME.get(String(p.pu_area)) || "";
    const time = String(p.pu_time || "").trim();
    if (!area || !time || seen.has(area)) continue;
    seen.add(area);
    out.push({ area, time });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

function langsOffered(la?: Record<string, Record<string, string>>): string[] {
  if (!la) return [];
  return LANGUAGES
    .filter((l) => {
      const days = la[l.short_name];
      return days && Object.values(days).some((v) => String(v) === "1");
    })
    .map((l) => l.full_name);
}

// Best-effort "from" price; shape differs per tour type (see memory note).
function fromPrice(typeId: string, prices: unknown, pickUp?: Array<Record<string, string>>): { price: number | null; unit: string | null } {
  const nums = (vals: Array<number | string | undefined>) =>
    vals.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);

  try {
    if (typeId === "1") {
      // daily: prices.price_by_area[].base_price (per person)
      const arr = (prices as { price_by_area?: Array<{ base_price: number }> })?.price_by_area || [];
      const cands = nums(arr.map((a) => a.base_price));
      if (cands.length) return { price: Math.min(...cands), unit: "per person" };
    } else if (typeId === "2") {
      // private: prices[].4s (smallest vehicle, total per vehicle)
      const arr = (prices as Array<{ "4s"?: number }>) || [];
      const cands = nums(arr.map((a) => a["4s"]));
      if (cands.length) return { price: Math.min(...cands), unit: "per vehicle" };
    } else if (typeId === "3") {
      // package: cheapest accommodation/star tier (per person)
      const acc = (prices as { accommodations?: Record<string, Record<string, number>> })?.accommodations || {};
      const cands = nums(Object.values(acc).flatMap((occ) => Object.values(occ)));
      if (cands.length) return { price: Math.min(...cands), unit: "per person" };
    }
    // transfers / fallback: cheapest pickup base_price
    const pu = nums((pickUp || []).map((p) => p.base_price));
    if (pu.length) return { price: Math.min(...pu), unit: typeId === "5" ? null : "transfer" };
  } catch {
    /* price shapes vary; treat as unknown */
  }
  return { price: null, unit: null };
}

export async function getTourAvailability(params: AvailabilityParams): Promise<AvailabilityResult> {
  const notes: string[] = [];
  const { from, to } = resolveDateRange(params.fromDate, params.toDate);
  const tourType = resolveTourType(params.tourType) || undefined;
  const destination = resolveDestination(params.destination);
  const pickup = resolvePickup(params.pickup);
  const language = resolveLanguage(params.language) || undefined;

  if (params.tourType && !tourType) notes.push(`Could not match tour type "${params.tourType}".`);
  if (params.destination && !destination) notes.push(`Could not match destination "${params.destination}".`);
  if (params.pickup && !pickup) notes.push(`Could not match pickup "${params.pickup}".`);
  if (params.language && !language) notes.push(`Language "${params.language}" is not offered (en/fr/es/ru/ger only).`);

  // Build the server-side query (only the params the API honours).
  const qs = new URLSearchParams({ page: "1", per_page: "50", from_date: from, to_date: to, fields: FIELDS });
  if (tourType) qs.set("tour_type", tourType.id);
  if (pickup) qs.set("pickup_place_id", pickup.id);
  if (destination?.kind === "place") qs.set("place_id", destination.placeId);

  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const res = await fetch(`${baseUrl}/tours?${qs.toString()}`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "BH-API-KEY": apiKey,
    },
  });
  if (!res.ok) throw new Error(`Bein Harim tours API error: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { error: string | null; total_items: number; data: RawTour[] };
  if (json.error) throw new Error(`Bein Harim tours API error: ${json.error}`);

  const totalFromApi = json.total_items ?? (json.data?.length || 0);
  let rows = json.data || [];

  // Local filter: city/area (the API can't) via associate_areas.
  if (destination?.kind === "area") {
    const before = rows.length;
    const filtered = rows.filter((t) => (t.associate_areas || []).includes(destination.areaId));
    if (filtered.length) rows = filtered;
    else notes.push(`No tours in this window visit ${destination.label}; showing the closest matches instead.`);
    if (filtered.length && filtered.length < before) {
      /* narrowed by area */
    }
  }

  // Local filter: language via language_availability.
  if (language) {
    const filtered = rows.filter((t) => {
      const days = t.language_availability?.[language.short_name];
      return days && Object.values(days).some((v) => String(v) === "1");
    });
    if (filtered.length) rows = filtered;
    else notes.push(`No tours in this window run in ${language.full_name}; showing tours in other languages.`);
  }

  // Recommend by score: highest first. Stable for equal scores (keeps the API's
  // own ordering as the tie-breaker); unscored tours sink to the bottom.
  rows = rows
    .map((t, i) => ({ t, i, score: parseScore(t.score) }))
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.i - b.i)
    .map((x) => x.t);

  const limit = Math.max(1, Math.min(params.limit ?? 5, 20));
  const tours: AvailableTour[] = rows.slice(0, limit).map((t) => {
    const tourNum = String(t.tour_num);
    const catalog = CATALOG_BY_NUM.get(tourNum);
    const { price, unit } = fromPrice(t.type_id, t.prices, t.pick_up);
    return {
      tourNum,
      name: t.name || catalog?.name || `Tour ${tourNum}`,
      typeId: t.type_id,
      typeName: TYPE_NAME.get(t.type_id) || catalog?.type || "Tour",
      isPrivate: t.is_private === "1",
      durationDays: Number(t.duration) || 1,
      areas: (t.associate_areas || []).map((id) => AREA_NAME.get(id) || id),
      languages: langsOffered(t.language_availability),
      fromPrice: price,
      priceUnit: unit,
      url: catalog ? affiliateUrl(catalog.url) : null,
      departureDays:
        departureDaysFor(t.language_availability, language?.short_name ?? "en") ??
        formatDepartureDays(catalog?.departureDays),
      pickups: pickupPoints(t.pick_up),
      highlights: catalog ? tourHighlights(catalog, 3) : [],
      score: parseScore(t.score),
    };
  });

  return {
    resolved: { from, to, tourType, destination, pickup, language },
    totalFromApi,
    tours,
    notes,
  };
}

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------
function prettyDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

function priceLabel(t: AvailableTour): string {
  if (t.fromPrice == null) return "";
  return ` from $${t.fromPrice}${t.priceUnit ? " " + t.priceUnit : ""}`;
}

// ---- voice pacing ---------------------------------------------------------
// TTS takes its pauses from sentence punctuation. The old list was one long
// sentence with ")" numbering, em-dashes and semicolons between items, so on a
// busy destination (Masada/Dead Sea matches a dozen tours) the assistant read
// five options in a single breath and sounded rushed. One option per sentence,
// capped at three, gives the voice a real pause between each.
const VOICE_LIST_MAX = 3;
const ORDINALS = ["First", "Second", "Third"];
const NUMBER_WORDS = ["", "one", "two", "three"];

// Tour names carry catalogue punctuation ("Masada, Ein Gedi & Dead Sea Tour")
// that reads badly aloud; "&" in particular is unreliable across TTS voices.
function sayable(name: string): string {
  return String(name || "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

function spokenPrice(t: AvailableTour): string {
  if (t.fromPrice == null) return "";
  return ` From ${t.fromPrice} dollars${t.priceUnit ? " " + t.priceUnit : ""}.`;
}

// The exact words to say on the call — no URLs (the caller is on the phone) and
// no coaching for the model, which belongs in the tool result's `message`.
// The pickup we quote is the *area*, not the arbitrary matched place.
export function summarizeForVoice(r: AvailabilityResult): string {
  const { resolved, tours } = r;
  if (!tours.length) {
    return `No tours match those criteria between ${prettyDate(resolved.from)} and ${prettyDate(resolved.to)}.`;
  }
  const where = resolved.destination ? ` to ${resolved.destination.label}` : "";
  const pick = resolved.pickup ? ` with pickup in ${resolved.pickup.area}` : "";
  const type = resolved.tourType ? ` ${resolved.tourType.name.replace(/s$/, "").toLowerCase()}` : "";
  const lang = resolved.language ? ` in ${resolved.language.full_name}` : "";
  const head = `Found ${tours.length}${type} option${tours.length === 1 ? "" : "s"}${where}${pick}${lang}, available between ${prettyDate(resolved.from)} and ${prettyDate(resolved.to)}.`;

  const shown = tours.slice(0, VOICE_LIST_MAX);
  const lead = tours.length > shown.length ? ` Here are the top ${NUMBER_WORDS[shown.length]}.` : "";
  const items = shown
    .map((t, i) => {
      const days = `${t.durationDays} day${t.durationDays === 1 ? "" : "s"}`;
      return `${ORDINALS[i]}, ${sayable(t.name)}. ${days}.${spokenDays(t)}${spokenPrice(t)}${spokenHighlights(t)}`;
    })
    .join(" ");
  return `${head}${lead} ${items}`;
}

// What you actually see on it. A shortlist of names, durations and prices left
// the caller no way to choose between two tours that sound alike, so each option
// names its main sights — two, in their own sentence, to keep the pacing.
function spokenHighlights(t: AvailableTour): string {
  const h = t.highlights.slice(0, 2);
  if (!h.length) return "";
  return ` Visits ${h.length === 1 ? h[0] : `${h[0]} and ${h[1]}`}.`;
}

// When it runs. Callers ask this constantly and the answer was never spoken,
// so it belongs in the shortlist itself. "Every day" is the common case and
// stays short; a restricted schedule is the part worth hearing.
function spokenDays(t: AvailableTour): string {
  if (!t.departureDays) return "";
  return t.departureDays.trim().toLowerCase() === "every day"
    ? " Departs every day."
    : ` Departs ${t.departureDays}.`;
}

// One written line per tour, used for both WhatsApp and email. Covers EVERY
// tour we recommended, not just the ones read aloud — a caller who asks for the
// options in writing expects the whole shortlist, with the days it runs and
// enough of a description to tell two similar-sounding tours apart.
export function writtenLines(r: AvailabilityResult): string[] {
  return r.tours.map((t) => {
    const link = t.url ? ` ${t.url}` : "";
    return `${t.name} (#${t.tourNum}). ${factsLine(t)}${visitsLine(t) ? ` ${visitsLine(t)}` : ""}${link}`;
  });
}

// "1 day, departs every day, from $121 per person."
function factsLine(t: AvailableTour): string {
  const parts = [`${t.durationDays} day${t.durationDays === 1 ? "" : "s"}`];
  if (t.departureDays) {
    parts.push(
      t.departureDays.trim().toLowerCase() === "every day"
        ? "departs every day"
        : `departs ${t.departureDays}`
    );
  }
  const price = priceLabel(t).trim();
  if (price) parts.push(price);
  return `${parts.join(", ")}.`;
}

function visitsLine(t: AvailableTour): string {
  return t.highlights.length ? `Visits ${t.highlights.join(", ")}.` : "";
}

// Plain fallback lines — name, number and link only — for when the descriptions
// push the template body past WhatsApp's limit (see fitTemplateList).
function plainLines(r: AvailabilityResult): string[] {
  return r.tours.map((t) => `${t.name} (#${t.tourNum})${t.url ? ` ${t.url}` : ""}`);
}

// Two template params for a business-initiated WhatsApp list (no newlines/tabs
// allowed inside a param). {{1}} = summary, {{2}} = list.
export function listForWhatsApp(r: AvailabilityResult): { summary: string; list: string } {
  const where = r.resolved.destination ? ` to ${r.resolved.destination.label}` : "";
  const summary = `${r.tours.length} tour${r.tours.length === 1 ? "" : "s"}${where} (${prettyDate(r.resolved.from)}–${prettyDate(r.resolved.to)})`;
  return { summary, list: fitTemplateList(writtenLines(r), plainLines(r)) };
}

// The multi-line form for an open WhatsApp session or an email body: one block
// per tour, and the pickup caveat whenever we quoted pickup times, since these
// are the standard departures rather than the traveler's confirmed pickup.
export function writtenList(r: AvailabilityResult): string {
  const where = r.resolved.destination ? ` to ${r.resolved.destination.label}` : "";
  const head = `Here ${r.tours.length === 1 ? "is the tour" : `are the ${r.tours.length} tours`}${where} we discussed:`;
  const blocks = r.tours.map((t) =>
    [`${t.name} (tour #${t.tourNum})`, factsLine(t), visitsLine(t), t.url]
      .filter(Boolean)
      .join("\n")
  );
  const anyPickups = r.tours.some((t) => t.pickups.length);
  return [head, "", blocks.join("\n\n"), ...(anyPickups ? ["", PICKUP_MAY_CHANGE_WRITTEN] : [])].join("\n");
}
