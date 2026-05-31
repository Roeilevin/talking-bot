import crypto from "node:crypto";
import { config } from "./config";

const BASE_URL = "https://ai.convertomessage.com/api/v1/whatsapp";

export async function sendWhatsAppMessage(to: string, text: string): Promise<string> {
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
  return json.message_id;
}

// Sends a call status update to the team member who requested the call
// (the WhatsApp number that texted the order number). Falls back to the
// configured ops number if no recipient is provided.
export async function notifyTeam(to: string | undefined, text: string): Promise<void> {
  await sendWhatsAppMessage(to || config.opsWhatsAppNumber, text);
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
