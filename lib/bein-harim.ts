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

// Thrown when Bein Harim answers "no such order" (HTTP 404, or a 200 with
// `error: "Order not found"`). Callers can catch this to reply with something
// useful instead of surfacing a generic failure.
export class OrderNotFoundError extends Error {
  orderNumber: number;

  constructor(orderNumber: number) {
    super(`Bein Harim: order ${orderNumber} not found`);
    this.name = "OrderNotFoundError";
    this.orderNumber = orderNumber;
  }
}

interface BhEnvelope<T> {
  error: string | null;
  data?: T;
}

// Call the Bein Harim API and parse the JSON envelope defensively.
//
// The API does NOT always answer with JSON: a request that misses the
// `/api/v2` prefix (e.g. a misconfigured BH_API_BASE_URL) gets back an HTML
// "Page Not found" page with HTTP **200**, which blows up JSON.parse with an
// opaque SyntaxError. Parse the body ourselves so a wrong URL reports itself.
async function bhRequest<T>(
  path: string,
  init?: RequestInit
): Promise<BhEnvelope<T>> {
  const { baseUrl, apiKey } = await getActiveBeinHarim();
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "BH-API-KEY": apiKey,
      ...init?.headers,
    },
  });

  const text = await res.text();
  let json: BhEnvelope<T>;
  try {
    json = JSON.parse(text) as BhEnvelope<T>;
  } catch {
    // Non-JSON body — almost always a wrong base URL (HTML error page).
    throw new Error(
      `Bein Harim API returned non-JSON (${res.status}) from ${url}: ` +
        `${text.slice(0, 100).replace(/\s+/g, " ").trim()}`
    );
  }

  return json;
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

export async function getOrderDetails(orderNumber: number): Promise<OrderDetails> {
  const json = await bhRequest<OrderDetails>(
    `/booking/order_details/${orderNumber}`
  );

  // "Order not found" is a normal outcome (wrong/typo'd number, or an order
  // that only exists in the other BH environment) — not a failure to report.
  if (/not found/i.test(json.error || "") || !json.data) {
    throw new OrderNotFoundError(orderNumber);
  }

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
  const json = await bhRequest<{ office_message_id?: number }>(
    `/booking/checkout_notification/${orderId}`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    }
  );

  if (json.error) {
    throw new Error(`Bein Harim API error: ${json.error}`);
  }

  return { office_message_id: json.data?.office_message_id };
}

export async function markOrderNoShow(orderId: number): Promise<void> {
  const json = await bhRequest(`/booking/change_order_status`, {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      order_status: "non_show",
    }),
  });

  if (json.error) {
    throw new Error(`Bein Harim API error: ${json.error}`);
  }
}
