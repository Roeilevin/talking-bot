import crypto from "node:crypto";
import { config } from "./config";
import { insertWhatsAppSend } from "./db";

const BASE_URL = "https://ai.convertomessage.com/api/v1/whatsapp";

// Optional metadata so the dashboard can classify a logged send. All sends funnel
// through sendWhatsAppMessage (free-text) and sendWhatsAppTemplate (template), so
// logging in just those two captures everything exactly once.
export interface SendMeta {
  direction?: "customer" | "ops";
  kind?: string;
  orderNumber?: number;
}

export async function sendWhatsAppMessage(
  to: string,
  text: string,
  meta: SendMeta = {}
): Promise<string> {
  const res = await fetch(`${BASE_URL}/messages/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.converto.apiKey}`,
    },
    body: JSON.stringify({ to, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Converto API error: ${res.status} ${body}`);
  }

  const json = await res.json();
  await insertWhatsAppSend({
    recipient: to,
    direction: meta.direction ?? null,
    kind: meta.kind ?? "message",
    text,
    channel: "session",
    order_number: meta.orderNumber ?? null,
  });
  return json.message_id;
}

// WhatsApp forbids newlines/tabs and long space runs inside template variables.
function sanitizeParam(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

// Sends a pre-approved WhatsApp template. Required for business-initiated
// messages (no open 24h session), e.g. messaging a caller after a phone call.
// params map positionally to the template's {{1}}, {{2}}, ... placeholders.
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  params: string[],
  language = "en_US",
  meta: SendMeta = {}
): Promise<string> {
  const res = await fetch(`${BASE_URL}/messages/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.converto.apiKey}`,
    },
    body: JSON.stringify({
      to,
      template_name: templateName,
      language,
      params: params.map(sanitizeParam),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Converto template API error: ${res.status} ${body}`);
  }

  const json = await res.json();
  await insertWhatsAppSend({
    recipient: to,
    direction: meta.direction ?? null,
    kind: meta.kind ?? `template:${templateName}`,
    text: params.join(" | "),
    channel: "template",
    order_number: meta.orderNumber ?? null,
  });
  return json.message_id;
}

// Meta rejects free-form (session) messages with error 131047 once the 24h
// customer-service window has closed. We detect that synchronously from the
// error body and fall back to an approved template — so no session state needs
// to be tracked anywhere.
function isOutsideWindowError(message: string): boolean {
  return /131047|24 hours|customer service window|re-?engage/i.test(message);
}

export type CallerSendChannel = "session" | "template";

// Sends a caller-facing WhatsApp message honoring WhatsApp's 24h session rule:
// if the caller has an open session, they receive the rich free-text
// `sessionText` (multi-line, with clickable links); otherwise Meta rejects it
// and we fall back through `templates` (first that succeeds wins). Returns which
// channel delivered the message. Throws only if every attempt fails.
export async function sendCallerMessage(
  to: string,
  sessionText: string,
  templates: Array<{ name: string; params: string[]; language?: string }>,
  meta: SendMeta = { direction: "customer", kind: "summary" }
): Promise<CallerSendChannel> {
  try {
    await sendWhatsAppMessage(to, sessionText, meta);
    return "session";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[converto] free-text send failed (${
        isOutsideWindowError(msg) ? "24h window closed" : msg
      }); falling back to template`
    );
  }

  let lastErr: unknown = new Error("sendCallerMessage: no fallback templates provided");
  for (const t of templates) {
    try {
      await sendWhatsAppTemplate(to, t.name, t.params, t.language ?? "en_US", meta);
      return "template";
    } catch (err) {
      lastErr = err;
      console.warn(
        `[converto] template '${t.name}' failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  throw lastErr;
}

// Sends a call status update to the team member who requested the call
// (the WhatsApp number that texted the order number). Falls back to the
// configured ops number if no recipient is provided.
export async function notifyTeam(to: string | undefined, text: string): Promise<void> {
  await sendWhatsAppMessage(to || config.opsWhatsAppNumber, text, {
    direction: "ops",
    kind: "status",
  });
}

export function verifyConvertoSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!signature || !config.converto.webhookSecret) return true;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.converto.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
