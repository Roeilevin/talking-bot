import { NextRequest, NextResponse } from "next/server";
import { isAuthedRequest } from "@/lib/auth";
import { getTranscriptByCallControlId, getTranscript } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

// Lazy transcript fetch for an expanded dashboard row. Self-guards: route
// handlers aren't covered by the page's auth redirect, so re-check the session.
export async function GET(req: NextRequest) {
  if (!(await isAuthedRequest())) {
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
