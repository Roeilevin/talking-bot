// Give the Hebrew assistant its own native Hebrew voice (Yael) and switch the
// main assistant's handoff to "distinct" voice mode so that voice is actually
// used (unified mode forces the main English-oriented voice -> Arabic-ish
// Hebrew accent).
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/fix-hebrew-voice.mjs
import fs from "node:fs";
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const KEY = process.env.TELNYX_API_KEY;
if (!KEY) { console.error("Set TELNYX_API_KEY"); process.exit(1); }
const MAIN = "assistant-8a3c00ed-392c-4479-a186-560890142518";
const HEB = "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005";
const HEB_VOICE = "Telnyx.Ultra.1daba551-67af-465e-a189-f91495aa2347"; // Yael - Casual Presence (he)
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function get(id) { return (await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, { headers })).json(); }
async function post(id, body) {
  const r = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) { console.error(`X ${id} failed: ${r.status} ${t.slice(0, 800)}`); process.exit(1); }
  return r.status;
}

// 1. Hebrew assistant -> Yael voice
const heb = await get(HEB);
const heb_vs = { ...(heb.voice_settings || {}), voice: HEB_VOICE, language_boost: "auto" };
console.log("Hebrew assistant voice ->", await post(HEB, { voice_settings: heb_vs }) && HEB_VOICE);

// 2. Main assistant handoff -> distinct voice mode
const main = await get(MAIN);
const tools = (main.tools || []).map((t) => {
  if (t.type === "handoff") return { ...t, handoff: { ...t.handoff, voice_mode: "distinct" } };
  return t;
});
console.log("Main handoff voice_mode ->", await post(MAIN, { tools }) && "distinct");
