// Probe 3: confirm pickup_place_id filtering with real values, date-window
// sensitivity, and price structure across tour types. Run: node scripts/probe-tours3.mjs
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
  const res = await fetch(`${BASE}/tours?${qs}`, { headers: hdr });
  let json = null; const text = await res.text();
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

(async () => {
  // A) pickup_place_id with REAL values from the pickup options table.
  console.log("=== A) pickup_place_id filtering (baseline date range, no other filter) ===");
  const base = (await get("page=1&per_page=1&from_date=2026-06-20&to_date=2026-07-20")).json?.total_items;
  console.log("baseline total_items:", base);
  for (const pid of ["1", "145", "122", "328", "271", "263"]) {
    const r = await get(`page=1&per_page=1&from_date=2026-06-20&to_date=2026-07-20&pickup_place_id=${pid}`);
    console.log(`pickup_place_id=${pid.padEnd(4)} -> total_items ${r.json?.total_items}`);
  }

  // B) Date-window sensitivity: does from/to actually gate availability?
  console.log("\n=== B) date window sensitivity (tour_type=1 dailies) ===");
  for (const [label, qs] of [
    ["single day 2026-06-20", "from_date=2026-06-20&to_date=2026-06-20"],
    ["single day 2026-06-21", "from_date=2026-06-21&to_date=2026-06-21"],
    ["wide 2026-06-20..07-20", "from_date=2026-06-20&to_date=2026-07-20"],
    ["far past 2020-01-01", "from_date=2020-01-01&to_date=2020-01-02"],
    ["far future 2030-01-01", "from_date=2030-01-01&to_date=2030-01-02"],
    ["no dates", ""],
  ]) {
    const r = await get(`page=1&per_page=1&tour_type=1${qs ? "&" + qs : ""}`);
    console.log(`${label.padEnd(26)} -> status ${r.status}, total_items ${r.json?.total_items}`);
  }

  // C) Price structure across types (daily vs private vs package).
  console.log("\n=== C) prices structure by type ===");
  for (const tt of ["1", "2", "3"]) {
    const r = await get(`page=1&per_page=1&from_date=2026-06-20&to_date=2026-07-20&tour_type=${tt}&fields=tour_num,name,prices,pick_up`);
    const t = r.json?.data?.[0] || {};
    console.log(`\ntype ${tt}: ${t.name} (#${t.tour_num})`);
    console.log("  prices:", JSON.stringify(t.prices)?.slice(0, 400));
    console.log("  pick_up:", JSON.stringify(t.pick_up)?.slice(0, 300));
  }
})();
