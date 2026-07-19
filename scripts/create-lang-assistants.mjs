// Create the Spanish + German inbound support assistants on Telnyx.
// Mirrors scripts/create-hebrew-assistant.mjs: config from
// scripts/{spanish,german}-assistant.json, tools reused from the main inbound
// assistant (scripts/update-inbound-assistant.json) minus any handoff tool.
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/create-lang-assistants.mjs
// Prints the new assistant ids. Re-running creates duplicates; create once.
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

const inbound = JSON.parse(fs.readFileSync("scripts/update-inbound-assistant.json", "utf8"));
// Reuse the inbound assistant's tools, but drop any handoff tool so these
// single-language agents can't hand off and create a loop, and drop hangup —
// the shared "Default hangup" is auto-applied and declaring another 400s.
const tools = (inbound.tools || []).filter(
  (t) => t.type !== "handoff" && t.type !== "hangup"
);

// Native Ultra voices per language (from lib/telnyx.ts VOICE_BY_LANG).
const VOICE = {
  es: "727f663b-0e90-4031-90f2-558b7334425b", // Carmen - Friendly Neighbor
  de: "38aabb6a-f52b-4fb0-a3d1-988518f4dc06", // Alina - Engaging Assistant
};

async function createOne(lang, file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const body = {
    name: cfg.name,
    description: cfg.description,
    model: cfg.model,
    instructions: cfg.instructions,
    greeting: cfg.greeting,
    transcription: cfg.transcription, // deepgram/nova-3, language: es|de
    voice_settings: {
      voice: `Telnyx.Ultra.${VOICE[lang]}`,
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
  if (!res.ok) { console.error(`X ${lang} create failed: ${res.status} ${txt.slice(0, 1200)}`); process.exit(1); }
  let id = "";
  try { id = JSON.parse(txt).id || JSON.parse(txt).assistant_id || ""; } catch {}
  console.log(`OK ${lang} assistant created (${res.status})`);
  console.log(`${lang.toUpperCase()}_ASSISTANT_ID=${id}`);
}

await createOne("es", "scripts/spanish-assistant.json");
await createOne("de", "scripts/german-assistant.json");
