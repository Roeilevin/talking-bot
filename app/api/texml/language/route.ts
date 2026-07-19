// Inbound entry point: play the language selection menu (level 1).
// The US number's TeXML app voice URL points here.
import { languageMenu } from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle() {
  return languageMenu();
}

export const GET = handle;
export const POST = handle;
