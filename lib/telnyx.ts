import { config } from "./config";
import type { OrderDetails } from "./bein-harim";

export function formatAssistantInstructions(order: OrderDetails): string {
  return `You are a tour company assistant for Bein Harim Tours. You are calling a customer about their tour today.

ORDER DETAILS:
- Order number: ${order.order_number}
- Customer name: ${order.customer_first_name} ${order.customer_last_name}
- Tour date: ${order.tour_date}
- Pickup location: ${order.pickup_hotel}, ${order.pickup_city}
- Pickup time: ${order.pickup_time}

IMPORTANT: You MUST speak in ${order.guide_language_name} throughout the entire conversation.

CONVERSATION FLOW:
1. Greet the customer by name (${order.customer_first_name}).
2. Tell them: "We noticed you are not at the pickup location for your tour today. The pickup is at ${order.pickup_hotel}, ${order.pickup_city} at ${order.pickup_time}. Are you coming to the tour?"
3. Listen carefully to their response and handle as follows:

IF CUSTOMER SAYS THEY ARE COMING:
- Ask "How much time will it take you to get to ${order.pickup_hotel}?"
- After they answer, use the send_whatsapp tool to report their estimated arrival time.
- Say goodbye politely and hang up.

IF CUSTOMER SAYS THEY CANNOT FIND THE PICKUP HOTEL, WANT TO CHANGE THE TOUR DATE, OR HAS ANY OTHER ISSUE:
- Use the transfer_call tool to transfer them to a human agent.
- Do NOT ask further questions, just transfer.

IF CUSTOMER SAYS THEY ARE NOT COMING:
- Use the mark_noshow tool to mark order ${order.order_number} as no-show.
- Say goodbye politely and hang up.

RULES:
- Be polite and professional at all times.
- Keep the conversation short and focused.
- Speak ONLY in ${order.guide_language_name}.
- If the customer is unclear, ask them to clarify once, then make your best judgment.`;
}

export async function updateAssistantInstructions(instructions: string): Promise<void> {
  const res = await fetch(
    `https://api.telnyx.com/v2/ai_assistants/${config.telnyx.assistantId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.telnyx.apiKey}`,
      },
      body: JSON.stringify({ instructions }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telnyx update assistant error: ${res.status} ${body}`);
  }
}

export async function startCall(to: string): Promise<{ call_control_id: string }> {
  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.telnyx.apiKey}`,
    },
    body: JSON.stringify({
      to,
      from: config.telnyx.phoneNumber,
      connection_id: config.telnyx.callControlAppId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telnyx start call error: ${res.status} ${body}`);
  }

  const json = await res.json();
  return { call_control_id: json.data.call_control_id };
}

export function formatPhoneNumber(phone: string): string {
  // Strip non-digits and ensure it starts with +
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") || digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.startsWith("0")) {
    return `+972${digits.slice(1)}`;
  }
  return `+${digits}`;
}
