import { config, type BhEnv } from "./config";
import { getSetting } from "./db";

const BH_ENV_SETTING = "bh_env";

// Short in-memory cache so we don't hit Supabase on every BH call. Because each
// serverless instance caches independently, a toggle change in the dashboard
// takes effect everywhere within at most BH_ENV_TTL_MS.
const BH_ENV_TTL_MS = 10_000;
let bhEnvCache: { env: BhEnv; at: number } | null = null;

// Name of the currently-active Bein Harim environment, chosen by the dashboard
// toggle (persisted as the `bh_env` setting). Defaults to production when unset
// or when Supabase is unavailable — never silently point writes at the wrong env.
export async function getActiveBhEnv(): Promise<BhEnv> {
  if (bhEnvCache && Date.now() - bhEnvCache.at < BH_ENV_TTL_MS) {
    return bhEnvCache.env;
  }
  const raw = await getSetting(BH_ENV_SETTING);
  const env: BhEnv = raw === "test" ? "test" : "production";
  bhEnvCache = { env, at: Date.now() };
  return env;
}

// Drop the cache so a just-changed toggle takes effect immediately in this
// instance (called by the dashboard toggle API after a successful write).
export function clearBhEnvCache(): void {
  bhEnvCache = null;
}

// Resolve the base URL + API key for the currently-active Bein Harim environment.
export async function getActiveBeinHarim(): Promise<{
  env: BhEnv;
  baseUrl: string;
  apiKey: string;
}> {
  const env = await getActiveBhEnv();
  return { env, ...config.beinHarim.environments[env] };
}

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
  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const res = await fetch(
    `${baseUrl}/booking/order_details/${orderNumber}`,
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "BH-API-KEY": apiKey,
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
  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const res = await fetch(
    `${baseUrl}/booking/checkout_notification/${orderId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BH-API-KEY": apiKey,
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
  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const res = await fetch(
    `${baseUrl}/booking/change_order_status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BH-API-KEY": apiKey,
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
