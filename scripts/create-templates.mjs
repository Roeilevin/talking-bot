// One-off: create the inbound assistant's WhatsApp templates via the Converto
// public MCP endpoint (JSON-RPC). Auth: CVTO env var = cvto_live_ channel key.
const KEY = process.env.CVTO;
if (!KEY) { console.error("Set CVTO"); process.exit(1); }
const ENDPOINT = "https://ai.convertomessage.com/api/v1/whatsapp/mcp";

const templates = [
  {
    name: "pickup_location", language: "en_US", category: "UTILITY", parameter_format: "POSITIONAL",
    components: [{
      type: "BODY",
      text: "Hi! This is Bein Harim Tours. Here are your pickup details:\n\nLocation: {{1}}\nPickup time: {{2}}\n\nOpen in Google Maps: {{3}}\n\nPlease arrive a few minutes early. Reply here if you need more help.",
      example: { body_text: [["Dan Tel Aviv Hotel, Tel Aviv", "08:00", "https://www.google.com/maps/search/?api=1&query=Dan%20Tel%20Aviv%20Hotel%2C%20Tel%20Aviv"]] },
    }],
  },
  {
    name: "inbound_inquiry", language: "en_US", category: "UTILITY", parameter_format: "POSITIONAL",
    components: [{
      type: "BODY",
      text: "New tour inquiry received via the phone agent:\n\n{{1}}\n\nPlease follow up with the customer.",
      example: { body_text: [["Type: Church group; Tour: Jerusalem and Bethlehem; Dates: June 2026; Group size: 25; Contact: John Smith; Phone: 972500000000"]] },
    }],
  },
  {
    name: "call_summary", language: "en_US", category: "UTILITY", parameter_format: "POSITIONAL",
    components: [{
      type: "BODY",
      text: "Thanks for calling Bein Harim Tours! Here is a summary of our conversation:\n\n{{1}}\n\nThis was an AI assistant and may make mistakes - please verify important details with our team. Reply here if you need anything else.",
      example: { body_text: [["You asked about the Masada and Dead Sea day tour. It includes hotel pickup at 06:30, a cable car up Masada, and time at the Dead Sea."]] },
    }],
  },
];

let id = 10;
for (const t of templates) {
  const body = { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "create_template", arguments: t } };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  const txt = j.result?.content?.[0]?.text;
  let parsed; try { parsed = JSON.parse(txt); } catch { parsed = null; }
  if (j.error) console.log(`X ${t.name}: RPC error ${JSON.stringify(j.error)}`);
  else if (parsed && parsed.ok === false) console.log(`X ${t.name}: ${parsed.error} ${JSON.stringify(parsed.details || {}).slice(0, 500)}`);
  else if (parsed && parsed.ok) console.log(`OK ${t.name}: id=${parsed.id} status=${parsed.status} category=${parsed.category}`);
  else console.log(`? ${t.name}: ${txt}`);
}
