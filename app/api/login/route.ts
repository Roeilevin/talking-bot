import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import {
  DASH_COOKIE,
  expectedDashToken,
  timingSafeEqualStr,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const next = String(form.get("next") || "/dashboard");
  // Only allow same-origin relative redirects.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const ok =
    !!config.dashboardPassword &&
    timingSafeEqualStr(password, config.dashboardPassword);

  if (!ok) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (target !== "/dashboard") url.searchParams.set("next", target);
    return NextResponse.redirect(url, { status: 303 });
  }

  (await cookies()).set(DASH_COOKIE, expectedDashToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return NextResponse.redirect(new URL(target, req.url), { status: 303 });
}
