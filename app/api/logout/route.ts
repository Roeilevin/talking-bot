import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRequestClient, supabaseAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Posted from the nav's "Sign out" form. signOut() revokes the refresh token
// and clears the Supabase cookies on this response.
export async function POST(req: NextRequest) {
  if (supabaseAuthConfigured()) {
    try {
      const supabase = await createSupabaseRequestClient();
      await supabase.auth.signOut();
    } catch (e) {
      // Never leave someone stuck on a page they can't sign out of.
      console.error("[logout] signOut failed", e);
    }
  }
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
