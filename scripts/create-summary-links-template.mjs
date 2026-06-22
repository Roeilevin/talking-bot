// One-off: create the `call_summary_links` WhatsApp template via the Converto
// public MCP endpoint (JSON-RPC). Auth: CVTO env var = cvto_live_ channel key.
// Run:  $env:CVTO="cvto_live_..."; node scripts/create-summary-links-template.mjs
// (PowerShell)   or   CVTO=cvto_live_... node scripts/create-summary-links-template.mjs
//
// Two positional params: {{1}} = the conversation summary, {{2}} = an inline
// list of useful links (template variables can't contain newlines, so the
// send-summary route joins them with "  |  "). Used as the closed-24h-window
// fallback when the caller has no open WhatsApp session; inside a session the
// route sends rich free text with one clickable link per line instead.
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
  name: "call_summary_links",
  language: "en_US",
  category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [{
    type: "BODY",
    text: "Thanks for calling Bein Harim Tours! Here is a summary of our conversation:\n\n{{1}}\n\nUseful links:\n{{2}}\n\nThis was an AI assistant and may make mistakes - please verify important details with our team. Reply here if you need anything else.",
    example: {
      body_text: [[
        "You asked about the Masada and Dead Sea day tour. It includes hotel pickup at 06:30, a cable car up Masada, and time at the Dead Sea.",
        "Masada and the Dead Sea day tour: https://www.beinharimtours.com/masada-and-dead-sea-day-tour/?affiliate_id=2909",
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
if (j.error) console.log(`X call_summary_links: RPC error ${JSON.stringify(j.error)}`);
else if (parsed && parsed.ok === false) console.log(`X call_summary_links: ${parsed.error} ${JSON.stringify(parsed.details || {}).slice(0, 500)}`);
else if (parsed && parsed.ok) console.log(`OK call_summary_links: id=${parsed.id} status=${parsed.status} category=${parsed.category}`);
else console.log(`? call_summary_links: ${txt}`);
