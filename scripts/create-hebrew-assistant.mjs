// Create the Hebrew-language inbound support assistant on Telnyx.
// Config from scripts/hebrew-assistant.json; tools reused from the main
// inbound assistant config (scripts/update-inbound-assistant.json), minus any
// handoff tool (the Hebrew agent never hands back -> avoids handoff loops).
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/create-hebrew-assistant.mjs
// Prints the new assistant id. Re-running creates a duplicate; create once.
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

const heb = JSON.parse(fs.readFileSync("scripts/hebrew-assistant.json", "utf8"));
const inbound = JSON.parse(fs.readFileSync("scripts/update-inbound-assistant.json", "utf8"));

// Reuse the inbound assistant's tools, but drop any handoff tool so the Hebrew
// agent can't hand off (back to itself or onward) and create a loop.
const tools = (inbound.tools || []).filter((t) => t.type !== "handoff");

const body = {
  name: heb.name,
  description: heb.description,
  model: heb.model,
  instructions: heb.instructions,
  greeting: heb.greeting,
  transcription: heb.transcription, // deepgram/nova-3, language: "he"
  voice_settings: {
    voice: "Telnyx.Ultra.1daba551-67af-465e-a189-f91495aa2347", // Yael - Casual Presence (native Hebrew voice)
    voice_speed: 0.9,
    background_audio: { type: "predefined_media", value: "silence", volume: 0.5 },
    similarity_boost: 0.5,
    style: 0,
    use_speaker_boost: true,
    language_boost: "auto",
    expressive_mode: true,
  },
  tools,
};

const res = await fetch("https://api.telnyx.com/v2/ai/assistants", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const txt = await res.text();
if (!res.ok) { console.error(`X create failed: ${res.status} ${txt.slice(0, 1200)}`); process.exit(1); }
let id = "";
try { id = JSON.parse(txt).id || JSON.parse(txt).assistant_id || ""; } catch {}
console.log(`OK Hebrew assistant created (${res.status})`);
console.log(`ASSISTANT_ID=${id}`);
