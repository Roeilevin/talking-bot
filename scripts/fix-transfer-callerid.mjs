// Set an owned caller ID (`from`) on the transfer tool of every inbound
// assistant. Without it, the transfer leg presents the caller's own number as
// CLI and the destination rejects it -> instant hangup. `from` must be an owned
// Telnyx number whose connection has an outbound voice profile; the IL Bein
// Harim line qualifies (its connection is the IVR app with the Default profile).
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/fix-transfer-callerid.mjs
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
if (!KEY) { console.error("Set TELNYX_API_KEY"); process.exit(1); }

const FROM = process.env.IVR_TRANSFER_CALLER_ID || "+97233825488";
const IDS = [
  "assistant-8a3c00ed-392c-4479-a186-560890142518", // English inbound
  "assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36", // Spanish
  "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005", // Hebrew
  "assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c", // German
];
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

for (const id of IDS) {
  const gr = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, { headers: H });
  if (!gr.ok) { console.error(`X GET ${id}: ${gr.status} ${(await gr.text()).slice(0,300)}`); continue; }
  const a = await gr.json();
  const cfg = a.data || a;
  const orig = cfg.tools || [];
  // Drop the shared hangup (auto-applied; re-declaring 400s), keep everything
  // else (incl. any handoff). Stamp `from` onto transfer tools.
  const tools = orig
    .filter((t) => t.type !== "hangup")
    .map((t) =>
      t.type === "transfer"
        ? { ...t, transfer: { ...t.transfer, from: FROM } }
        : t
    );
  const nTransfer = tools.filter((t) => t.type === "transfer").length;
  const ur = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ tools }),
  });
  const txt = await ur.text();
  console.log(`${ur.ok ? "OK" : "X"} ${id}: ${ur.status} (transfer tools patched: ${nTransfer})${ur.ok ? "" : " " + txt.slice(0, 400)}`);
}
