// Runs after the option-1 human transfer attempt. If it connected, hang up;
// otherwise tell the caller (in their language) that the team is unavailable.
import type { NextRequest } from "next/server";
import { byCode, readParam, afterTransfer } from "@/lib/ivr";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("lang") || "en";
  const status = (await readParam(req, "DialCallStatus")) || "";
  return afterTransfer(byCode(code), status);
}

export const GET = handle;
export const POST = handle;
