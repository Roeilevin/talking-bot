import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASH_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  (await cookies()).delete(DASH_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
