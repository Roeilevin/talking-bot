import crypto from "node:crypto";
import { config } from "./config";

export const DASH_COOKIE = "dash_auth";

// Deterministic token derived from the shared password. The cookie stores this
// token (not the password), and proxy/pages verify it without any session store.
export function expectedDashToken(): string {
  return crypto
    .createHmac("sha256", config.dashboardPassword || "unset")
    .update("talking-bot-dashboard-v1")
    .digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// True when the provided cookie value authenticates. Requires a configured
// password (otherwise the dashboard stays locked).
export function isValidDashCookie(value: string | undefined): boolean {
  if (!config.dashboardPassword || !value) return false;
  return timingSafeEqualStr(value, expectedDashToken());
}

// Auth guard for API route handlers (the proxy only gates pages, never /api/*).
// Reads the dashboard cookie and verifies it, same as the pages do.
export async function isAuthedRequest(): Promise<boolean> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return isValidDashCookie(store.get(DASH_COOKIE)?.value);
}
