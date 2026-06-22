import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DASH_COOKIE, isValidDashCookie } from "@/lib/auth";
import { getTranscriptByCallControlId, getTranscript } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

// Lazy transcript fetch for an expanded dashboard row. Self-guards: route
// handlers aren't covered by the page's auth redirect, so re-check the cookie.
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  if (!isValidDashCookie(cookieStore.get(DASH_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const callControlId = req.nextUrl.searchParams.get("callControlId");
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  try {
    const messages = callControlId
      ? await getTranscriptByCallControlId(callControlId)
      : conversationId
      ? await getTranscript(conversationId)
      : [];
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[dashboard/transcript] error", err);
    return NextResponse.json({ messages: [] });
  }
}
