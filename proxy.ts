import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DASH_COOKIE, isValidDashCookie } from "@/lib/auth";

// Gate the /dashboard history page behind the shared password. Optimistic check
// only (proxy.md security note) — the page and transcript route re-verify too.
// IMPORTANT: matcher must NOT cover /api/* or the Converto/Telnyx webhooks break.
export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(DASH_COOKIE)?.value;
  if (isValidDashCookie(cookie)) {
    return NextResponse.next();
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/allowed-numbers/:path*"],
};
