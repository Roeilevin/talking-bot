// Level-2 action: caller pressed an intent digit (language in ?lang=).
//   1 -> information about tours       -> general AI assistant
//   2 -> on a trip / can't find pickup -> transfer to human ops
//   3 -> assistance for your booking   -> dedicated booking AI assistant
//   4 -> other inquiries               -> general AI assistant
//   anything else -> replay the intent menu
import type { NextRequest } from "next/server";
import {
  byCode,
  readParam,
  connectAssistant,
  connectBookingAssistant,
  transferToOps,
  intentMenu,
} from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("lang") || "en";
  const lang = byCode(code);
  const digit = (await readParam(req, "Digits")) || "";
  if (digit === "1") return connectAssistant(lang);
  if (digit === "2") return transferToOps(lang);
  if (digit === "3") return connectBookingAssistant(lang);
  if (digit === "4") return connectAssistant(lang);
  return intentMenu(lang);
}

export const GET = handle;
export const POST = handle;
