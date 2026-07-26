import { NextRequest, NextResponse } from "next/server";
import { isAuthedRequest } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/db";
import { clearBhEnvCache } from "@/lib/bein-harim";
import { config, type BhEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

const VALID: BhEnv[] = ["production", "test"];

// Current Bein Harim data environment (defaults to production when unset).
export async function GET() {
  if (!(await isAuthedRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await getSetting("bh_env");
  const env: BhEnv = raw === "test" ? "test" : "production";
  // Also report which BH endpoint each slot resolves to. Vercel env vars are
  // write-only once set, so this is the only way to see whether a slot points
  // somewhere wrong. Keys are never returned — only whether one is present.
  const endpoints = Object.fromEntries(
    (Object.keys(config.beinHarim.environments) as BhEnv[]).map((name) => [
      name,
      {
        baseUrl: config.beinHarim.environments[name].baseUrl,
        keySet: !!config.beinHarim.environments[name].apiKey,
      },
    ])
  );
  return NextResponse.json({ env, endpoints });
}

// Switch the Bein Harim data environment. Body: { env: "production" | "test" }
export async function POST(req: NextRequest) {
  if (!(await isAuthedRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const env = (body as { env?: string })?.env;
  if (!env || !VALID.includes(env as BhEnv)) {
    return NextResponse.json(
      { error: "env must be 'production' or 'test'" },
      { status: 400 }
    );
  }

  try {
    await setSetting("bh_env", env);
    clearBhEnvCache();
    return NextResponse.json({ ok: true, env });
  } catch (e) {
    console.error("[bh-env] save failed", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
