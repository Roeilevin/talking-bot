import { NextRequest, NextResponse } from "next/server";
import { isAuthedRequest } from "@/lib/auth";
import {
  upsertAllowedNumbers,
  deleteAllowedNumber,
  type NewAllowedNumber,
} from "@/lib/db";

export const dynamic = "force-dynamic";

// Add one or many allowed numbers. Body: { numbers: [{ phone_number, label }] }
// (also accepts a single { phone_number, label } for the manual add form).
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

  const b = body as { numbers?: NewAllowedNumber[]; phone_number?: string; label?: string };
  const items: NewAllowedNumber[] = Array.isArray(b?.numbers)
    ? b.numbers
    : b?.phone_number
    ? [{ phone_number: b.phone_number, label: b.label ?? null }]
    : [];

  if (items.length === 0) {
    return NextResponse.json({ error: "no_numbers" }, { status: 400 });
  }

  try {
    const result = await upsertAllowedNumbers(items);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[allowed-numbers] save failed", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}

// Remove an allowed number by id: DELETE /api/allowed-numbers?id=<uuid>
export async function DELETE(req: NextRequest) {
  if (!(await isAuthedRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    await deleteAllowedNumber(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[allowed-numbers] delete failed", e);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
