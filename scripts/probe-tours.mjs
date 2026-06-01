// Probe the Bein Harim /api/v2/tours endpoint to discover which fields and
// filters it supports, so we can design get_tour_availability accurately.
//
// Run:  node scripts/probe-tours.mjs
// Reads BH_API_KEY (+ optional BH_API_BASE_URL) from .env.local or the environment.

import fs from "node:fs";

function loadEnvLocal() {
  for (const f of [".env.local", ".env.development.local", ".env"]) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* file may not exist */
    }
  }
}
loadEnvLocal();

const BASE = process.env.BH_API_BASE_URL || "https://dev-v3.beinharimtours.com/api/v2";
const KEY = process.env.BH_API_KEY;

if (!KEY) {
  console.error(
    "Missing BH_API_KEY. Add it to talking-bot/.env.local as:\n  BH_API_KEY=your_dev_key\nthen re-run: node scripts/probe-tours.mjs"
  );
  process.exit(1);
}

async function call(label, qs) {
  const url = `${BASE}/tours?${qs}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "BH-API-KEY": KEY,
      },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    console.log(`\n=== ${label} ===`);
    console.log(`GET ${url}`);
    console.log(`HTTP ${res.status}`);
    if (json) {
      const sample = Array.isArray(json.data) ? json.data.slice(0, 3) : json.data;
      console.log(
        JSON.stringify(
          {
            error: json.error,
            total_items: json.total_items,
            data_keys: Array.isArray(json.data) && json.data[0] ? Object.keys(json.data[0]) : null,
            sample,
          },
          null,
          1
        )
      );
    } else {
      console.log(text.slice(0, 600));
    }
    return json;
  } catch (e) {
    console.log(`\n=== ${label} ===\nGET ${url}\nFETCH ERROR: ${e.message}`);
    return null;
  }
}

const COMMON = "page=1&per_page=5&from_date=2026-06-20&to_date=2026-07-20";

// 1) No fields → does it return the full object (revealing every available field)?
await call("all-fields (no fields param)", `${COMMON}&tour_type=3`);

// 2) Ask explicitly for fields we hope exist (price, dates, seats, name, etc.)
await call(
  "rich fields guess",
  `${COMMON}&tour_type=3&fields=id,tour_num,name,title,price,date,dates,available,availability,seats,seats_available,duration,language,languages`
);

// 3) Reproduce the user's exact example (sanity check the join).
await call("user example (place 122, pickup 1, type 3)", `${COMMON}&tour_type=3&place_id=122&pickup_place_id=1`);

// 4) Does it accept an AREA filter (city) instead of a single place_id?
await call("area filter probe (place_area_id)", `${COMMON}&tour_type=3&place_area_id=1`);
await call("area filter probe (area_id)", `${COMMON}&tour_type=3&area_id=1`);

// 5) Does it accept a language filter, and what is the param called?
await call("language filter probe (language=3)", `${COMMON}&tour_type=3&language=3`);
await call("language filter probe (language_id=3)", `${COMMON}&tour_type=3&language_id=3`);

console.log("\nDone.");
