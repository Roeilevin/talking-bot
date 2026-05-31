import { config } from "./config";
import type { OrderDetails } from "./bein-harim";

// Warm/friendly female Telnyx Ultra voices, one per language. Selected per call
// via the assistant's templated voice field (Telnyx.Ultra.{{voice_id}}).
const VOICE_BY_LANG: Record<string, string> = {
  he: "1daba551-67af-465e-a189-f91495aa2347", // Yael - Casual Presence
  en: "00a77add-48d5-4ef6-8157-71e5437b282d", // Callie - Encourager
  es: "727f663b-0e90-4031-90f2-558b7334425b", // Carmen - Friendly Neighbor
  fr: "6c64b57a-bc65-48e4-bff4-12dbe85606cd", // Eloise - Dialogue Anchor
  ru: "064b17af-d36b-4bfb-b003-be07dba1b649", // Tatiana - Friendly Storyteller
  de: "38aabb6a-f52b-4fb0-a3d1-988518f4dc06", // Alina - Engaging Assistant
  it: "d718e944-b313-4998-b011-d1cc078d4ef3", // Liv - Casual Friend
};
const DEFAULT_VOICE_ID = VOICE_BY_LANG.en;

function voiceIdForLanguage(languageCode: string): string {
  const key = (languageCode || "").slice(0, 2).toLowerCase();
  return VOICE_BY_LANG[key] || DEFAULT_VOICE_ID;
}

export async function startAssistantCall(
  order: OrderDetails
): Promise<{ call_control_id: string }> {
  const to = formatPhoneNumber(order.customer_phone);

  const res = await fetch(
    `https://api.telnyx.com/v2/texml/ai_calls/${config.telnyx.callControlAppId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.telnyx.apiKey}`,
      },
      body: JSON.stringify({
        To: to,
        From: config.telnyx.phoneNumber,
        AIAssistantId: config.telnyx.assistantId,
        AIAssistantDynamicVariables: {
          order_number: String(order.order_number),
          customer_name: `${order.customer_first_name} ${order.customer_last_name}`,
          customer_phone: to,
          tour_date: order.tour_date,
          pickup_hotel: order.pickup_hotel,
          pickup_city: order.pickup_city,
          pickup_time: order.pickup_time,
          language_name: order.guide_language_name,
          language_code: order.guide_language_code,
          voice_id: voiceIdForLanguage(order.guide_language_code),
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telnyx start assistant call error: ${res.status} ${body}`);
  }

  const json = await res.json();
  return { call_control_id: json.data?.call_control_id || json.call_control_id };
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") || digits.startsWith("1") || digits.startsWith("242")) {
    return `+${digits}`;
  }
  if (digits.startsWith("0")) {
    return `+972${digits.slice(1)}`;
  }
  return `+${digits}`;
}
