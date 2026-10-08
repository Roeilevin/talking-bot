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

// `error` is usually a string ("Invalid API Key ", "Order not found"), but
// server-side failures answer with an object instead:
// `{"error_code":100,"error_msg":"An Error Was Encountered"}`. Both shapes reach
// callers as a readable string — interpolating the object gave "[object Object]"
// in the WhatsApp updates, which tells nobody anything.
type BhError = string | { error_code?: number; error_msg?: string } | null;

interface BhEnvelope<T> {
  error: BhError;
  data?: T;
}

function describeBhError(error: BhError): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const { error_code, error_msg } = error;
  return error_msg ? (error_code ? `${error_msg} (${error_code})` : error_msg) : JSON.stringify(error);
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
): Promise<BhEnvelope<T> & { status: number }> {
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

  return { ...json, status: res.status };
}

// One entry per day of the itinerary, as returned by order_details. A day tour
// carries exactly one; a multi-day package one per day. `guide` / `driver` are
// the people actually running that day — the phone is regularly empty (nobody
// assigned yet), which is why every consumer must treat it as optional.
export interface OrderContact {
  name?: string;
  phone?: string;
}

export interface OrderDay {
  day_number?: number;
  date?: string;
  activity_type?: string;
  guide?: OrderContact | null;
  driver?: OrderContact | null;
  car_number?: string;
}

export interface OrderDetails {
  order_number: number;
  // Current back-office status, e.g. 4 / "Approved", 7 / "Processing". Optional
  // because older responses (and our own fixtures) predate them.
  order_status?: number;
  order_status_name?: string;
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
  days?: OrderDay[];
}

export async function getOrderDetails(orderNumber: number): Promise<OrderDetails> {
  const json = await bhRequest<OrderDetails>(
    `/booking/order_details/${orderNumber}`
  );

  // "Order not found" is a normal outcome (wrong/typo'd number, or an order
  // that only exists in the other BH environment) — not a failure to report.
  // Match it narrowly: an auth failure ("Invalid API Key", HTTP 403) is also
  // data-less, and must NOT be mistaken for a bad order number.
  if (json.status === 404 || /order not found/i.test(describeBhError(json.error))) {
    throw new OrderNotFoundError(orderNumber);
  }

  if (json.error) {
    throw new Error(`Bein Harim API error: ${json.status} ${describeBhError(json.error)}`);
  }

  if (!json.data) {
    throw new Error(
      `Bein Harim API error: ${json.status} response carried no order data`
    );
  }

  return json.data;
}

// The guide running the order — by default the one assigned to the tour date,
// which is the day a no-show concerns. Falls back to any day that has a phone
// so a multi-day order still reaches a human, then to the first day at all.
// Returns null when the order carries no days (older orders, transfers).
export function guideForDate(
  order: OrderDetails,
  date: string = order.tour_date
): OrderContact | null {
  const days = order.days ?? [];
  if (days.length === 0) return null;
  const hasPhone = (d: OrderDay) => (d.guide?.phone || "").trim().length > 0;
  return (
    days.find((d) => d.date === date && hasPhone(d))?.guide ??
    days.find(hasPhone)?.guide ??
    days.find((d) => d.date === date)?.guide ??
    days[0].guide ??
    null
  );
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

  if (json.error || json.status >= 400) {
    throw new Error(
      `Bein Harim API error: ${json.status} ${describeBhError(json.error) || "request failed"}`
    );
  }

  return { office_message_id: json.data?.office_message_id };
}

// Add a "Comment for office" note to an order — the "For office" block on the
// BH order screen. Every call outcome is recorded here so the office sees what
// the customer said without opening WhatsApp. Best-effort: never throws, so a
// BH hiccup (or an env without the endpoint yet) can't break the live call.
export async function addOrderComment(orderId: number, text: string): Promise<boolean> {
  try {
    const json = await bhRequest(`/booking/order_comment/${orderId}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (json.error || json.status >= 400) {
      throw new Error(`${json.status} ${describeBhError(json.error) || "request failed"}`);
    }
    return true;
  } catch (e) {
    console.error(`[BH] order_comment failed for order ${orderId}`, e);
    return false;
  }
}

// Set an order's status in the Bein Harim back office. `non_show` is the only
// value we send today; the parameter exists so reverting a no-show (see
// BH_SHOW_STATUS) doesn't need a second near-identical function.
export async function setOrderStatus(
  orderId: number,
  orderStatus: string
): Promise<void> {
  const json = await bhRequest<{
    success?: boolean;
    order_status?: number | null;
    previous_order_status?: number | null;
  }>(`/booking/change_order_status`, {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      order_status: orderStatus,
    }),
  });

  // Prod order_details doesn't expose the status, so this log line is the only
  // record of what BH actually did (e.g. 4 → 9 for non_show).
  console.log(
    `[BH] change_order_status order=${orderId} → ${orderStatus}: ${json.status} ` +
      `success=${json.data?.success} ${json.data?.previous_order_status} → ${json.data?.order_status}`
  );

  if (json.error || json.status >= 400 || json.data?.success === false) {
    throw new Error(
      `Bein Harim API error: ${json.status} ${describeBhError(json.error) || "request failed"}`
    );
  }
}

export async function markOrderNoShow(orderId: number): Promise<void> {
  await setOrderStatus(orderId, "non_show");
}

// Move an order to `status` unless it is already there. BH answers a *generic
// HTTP 500* to a change that would be a no-op (verified against an order already
// in Approved), so without this check a guide tapping twice would look to the
// ops team like the correction had failed. Returns whether anything changed.
export async function ensureOrderStatus(
  orderId: number,
  status: string
): Promise<{ changed: boolean }> {
  const order = await getOrderDetails(orderId);
  const current = (order.order_status_name || "").trim().toLowerCase();
  if (current && current === status.trim().toLowerCase()) {
    return { changed: false };
  }
  await setOrderStatus(orderId, status);
  return { changed: true };
}
