// Re-prompt the level-2 intent menu for a language (used by the no-input
// redirect). Language code is carried in the ?lang= query string.
import type { NextRequest } from "next/server";
import { byCode, intentMenu } from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("lang") || "en";
  return intentMenu(byCode(code));
}

export const GET = handle;
export const POST = handle;
