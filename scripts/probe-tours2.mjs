// Focused probe: extract the structure we need from /api/v2/tours without
// dumping megabytes. Run: node scripts/probe-tours2.mjs
import fs from "node:fs";

function loadEnvLocal() {
  for (const f of [".env.local", ".env"]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
}
loadEnvLocal();
const BASE = process.env.BH_API_BASE_URL || "https://dev-v3.beinharimtours.com/api/v2";
const KEY = process.env.BH_API_KEY;
const hdr = { Accept: "application/json", "Content-Type": "application/json", "BH-API-KEY": KEY };

async function get(qs) {
  const url = `${BASE}/tours?${qs}`;
  const res = await fetch(url, { headers: hdr });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { url, status: res.status, json, text };
}

function summarizePrices(p) {
  if (p == null) return p;
  if (Array.isArray(p)) return `array[${p.length}] ${JSON.stringify(p.slice(0, 2))}`;
  if (typeof p === "object") {
    const out = {};
    for (const k of Object.keys(p).slice(0, 6)) {
      const v = p[k];
      out[k] = Array.isArray(v) ? `array[${v.length}]` : typeof v === "object" && v ? Object.keys(v) : v;
    }
    return out;
  }
  return p;
}

(async () => {
  const COMMON = "page=1&per_page=3&from_date=2026-06-20&to_date=2026-07-20";

  // A) Full object on ONE tour — inspect the fields we care about.
  {
    const { json } = await get(`${COMMON}&tour_type=3`);
    const t = json?.data?.[0] || {};
    console.log("=== A) one full tour (type 3, packages) ===");
    console.log("total_items:", json?.total_items);
    console.log({
      id: t.id,
      tour_num: t.tour_num,
      name: t.name,
      type_id: t.type_id,
      is_private: t.is_private,
      is_available_for_api: t.is_available_for_api,
      duration: t.duration,
      min_participants: t.min_participants,
      associate_areas: t.associate_areas,
      language_availability: t.language_availability,
    });
    console.log("prices:", JSON.stringify(summarizePrices(t.prices)));
    console.log("yearly_pricing:", JSON.stringify(summarizePrices(t.yearly_pricing)));
    console.log("enabled_dates keys:", t.enabled_dates ? Object.keys(t.enabled_dates) : null,
      "| en sample:", t.enabled_dates?.en ? t.enabled_dates.en.slice(0, 3) : null);
    console.log("disabled_dates keys:", t.disabled_dates ? Object.keys(t.disabled_dates) : null);
    console.log("pick_up type:", Array.isArray(t.pick_up) ? `array[${t.pick_up.length}]` : typeof t.pick_up,
      "sample:", JSON.stringify(Array.isArray(t.pick_up) ? t.pick_up.slice(0, 2) : t.pick_up)?.slice(0, 300));
    console.log("drop_off sample:", JSON.stringify(t.drop_off)?.slice(0, 200));
    console.log("hotels type:", Array.isArray(t.hotels) ? `array[${t.hotels.length}]` : typeof t.hotels);
    console.log("itineraries type:", Array.isArray(t.itineraries) ? `array[${t.itineraries.length}]` : typeof t.itineraries);
  }

  // B) Does `fields` slim the response?
  {
    const { json, text } = await get(`${COMMON}&tour_type=3&fields=id,tour_num,name,prices,type_id`);
    const t = json?.data?.[0] || {};
    console.log("\n=== B) fields=id,tour_num,name,prices,type_id ===");
    console.log("returned keys on item:", Object.keys(t));
    console.log("payload bytes:", text.length);
  }

  // C) Filter probes — compare total_items to a no-filter baseline.
  const baseline = (await get(`${COMMON}`)).json?.total_items;
  console.log("\n=== C) filter probes (baseline total_items, no filters):", baseline, "===");
  for (const q of [
    "tour_type=1", "tour_type=2", "tour_type=3", "tour_type=5",
    "place_id=122", "pickup_place_id=1",
    "place_area_id=1", "area_id=1", "associate_areas=104",
    "language=3", "language_id=3", "language_availability=es",
  ]) {
    const r = await get(`${COMMON}&${q}`);
    console.log(`${q.padEnd(28)} -> status ${r.status}, total_items ${r.json?.total_items}, err ${JSON.stringify(r.json?.error)}`);
  }

  // D) The user's exact example.
  {
    const r = await get(`${COMMON}&place_id=122&pickup_place_id=1&tour_type=3`);
    console.log("\n=== D) user example (place 122, pickup 1, type 3) ===");
    console.log("total_items:", r.json?.total_items, "tour_nums:", (r.json?.data || []).map((x) => x.tour_num));
  }
})();
