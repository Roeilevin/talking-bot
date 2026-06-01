// One-off: create the `tour_availability` WhatsApp template via the Converto
// public MCP endpoint (JSON-RPC). Auth: CVTO env var = cvto_live_ channel key.
// Run:  $env:CVTO="cvto_live_..."; node scripts/create-availability-template.mjs
// (PowerShell)   or   CVTO=cvto_live_... node scripts/create-availability-template.mjs
//
// Two positional params: {{1}} = a one-line summary, {{2}} = the "; "-joined
// list of tours (name, #number, duration, from-price, link). The
// get_tour_availability tool fills these via listForWhatsApp().
import fs from "node:fs";
// Allow CVTO to come from .env.local too (so it can be run without exporting).
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const KEY = process.env.CVTO;
if (!KEY) { console.error("Set CVTO (the cvto_live_ channel key) in env or .env.local"); process.exit(1); }
const ENDPOINT = "https://ai.convertomessage.com/api/v1/whatsapp/mcp";

const template = {
  name: "tour_availability",
  language: "en_US",
  category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [{
    type: "BODY",
    text: "Here are tour options from Bein Harim Tours:\n\n{{1}}\n\n{{2}}\n\nThis was an AI assistant and may make mistakes - please verify details before booking. Reply here to book or if you need anything else.",
    example: {
      body_text: [[
        "3 tours to the Dead Sea (Jun 20-Jul 20)",
        "Masada, Bethlehem & Jericho, 2 Days (#9201, 2d from $387 per person) https://www.beinharimtours.com/bethlehem-jericho-and-masada-2-days-/?affiliate_id=2909; Masada and the Dead Sea (#31, 1d from $115 per person) https://www.beinharimtours.com/masada-and-dead-sea-day-tour/?affiliate_id=2909",
      ]],
    },
  }],
};

const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_template", arguments: template } };
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const j = await res.json();
const txt = j.result?.content?.[0]?.text;
let parsed; try { parsed = JSON.parse(txt); } catch { parsed = null; }
if (j.error) console.log(`X tour_availability: RPC error ${JSON.stringify(j.error)}`);
else if (parsed && parsed.ok === false) console.log(`X tour_availability: ${parsed.error} ${JSON.stringify(parsed.details || {}).slice(0, 500)}`);
else if (parsed && parsed.ok) console.log(`OK tour_availability: id=${parsed.id} status=${parsed.status} category=${parsed.category}`);
else console.log(`? tour_availability: ${txt}`);
