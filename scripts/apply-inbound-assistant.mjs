// Apply scripts/update-inbound-assistant.json to the live inbound AI assistant
// via the Telnyx API. The Telnyx MCP server is on a different account, so this
// uses a direct call with the correct-account key.
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/apply-inbound-assistant.mjs
// or put TELNYX_API_KEY (and optionally INBOUND_ASSISTANT_ID) in .env.local.
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
if (!KEY) { console.error("Set TELNYX_API_KEY in env or .env.local"); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync("scripts/update-inbound-assistant.json", "utf8"));

const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${ID}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(cfg),
});
const txt = await res.text();
if (!res.ok) { console.error(`X update failed: ${res.status} ${txt.slice(0, 800)}`); process.exit(1); }
console.log(`OK assistant ${ID} updated (${res.status})`);
