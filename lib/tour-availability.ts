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

import { config } from "./config";
import { TOURS, affiliateUrl, type Tour } from "./tours";
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
  const to = isoDate(toDate) || addDays(from, defaultDays);
  return { from, to };
}

// ---------------------------------------------------------------------------
// API call + local filtering
// ---------------------------------------------------------------------------
const FIELDS = [
  "tour_num", "name", "type_id", "is_private", "duration", "min_participants",
  "associate_areas", "language_availability", "prices", "pick_up",
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

  const res = await fetch(`${config.beinHarim.baseUrl}/tours?${qs.toString()}`, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "BH-API-KEY": config.beinHarim.apiKey,
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

// A compact brief for the assistant to read/paraphrase on the call. We keep the
// pickup *area* (not the arbitrary matched place) and never include URLs (the
// caller is on the phone).
export function summarizeForVoice(r: AvailabilityResult): string {
  const { resolved, tours } = r;
  if (!tours.length) {
    return `No tours match those criteria between ${prettyDate(resolved.from)} and ${prettyDate(resolved.to)}. Offer to broaden the dates, destination, or tour type.`;
  }
  const where = resolved.destination ? ` to ${resolved.destination.label}` : "";
  const pick = resolved.pickup ? ` with pickup in ${resolved.pickup.area}` : "";
  const type = resolved.tourType ? ` ${resolved.tourType.name.replace(/s$/, "").toLowerCase()}` : "";
  const lang = resolved.language ? ` in ${resolved.language.full_name}` : "";
  const head = `Found ${tours.length}${type} option${tours.length === 1 ? "" : "s"}${where}${pick}${lang}, available between ${prettyDate(resolved.from)} and ${prettyDate(resolved.to)}.`;
  const items = tours
    .map((t, i) => `${i + 1}) ${t.name} — ${t.durationDays} day${t.durationDays === 1 ? "" : "s"}${priceLabel(t)}`)
    .join("; ");
  return `${head} ${items}.`;
}

// Two template params for a business-initiated WhatsApp list (no newlines/tabs
// allowed inside a param — joined with "; "). {{1}} = summary, {{2}} = list.
export function listForWhatsApp(r: AvailabilityResult): { summary: string; list: string } {
  const where = r.resolved.destination ? ` to ${r.resolved.destination.label}` : "";
  const summary = `${r.tours.length} tour${r.tours.length === 1 ? "" : "s"}${where} (${prettyDate(r.resolved.from)}–${prettyDate(r.resolved.to)})`;
  const list = r.tours
    .map((t) => {
      const link = t.url ? ` ${t.url}` : "";
      return `${t.name} (#${t.tourNum}, ${t.durationDays}d${priceLabel(t)})${link}`;
    })
    .join("; ");
  return { summary, list };
}
