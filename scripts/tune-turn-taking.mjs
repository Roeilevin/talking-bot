// Turn-taking + speech-rate settings for every inbound assistant.
//
// Fixes two reported call behaviours:
//   1. "the agent talks too fast" — voice_speed is nudged down across the board.
//      (The bigger half of that fix is in the tool output: lib/tour-availability.ts
//      now emits one option per sentence instead of a semicolon run-on.)
//   2. "when the agent is interrupted it gets stuck" — barge-in leaves the
//      assistant waiting for an end-of-turn that never confidently arrives, so
//      it sits silent. Three settings shorten that dead air:
//        - interruption_settings.start_speaking_plan: how long to wait after the
//          caller stops before replying (and how that changes on punctuation /
//          digits). Without it the platform default is conservative.
//        - transcription.settings.eot_timeout_ms: hard cap on waiting for a
//          confident end of turn. Default 5000ms IS the stuck pause; 2500 halves it.
//        - telephony_settings.user_idle_reply_secs: the safety net that makes the
//          assistant speak first after silence. 10s reads as a dead call.
//      interrupt_prediction_threshold only works on Deepgram Flux, so it is
//      applied to Flux assistants only (the per-language ones run nova-3).
//
// Everything is merged into the assistant's CURRENT config, so voices, keyterm
// boosts, tools and handoffs are preserved.
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/tune-turn-taking.mjs
//   $env:TELNYX_API_KEY="KEY..."; node scripts/tune-turn-taking.mjs --dry-run
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
const DRY = process.argv.includes("--dry-run");

const VOICE_SPEED = Number(process.env.VOICE_SPEED || 0.9);

const INTERRUPTION = {
  start_speaking_plan: {
    wait_seconds: 0.4,
    transcription_endpointing_plan: {
      on_punctuation_seconds: 0.2,
      on_no_punctuation_seconds: 1.2,
      on_number_seconds: 0.6,
    },
  },
};
// Flux only.
const INTERRUPT_PREDICTION = 0.4;
const FLUX_SETTINGS = { eot_threshold: 0.7, eot_timeout_ms: 2500 };
const IDLE_REPLY_SECS = 6;

const IDS = [
  ["assistant-8a3c00ed-392c-4479-a186-560890142518", "English inbound"],
  ["assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36", "Spanish"],
  ["assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005", "Hebrew"],
  ["assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c", "German"],
  ["assistant-a5e8d57e-aa99-4f7d-b1f2-b8485070054e", "Booking EN"],
  ["assistant-861cbddc-a827-468d-9917-45fc22a1fc82", "Booking ES"],
  ["assistant-4436ae27-6918-4075-874e-53784edd8fac", "Booking HE"],
  ["assistant-25d91760-4051-4946-950e-697597e4edaa", "Booking DE"],
];
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

for (const [id, label] of IDS) {
  const gr = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, { headers: H });
  if (!gr.ok) { console.error(`X GET ${label}: ${gr.status} ${(await gr.text()).slice(0, 300)}`); continue; }
  const cur = (await gr.json()).data || {};

  const isFlux = String(cur.transcription?.model || "").includes("flux");

  const body = {
    voice_settings: { ...(cur.voice_settings || {}), voice_speed: VOICE_SPEED },
    interruption_settings: {
      ...(cur.interruption_settings || {}),
      ...INTERRUPTION,
      ...(isFlux ? { interrupt_prediction_threshold: INTERRUPT_PREDICTION } : {}),
    },
    telephony_settings: {
      ...(cur.telephony_settings || {}),
      user_idle_reply_secs: IDLE_REPLY_SECS,
    },
  };
  if (isFlux) {
    body.transcription = {
      ...(cur.transcription || {}),
      settings: { ...(cur.transcription?.settings || {}), ...FLUX_SETTINGS },
    };
  }

  if (DRY) {
    console.log(`~ ${label} (${isFlux ? "flux" : cur.transcription?.model || "?"}):`, JSON.stringify(body));
    continue;
  }

  const ur = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, {
    method: "POST", headers: H, body: JSON.stringify(body),
  });
  const txt = await ur.text();
  console.log(`${ur.ok ? "OK" : "X "} ${label}: ${ur.status}${ur.ok ? ` (speed ${VOICE_SPEED}${isFlux ? ", flux eot + interrupt prediction" : ""})` : " " + txt.slice(0, 400)}`);
}
