// Shared plumbing for the one-off Converto scripts: env loading, the MCP
// (JSON-RPC) endpoint used to manage templates, and the REST endpoints the app
// itself sends through. Kept in one place so a template is created and then
// tested against exactly the same channel.
import fs from "node:fs";

export function loadEnv(files = [".env.local", ".env"]) {
  for (const f of files) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
}

// The channel key: CVTO is what the older scripts use, CONVERTO_API_KEY is what
// the app runs on. Either is fine — they are the same credential.
export function requireKey() {
  const key = process.env.CVTO || process.env.CONVERTO_API_KEY;
  if (!key) {
    console.error(
      "Set CVTO (the cvto_live_ channel key) in the environment or .env.local.\n" +
        "PowerShell:  $env:CVTO=\"cvto_live_...\""
    );
    process.exit(1);
  }
  return key;
}

const MCP = "https://ai.convertomessage.com/api/v1/whatsapp/mcp";
const REST = "https://ai.convertomessage.com/api/v1/whatsapp";

export async function rpc(key, name, args) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await res.json();
  if (j.error) return { ok: false, why: `RPC error ${JSON.stringify(j.error)}` };
  const txt = j.result?.content?.[0]?.text;
  let parsed;
  try { parsed = JSON.parse(txt); } catch { parsed = null; }
  if (parsed?.ok === false) {
    return { ok: false, parsed, why: `${parsed.error} ${JSON.stringify(parsed.details || {}).slice(0, 600)}` };
  }
  return { ok: true, parsed, txt };
}

export async function toolNames(key) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const j = await res.json();
  return (j.result?.tools || []).map((t) => t.name);
}

export function componentsOf(tpl) {
  return tpl?.components || tpl?.template?.components || [];
}

export function buttonsOf(tpl) {
  const c = componentsOf(tpl).find((x) => String(x?.type || "").toUpperCase() === "BUTTONS");
  return c?.buttons || (c ? [c] : null);
}

// Is this template already on the channel? Returns it, or null. Tool names
// differ between channels, so the lister is discovered rather than assumed.
export async function findTemplate(key, name) {
  const names = await toolNames(key);
  const lister = names.find((n) => /list_templates|get_templates|templates_list|list_message_templates/i.test(n));
  if (!lister) {
    console.log(`(no template-listing tool among: ${names.join(", ")} — skipping the exists check)`);
    return null;
  }
  const r = await rpc(key, lister, {});
  const list = r.parsed?.templates || r.parsed?.data || (Array.isArray(r.parsed) ? r.parsed : []);
  return list.find((t) => t?.name === name) || null;
}

export async function createTemplate(key, template) {
  const r = await rpc(key, "create_template", template);
  if (r.ok && r.parsed?.ok) {
    return { ok: true, why: `id=${r.parsed.id} status=${r.parsed.status} category=${r.parsed.category}` };
  }
  return { ok: false, why: r.why || String(r.txt) };
}

// ---- REST: the same two endpoints lib/converto.ts sends through ----

export async function sendTemplate(key, { to, template_name, language, params, extra = {} }) {
  const res = await fetch(`${REST}/messages/template`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, template_name, language, params, ...extra }),
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body };
}

export async function sendText(key, { to, text }) {
  const res = await fetch(`${REST}/messages/text`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, text }),
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body };
}

// Same rule as normalizePhone() in lib/db.ts: digits only, Israeli 0 -> 972.
export function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  return d;
}

// Interactive quick-reply buttons. Session-only (inside WhatsApp's 24h window),
// which is why it can never replace the template for a business-initiated send.
export async function sendButtons(key, { to, text, buttons }) {
  const res = await fetch(`${REST}/messages/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      text,
      buttons: buttons.map((b) => ({ id: b.id, title: b.title, type: "reply" })),
    }),
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body };
}
