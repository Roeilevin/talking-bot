// Build the reference lookup tables the availability tool resolves against,
// from the BH dropdown exports. Run once (re-run if the option lists change):
//   node scripts/build-tour-reference.mjs
// Source files live in the user's Downloads; output JSON is committed under data/.
import fs from "node:fs";
import path from "node:path";

const DOWNLOADS = process.env.BH_DOWNLOADS || "C:/Users/roei1/Downloads";
const OUT = path.join(process.cwd(), "data");

const read = (p) => fs.readFileSync(p, "utf8");
const lines = (s) => s.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.length);

// --- tour types: "1<tab>Daily Tours" ------------------------------------
function buildTourTypes() {
  const txt = read(path.join(DOWNLOADS, "Untitled"));
  const rows = lines(txt).map((l) => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return { id: m[1], name: m[2].trim() };
  });
  return rows;
}

// --- languages: CSV "id,short_name,full_name" ---------------------------
function buildLanguages() {
  const txt = read(path.join(DOWNLOADS, "Untitled.csv"));
  const rows = lines(txt).slice(1).map((l) => {
    const [id, short_name, full_name] = l.split(",");
    return { id: id.trim(), short_name: short_name.trim(), full_name: full_name.trim() };
  });
  return rows;
}

// --- place tables: TSV "id<tab>place_name<tab>place_area_id<tab>area_name"
function buildPlaces(file) {
  const txt = read(path.join(DOWNLOADS, file));
  const rows = lines(txt).slice(1).map((l) => {
    const [id, place_name, place_area_id, area_name] = l.split("\t");
    return {
      id: (id || "").trim(),
      name: (place_name || "").trim(),
      area_id: (place_area_id || "").trim(),
      area: (area_name || "").trim(),
    };
  }).filter((r) => r.id && r.name);
  return rows;
}

const tourTypes = buildTourTypes();
const languages = buildLanguages();
const visitPlaces = buildPlaces("api_v2_tours_place_id_options.tsv");
const pickupPlaces = buildPlaces("api_v2_tours_pickup_place_id_options.tsv");

// area_id -> area name, unioned across both place tables.
const areaMap = new Map();
for (const r of [...visitPlaces, ...pickupPlaces]) {
  if (r.area_id && r.area && !areaMap.has(r.area_id)) areaMap.set(r.area_id, r.area);
}
const areas = [...areaMap.entries()]
  .map(([id, name]) => ({ id, name }))
  .sort((a, b) => Number(a.id) - Number(b.id));

const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote data/${name} (${Array.isArray(data) ? data.length : "?"} rows)`);
};

write("tour-types.json", tourTypes);
write("languages.json", languages);
write("visit-places.json", visitPlaces);
write("pickup-places.json", pickupPlaces);
write("areas.json", areas);

console.log("\ntour types:", tourTypes.map((t) => `${t.id}=${t.name}`).join(", "));
console.log("languages:", languages.map((l) => `${l.id}=${l.short_name}`).join(", "));
console.log("areas:", areas.length, "| e.g.", areas.slice(0, 8).map((a) => `${a.id}=${a.name}`).join(", "));
