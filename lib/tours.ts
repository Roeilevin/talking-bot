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
