// Fetch recent Telnyx AI conversations and surface the get_tour_availability
// tool calls + results (and the raw message shape so we can see what the agent
// actually sent/received). Direct API calls with the CORRECT key (the MCP server
// is on the wrong account).
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const KEY = process.env.TELNYX_API_KEY || (env.match(/TELNYX_API_KEY="?([^"\n\r]+)"?/) || [])[1];
const INBOUND = (env.match(/TELNYX_INBOUND_ASSISTANT_ID="?([^"\n\r]+)"?/) || [])[1]
  || "assistant-8a3c00ed-392c-4479-a186-560890142518";
const API = "https://api.telnyx.com/v2";

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const limit = Number(process.argv[2] || 25);

// 1) recent conversations (newest first)
const conv = await get(`/ai/conversations?order=created_at.desc&limit=${limit}`);
const rows = conv.json?.data || [];
console.log(`conversations endpoint HTTP ${conv.status}, returned ${rows.length}`);
if (!rows.length) { console.log(JSON.stringify(conv.json).slice(0, 500)); process.exit(0); }

for (const c of rows) {
  const meta = c.metadata || {};
  const when = c.last_message_at || c.created_at;
  const caller = meta.telnyx_end_user_target || meta.caller || meta.from || "?";
  const aid = meta.assistant_id || "?";
  const m = await get(`/ai/conversations/${encodeURIComponent(c.id)}/messages`);
  const msgs = m.json?.data || [];

  // pull tool-related messages
  const toolEvents = [];
  for (const msg of msgs) {
    const tc = msg.tool_calls || msg.tool_call || null;
    const isToolResult = (msg.role === "tool") || msg.tool_call_id;
    if (tc) {
      const calls = Array.isArray(tc) ? tc : [tc];
      for (const call of calls) {
        const fn = call.function?.name || call.name;
        const args = call.function?.arguments || call.arguments;
        toolEvents.push(`  → CALL ${fn}(${typeof args === "string" ? args : JSON.stringify(args)})`);
      }
    } else if (isToolResult) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      toolEvents.push(`  ← RESULT ${String(content).slice(0, 600)}`);
    }
  }

  const availTouched = toolEvents.some((e) => e.includes("tour_availability") || e.includes("availability") || e.includes("no_results") || e.includes("from_date"));
  if (toolEvents.length) {
    console.log(`\n[${when}] conv=${c.id} caller=${caller} assistant=${aid} msgs=${msgs.length}${availTouched ? "  ***AVAILABILITY***" : ""}`);
    for (const e of toolEvents) console.log(e);
  }
}
