import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseRequestClient,
  isUserAllowed,
  safeNextPath,
  supabaseAuthConfigured,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// Email + password sign-in against Supabase Auth. Runs server-side so the
// publishable key never has to reach the browser; the session cookies are
// written onto this response by @supabase/ssr.
export async function POST(req: NextRequest) {
  if (!supabaseAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Sign-in is not configured — SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are missing.",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const next = safeNextPath(body.next);

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseRequestClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // Deliberately vague: don't reveal which accounts exist.
    return NextResponse.json(
      { error: "Incorrect email or password." },
      { status: 401 }
    );
  }

  if (!isUserAllowed(data.user)) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { error: "This account may not access the dashboard." },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true, next });
}
