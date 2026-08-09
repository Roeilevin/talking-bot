import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  isUserAllowed,
  supabaseAuthConfigured,
} from "@/lib/auth";

// Gates the dashboard pages behind Supabase Auth *and* refreshes the session
// cookies on every request. The refresh matters: access tokens expire after an
// hour and Server Components can't write cookies, so without this users get
// silently signed out mid-session.
// IMPORTANT: matcher must NOT cover /api/* or the Converto/Telnyx webhooks break.
export async function proxy(request: NextRequest) {
  if (!supabaseAuthConfigured()) return redirectToLogin(request);

  // Reassigned by setAll below when Supabase rotates the tokens.
  let response = NextResponse.next({ request });

  const supabase = createSupabaseServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
      // no-store etc. — a CDN must never cache a response carrying a session cookie.
      for (const [key, value] of Object.entries(headers ?? {})) {
        response.headers.set(key, value);
      }
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !isUserAllowed(data.user)) {
    return redirectToLogin(request);
  }

  return response;
}

function redirectToLogin(request: NextRequest) {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/allowed-numbers/:path*", "/users/:path*"],
};
