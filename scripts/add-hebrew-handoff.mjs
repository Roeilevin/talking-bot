// Update the MAIN inbound assistant to hand off Hebrew callers to the Hebrew
// agent, and fix the language_boost bug. Fetch-modify-write so existing
// voice/transcription settings are preserved (no clobbering).
//
// Changes:
//  1. voice_settings.language_boost: "English" -> "auto"  (so TTS speaks the detected language)
//  2. transcription.settings.keyterm: boost the Hebrew trigger words on Flux
//  3. greeting: append a short Hebrew invitation so Hebrew callers self-identify
//  4. instructions: rewrite the "## Language" section with the handoff rule
//  5. tools: append a unified-voice handoff tool targeting the Hebrew assistant
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/add-hebrew-handoff.mjs
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
const ID = process.env.INBOUND_ASSISTANT_ID || "assistant-8a3c00ed-392c-4479-a186-560890142518";
const HEBREW_ID = process.env.HEBREW_ASSISTANT_ID || "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005";
if (!KEY) { console.error("Set TELNYX_API_KEY in env or .env.local"); process.exit(1); }

const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// --- fetch current config ---
const cur = await (await fetch(`https://api.telnyx.com/v2/ai/assistants/${ID}`, { headers })).json();

// 1. language_boost fix (preserve the rest of voice_settings)
const voice_settings = { ...(cur.voice_settings || {}), language_boost: "auto" };

// 2. keyterm boost for Hebrew trigger words on the existing Flux transcription
const transcription = {
  ...(cur.transcription || {}),
  settings: { ...((cur.transcription || {}).settings || {}), keyterm: "Hebrew,Ivrit,Shalom" },
};

// 3. greeting: append Hebrew invitation (only once)
let greeting = cur.greeting || "";
if (!/עברית/.test(greeting)) {
  greeting = greeting.trim() + " לשירות בעברית, פשוט אמרו עברית.";
}

// 4. instructions: replace the "## Language" section with the handoff-aware one
const NEW_LANG = `## Language
- Greet in English. Then auto-detect the caller's language from their first reply and continue entirely in that language (English, Spanish, French, German, Russian, Italian, Portuguese, Dutch, Hindi, Japanese, etc.).
- HEBREW handoff: your speech-to-text engine cannot understand Hebrew. If the caller speaks Hebrew, says a Hebrew word (e.g. "Shalom", "Ivrit", "Hebrew", "עברית"), explicitly asks for Hebrew, or sends a turn that is unintelligible / not coherent in any language you support, do NOT keep asking them to repeat. Say one short bilingual line — e.g. "One moment — רגע אחד, מעביר אותך לנציג בעברית." — and immediately hand off to the "Hebrew Support" agent.`;

let instructions = cur.instructions || "";
const start = instructions.indexOf("## Language");
if (start !== -1) {
  // find the next "## " heading after the Language section
  const after = instructions.indexOf("\n## ", start + 3);
  const end = after === -1 ? instructions.length : after;
  instructions = instructions.slice(0, start) + NEW_LANG + (after === -1 ? "" : "\n") + instructions.slice(end).replace(/^\n/, after === -1 ? "" : "");
} else {
  instructions = NEW_LANG + "\n\n" + instructions;
}

// 5. tools: keep existing, add a unified handoff to the Hebrew assistant (once)
const tools = (cur.tools || []).filter((t) => t.type !== "handoff");
tools.push({
  type: "handoff",
  handoff: {
    voice_mode: "unified",
    ai_assistants: [{ name: "Hebrew Support", id: HEBREW_ID }],
  },
});

const body = { instructions, greeting, voice_settings, transcription, tools };

const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${ID}`, {
  method: "POST", headers, body: JSON.stringify(body),
});
const txt = await res.text();
if (!res.ok) { console.error(`X update failed: ${res.status} ${txt.slice(0, 1500)}`); process.exit(1); }
console.log(`OK main assistant ${ID} updated (${res.status})`);
console.log(`   language_boost -> auto, keyterm -> Hebrew,Ivrit,Shalom, handoff -> ${HEBREW_ID}`);
