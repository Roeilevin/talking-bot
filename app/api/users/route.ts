import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createDashboardUser,
  deleteDashboardUser,
  listDashboardUsers,
  setDashboardUserAccess,
  setDashboardUserPassword,
  validatePassword,
} from "@/lib/admin-users";

export const dynamic = "force-dynamic";

function fail(err: unknown, fallback: string, status = 500) {
  console.error(`[api/users] ${fallback}`, err);
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ users: await listDashboardUsers() });
  } catch (e) {
    return fail(e, "Could not list users");
  }
}

// Create an account. Body: { email, password }
export async function POST(req: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  const pwError = validatePassword(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  try {
    return NextResponse.json({ user: await createDashboardUser(email, password) });
  } catch (e) {
    return fail(e, "Could not create the user", 400);
  }
}

// Change a password, or grant/revoke dashboard access.
// Body: { id, password? , hasAccess? }
export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });

  try {
    if (typeof body.password === "string" && body.password !== "") {
      const pwError = validatePassword(body.password);
      if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
      await setDashboardUserPassword(id, body.password);
    }

    if (typeof body.hasAccess === "boolean") {
      // Don't let an admin revoke their own access and lock themselves out.
      if (id === me.id && !body.hasAccess) {
        return NextResponse.json(
          { error: "You can't revoke your own access." },
          { status: 400 }
        );
      }
      await setDashboardUserAccess(id, body.hasAccess);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, "Could not update the user", 400);
  }
}

// Delete an account. Body: { id }
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (id === me.id) {
    return NextResponse.json(
      { error: "You can't delete the account you're signed in with." },
      { status: 400 }
    );
  }

  try {
    await deleteDashboardUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, "Could not delete the user", 400);
  }
}
