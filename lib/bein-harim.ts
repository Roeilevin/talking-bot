import { config } from "./config";

export interface OrderDetails {
  order_number: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  pdf_link: string;
  tour_date: string;
  pickup_city: string;
  pickup_hotel: string;
  pickup_time: string;
  guide_language_code: string;
  guide_language_name: string;
}

interface BeinHarimResponse {
  error: string | null;
  data: OrderDetails;
}

export async function getOrderDetails(orderNumber: number): Promise<OrderDetails> {
  const res = await fetch(
    `${config.beinHarim.baseUrl}/booking/order_details/${orderNumber}`,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "BH-API-KEY": config.beinHarim.apiKey,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Bein Harim API error: ${res.status} ${res.statusText}`);
  }

  const json: BeinHarimResponse = await res.json();

  if (json.error) {
    throw new Error(`Bein Harim API error: ${json.error}`);
  }

  return json.data;
}

// Post a free-text notification/message to the Bein Harim back office for an
// order. The office sees it tied to the order (returns an office_message_id).
// Used by the no-show assistant to forward whatever the customer requested
// during the call so the operations team is notified.
export async function sendCheckoutNotification(
  orderId: number,
  message: string
): Promise<{ office_message_id?: number }> {
  const res = await fetch(
    `${config.beinHarim.baseUrl}/booking/checkout_notification/${orderId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BH-API-KEY": config.beinHarim.apiKey,
      },
      body: JSON.stringify({ message }),
    }
  );

  if (!res.ok) {
    throw new Error(`Bein Harim API error: ${res.status} ${res.statusText}`);
  }

  const json: { error: string | null; data?: { office_message_id?: number } } =
    await res.json();

  if (json.error) {
    throw new Error(`Bein Harim API error: ${json.error}`);
  }

  return { office_message_id: json.data?.office_message_id };
}

export async function markOrderNoShow(orderId: number): Promise<void> {
  const res = await fetch(
    `${config.beinHarim.baseUrl}/booking/change_order_status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BH-API-KEY": config.beinHarim.apiKey,
      },
      body: JSON.stringify({
        order_id: orderId,
        order_status: "non_show",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Bein Harim API error: ${res.status} ${res.statusText}`);
  }
}
