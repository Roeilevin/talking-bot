// Level-2 action: caller pressed an intent digit (language in ?lang=).
//   1 -> transfer to human ops (on a trip / pickup)
//   2 or 3 -> connect the language's AI assistant
//   anything else -> replay the intent menu
import type { NextRequest } from "next/server";
import {
  byCode,
  readParam,
  connectAssistant,
  transferToOps,
  intentMenu,
} from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("lang") || "en";
  const lang = byCode(code);
  const digit = (await readParam(req, "Digits")) || "";
  if (digit === "1") return transferToOps(lang);
  if (digit === "2" || digit === "3") return connectAssistant(lang);
  return intentMenu(lang);
}

export const GET = handle;
export const POST = handle;
