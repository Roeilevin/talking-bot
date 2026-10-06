// Apply scripts/{spanish,german,hebrew}-assistant.json to the LIVE per-language
// support assistants (IVR options 2/3/4 -> es/he/de). The English one has its
// own script (apply-inbound-assistant.mjs); create-lang-assistants.mjs only
// CREATES, so without this the language agents drift from the repo.
//
// Each assistant is fetched first and posted back whole, with only instructions
// and greeting replaced — model, voice, transcription and tools stay exactly as
// they are live.
//
// Ids default to the ones wired into lib/ivr.ts; override with
// TELNYX_ASSISTANT_ES / _HE / _DE.
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/apply-lang-assistants.mjs
//
// The per-language BOOKING agents (IVR option 3) carry a copy of these
// instructions, so run scripts/create-booking-assistants.mjs afterwards to
// propagate the same change to them.
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
if (!KEY) { console.error("Set TELNYX_API_KEY in env or .env.local"); process.exit(1); }

const API = "https://api.telnyx.com/v2/ai/assistants";
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const LANGS = {
  es: {
    id: process.env.TELNYX_ASSISTANT_ES || "assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36",
    file: "scripts/spanish-assistant.json",
  },
  he: {
    id: process.env.TELNYX_ASSISTANT_HE || "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005",
    file: "scripts/hebrew-assistant.json",
  },
  de: {
    id: process.env.TELNYX_ASSISTANT_DE || "assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c",
    file: "scripts/german-assistant.json",
  },
};

// Read-only fields the API returns but rejects on the way back in.
function strip(assistant) {
  const { id, created_at, updated_at, ...rest } = assistant;
  if (Array.isArray(rest.tools)) {
    rest.tools = rest.tools.map(({ tool_id, shared, ...t }) => t);
  }
  return rest;
}

for (const [lang, cfg] of Object.entries(LANGS)) {
  const local = JSON.parse(fs.readFileSync(cfg.file, "utf8"));

  const get = await fetch(`${API}/${cfg.id}`, { headers: H });
  const getTxt = await get.text();
  if (!get.ok) { console.error(`X ${lang} fetch failed: ${get.status} ${getTxt.slice(0, 600)}`); process.exit(1); }

  const body = {
    ...strip(JSON.parse(getTxt)),
    instructions: local.instructions,
    greeting: local.greeting,
  };

  const res = await fetch(`${API}/${cfg.id}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) { console.error(`X ${lang} update failed: ${res.status} ${txt.slice(0, 900)}`); process.exit(1); }
  console.log(`OK ${lang} assistant ${cfg.id} updated (${res.status})`);
}
console.log("Done. Re-run scripts/create-booking-assistants.mjs to update the booking agents too.");
