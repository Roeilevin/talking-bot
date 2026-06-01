// Live end-to-end check of the availability approach: mirrors lib/tour-availability
// query construction + local area/language filtering against the real API, so we
// can eyeball that resolution and filtering produce sensible results.
// Run: node scripts/test-availability.mjs
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
const j = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const TYPES = j("tour-types.json"), LANGS = j("languages.json"),
  VISIT = j("visit-places.json"), PICKUP = j("pickup-places.json"), AREAS = j("areas.json");
const AREA_NAME = new Map(AREAS.map((a) => [a.id, a.name]));
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const FIELDS = "tour_num,name,type_id,is_private,duration,min_participants,associate_areas,language_availability,prices,pick_up";
const resolveType = (t) => TYPES.find((x) => norm(x.name).includes(norm(t))) || ({ daily: "1", private: "2", package: "3", transfer: "5" }[norm(t)] && TYPES.find((x) => x.id === { daily: "1", private: "2", package: "3", transfer: "5" }[norm(t)]));
const resolveArea = (t) => AREAS.find((a) => norm(a.name) === norm(t));
const resolvePlace = (t) => VISIT.find((p) => norm(p.name) === norm(t));
const resolvePickup = (t) => PICKUP.find((p) => norm(p.name) === norm(t)) || PICKUP.find((p) => norm(p.area) === norm(t));
const resolveLang = (t) => LANGS.find((l) => l.short_name === norm(t)) || LANGS.find((l) => norm(l.full_name) === norm(t));

async function run(label, { dest, pickup, type, lang, from = "2026-06-20", to = "2026-07-20" }) {
  const qs = new URLSearchParams({ page: "1", per_page: "50", from_date: from, to_date: to, fields: FIELDS });
  const t = type && resolveType(type); if (t) qs.set("tour_type", t.id);
  const pu = pickup && resolvePickup(pickup); if (pu) qs.set("pickup_place_id", pu.id);
  const area = dest && resolveArea(dest);
  const place = dest && !area && resolvePlace(dest); if (place) qs.set("place_id", place.id);
  const lg = lang && resolveLang(lang);

  const res = await fetch(`${BASE}/tours?${qs}`, { headers: { Accept: "application/json", "BH-API-KEY": KEY } });
  const json = await res.json();
  let rows = json.data || [];
  const apiTotal = json.total_items;
  if (area) rows = rows.filter((r) => (r.associate_areas || []).includes(area.id));
  if (lg) rows = rows.filter((r) => { const d = r.language_availability?.[lg.short_name]; return d && Object.values(d).some((v) => String(v) === "1"); });

  console.log(`\n### ${label}`);
  console.log(`resolved: type=${t?.name || "-"} place=${place?.name || "-"} area=${area?.name || "-"} pickup=${pu ? pu.name + "(" + pu.area + ")" : "-"} lang=${lg?.full_name || "-"}`);
  console.log(`api_total=${apiTotal}  after_local_filter=${rows.length}`);
  for (const r of rows.slice(0, 4)) {
    const areas = (r.associate_areas || []).map((id) => AREA_NAME.get(id) || id).join("/");
    const langs = LANGS.filter((l) => { const d = r.language_availability?.[l.short_name]; return d && Object.values(d).some((v) => String(v) === "1"); }).map((l) => l.short_name).join(",");
    console.log(`  #${r.tour_num} ${r.name}  [${r.duration}d, areas:${areas || "-"}, langs:${langs || "-"}]`);
  }
}

(async () => {
  await run("Packages to the Dead Sea, pickup Tel Aviv", { dest: "Dead Sea", pickup: "Tel Aviv", type: "package" });
  await run("Daily tours to Jerusalem in Spanish", { dest: "Jerusalem", type: "daily", lang: "es" });
  await run("Anything in Galilee", { dest: "Galilee" });
  await run("Private tours, pickup Herzliya", { type: "private", pickup: "Herzliya" });
  await run("Specific place: Masada", { dest: "Masada" });
  await run("Tours in German (Golan Heights)", { dest: "Golan Heights", lang: "german" });
})();
