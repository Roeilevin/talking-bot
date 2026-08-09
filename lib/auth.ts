import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { config } from "./config";

// Dashboard sign-in is Supabase Auth (email + password). The session lives in
// the cookies @supabase/ssr writes — there is no app-owned session cookie and
// no shared password. Accounts are created in the Supabase dashboard
// (Authentication → Users); the app deliberately exposes no signup route.

// Stamped into app_metadata by the Users screen when an account is provisioned.
// app_metadata is writable only with the service-role key, so users can't grant
// it to themselves. See isUserAllowed below.
export const DASHBOARD_ACCESS_FLAG = "dashboard_access";

export function supabaseAuthConfigured(): boolean {
  return !!(config.supabase.url && config.supabase.publishableKey);
}

// Build a request-scoped Supabase client. NEVER cache or share one across
// requests — each carries its own user's tokens.
export function createSupabaseServerClient(
  cookies: CookieMethodsServer
): SupabaseClient {
  return createServerClient(config.supabase.url, config.supabase.publishableKey, {
    cookies,
  });
}

// Client backed by the next/headers cookie store, for pages and route handlers.
// Imported dynamically so this module stays usable from proxy.ts.
export async function createSupabaseRequestClient(): Promise<SupabaseClient> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return createSupabaseServerClient({
    getAll: () => store.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      } catch {
        // Server Components get a read-only cookie store. Harmless to ignore:
        // proxy.ts refreshes the session on every page request.
      }
    },
  });
}

// Who may reach the dashboard.
//
// Normally: only accounts provisioned from the Users screen, which stamps
// `dashboard_access` into app_metadata. app_metadata is writable only with the
// service-role key, so someone who self-registers against Supabase's public
// signup endpoint gets a valid session but no dashboard.
//
// DASHBOARD_ALLOWED_EMAILS, when set, is a stricter override: the email must be
// on that list, full stop. It's an escape hatch, not the normal path — it also
// locks out anyone added later from the Users screen.
export function isUserAllowed(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}): boolean {
  const email = user.email?.trim().toLowerCase();
  const allowlist = config.dashboardAllowedEmails;
  if (allowlist.length > 0) return !!email && allowlist.includes(email);
  return user.app_metadata?.[DASHBOARD_ACCESS_FLAG] === true;
}

// The verified signed-in user, or null. getUser() re-validates the token with
// the Supabase auth server, so a hand-edited cookie can't fake a session.
export async function getCurrentUser(): Promise<User | null> {
  if (!supabaseAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseRequestClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return isUserAllowed(data.user) ? data.user : null;
  } catch (e) {
    console.error("[auth] getCurrentUser failed", e);
    return null;
  }
}

// Page guard: returns the user, or redirects to /login and never returns.
export async function requireUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (user) return user;
  const { redirect } = await import("next/navigation");
  // redirect() returns `never` — the `return` is only to satisfy the signature.
  return redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

// Auth guard for API route handlers (the proxy only gates pages, never /api/*).
export async function isAuthedRequest(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

// Only same-origin relative paths, and never /login itself (that would loop).
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  const next = String(raw ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next === "/login" || next.startsWith("/login?")) return fallback;
  return next;
}
