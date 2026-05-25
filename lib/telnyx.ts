import { config } from "./config";
import type { OrderDetails } from "./bein-harim";

export async function startAssistantCall(
  order: OrderDetails
): Promise<{ call_control_id: string }> {
  const to = formatPhoneNumber(order.customer_phone);

  const res = await fetch(
    `https://api.telnyx.com/v2/ai/assistants/${config.telnyx.assistantId}/calls`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.telnyx.apiKey}`,
      },
      body: JSON.stringify({
        to,
        from: config.telnyx.phoneNumber,
        dynamic_variables: {
          order_number: String(order.order_number),
          customer_name: `${order.customer_first_name} ${order.customer_last_name}`,
          customer_phone: to,
          tour_date: order.tour_date,
          pickup_hotel: order.pickup_hotel,
          pickup_city: order.pickup_city,
          pickup_time: order.pickup_time,
          language_name: order.guide_language_name,
          language_code: order.guide_language_code,
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
