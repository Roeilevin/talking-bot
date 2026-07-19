// Level-1 action: caller pressed a language digit. Route to that language's
// intent menu, or replay the language menu on an invalid/empty press.
import type { NextRequest } from "next/server";
import { LANGUAGES, readParam, intentMenu, languageMenu } from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const digit = (await readParam(req, "Digits")) || "";
  const lang = LANGUAGES[digit];
  return lang ? intentMenu(lang) : languageMenu();
}

export const GET = handle;
export const POST = handle;
