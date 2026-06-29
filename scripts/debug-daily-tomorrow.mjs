// Reproduce the exact /api/v2/tours calls the availability tool makes for
// "daily tours tomorrow", plus diagnostic variants to see why it's empty.
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = (env.match(/BH_API_KEY="?([^"\n\r]+)"?/) || [])[1];
const BASE = (env.match(/BH_API_BASE_URL="?([^"\n\r]+)"?/) || [])[1]
  || "https://dev-v3.beinharimtours.com/api/v2";

const FIELDS = ["tour_num","name","type_id","duration","associate_areas"].join(",");

function jslmToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso, d) {
  const [y, m, dd] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd)); t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const today = jslmToday();
const tomorrow = addDays(today, 1);

async function call(label, params) {
  const qs = new URLSearchParams({ page: "1", per_page: "50", fields: FIELDS, ...params });
  const url = `${BASE}/tours?${qs}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "BH-API-KEY": KEY } });
  let body = {};
  try { body = await res.json(); } catch { body = { parseError: true }; }
  const data = body.data || [];
  console.log(`\n=== ${label} ===`);
  console.log("GET " + url.replace(BASE, "<BASE>"));
  console.log(`HTTP ${res.status} | error=${JSON.stringify(body.error)} | total_items=${body.total_items} | returned=${data.length}`);
  const byType = {};
  for (const t of data) byType[t.type_id] = (byType[t.type_id] || 0) + 1;
  console.log("type_id breakdown:", JSON.stringify(byType));
  console.log("sample:", data.slice(0, 5).map((t) => `${t.tour_num}:${t.name}`).join(" | ") || "(none)");
}

console.log(`Jerusalem today=${today}  tomorrow=${tomorrow}`);

// 1) Exactly what the agent sends for "daily tours tomorrow"
await call("daily, tomorrow→tomorrow (agent's call)", { tour_type: "1", from_date: tomorrow, to_date: tomorrow });
// 2) Any type, tomorrow only
await call("ANY type, tomorrow→tomorrow", { from_date: tomorrow, to_date: tomorrow });
// 3) Daily, today only
await call("daily, today→today", { tour_type: "1", from_date: today, to_date: today });
// 4) Daily, next 7 days
await call("daily, tomorrow→+7d", { tour_type: "1", from_date: tomorrow, to_date: addDays(tomorrow, 7) });
// 5) Daily, next 60 days (the no-date default window)
await call("daily, today→+60d (default window)", { tour_type: "1", from_date: today, to_date: addDays(today, 60) });
