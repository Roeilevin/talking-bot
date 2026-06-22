import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

// Service-role client (server-only). Bypasses RLS, so the history tables stay
// RLS-enabled-with-no-policy and are never readable via the anon/public key.
// Lazily created so the bot still boots when Supabase isn't configured.
let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return null;
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const CALLS = "talking_bot_calls";
const SENDS = "talking_bot_whatsapp_sends";
const ALLOWED = "talking_bot_allowed_numbers";

export type CallStatus =
  | "placed"
  | "no-answer"
  | "busy"
  | "failed"
  | "voicemail"
  | "completed";

export type CallOutcome = "coming" | "no-show" | "transferred";

export interface CallRow {
  id: string;
  call_control_id: string | null;
  order_number: number;
  originating_phone: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: CallStatus | string;
  outcome: CallOutcome | string | null;
  outcome_note: string | null;
  tour_date: string | null;
  created_at: string;
  status_updated_at: string | null;
  outcome_updated_at: string | null;
}

export interface WhatsAppSendRow {
  id: string;
  recipient: string;
  direction: string | null;
  kind: string | null;
  text: string | null;
  channel: string | null;
  order_number: number | null;
  created_at: string;
}

export interface NewCall {
  call_control_id?: string | null;
  order_number: number;
  originating_phone?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status?: CallStatus;
  tour_date?: string | null;
}

export interface NewWhatsAppSend {
  recipient: string;
  direction?: string | null;
  kind?: string | null;
  text?: string | null;
  channel?: string | null;
  order_number?: number | null;
}

export interface AllowedNumberRow {
  id: string;
  phone_number: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface NewAllowedNumber {
  phone_number: string;
  label?: string | null;
}

// Canonical digits-only form (E.164 without "+"). Israeli local numbers written
// with a leading 0 (e.g. 050-442-5422) are converted to their international form
// (972504425422) so they match a WhatsApp sender id regardless of how the row
// was typed in. Returns "" when there are no usable digits.
export function normalizePhone(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2); // 00<country> international prefix
  if (d.startsWith("0")) d = "972" + d.slice(1); // Israeli local → +972
  return d;
}

// ---- Writes: best-effort. They log and swallow so persistence can NEVER
// break the live call/WhatsApp flow. ----

export async function insertCall(input: NewCall): Promise<void> {
  const sb = db();
  if (!sb) return;
  try {
    const { error } = await sb
      .from(CALLS)
      .insert({ status: "placed", ...input });
    if (error) throw error;
  } catch (e) {
    console.error("[db] insertCall failed", e);
  }
}

// Correlate by order number: the Telnyx StatusCallback URL carries order_number,
// not call_control_id (the id isn't known until after the call POST returns).
// Updates the most-recent call for that order.
export async function updateCallStatusByOrder(
  orderNumber: number,
  status: CallStatus
): Promise<void> {
  const sb = db();
  if (!sb || !Number.isFinite(orderNumber)) return;
  try {
    const { data, error: selErr } = await sb
      .from(CALLS)
      .select("id")
      .eq("order_number", orderNumber)
      .order("created_at", { ascending: false })
      .limit(1);
    if (selErr) throw selErr;
    const id = data?.[0]?.id;
    if (!id) return;
    const { error } = await sb
      .from(CALLS)
      .update({ status, status_updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    console.error("[db] updateCallStatusByOrder failed", e);
  }
}

export async function updateCallOutcome(
  orderNumber: number,
  outcome: CallOutcome | string,
  note?: string
): Promise<void> {
  const sb = db();
  if (!sb || !Number.isFinite(orderNumber)) return;
  try {
    const { data, error: selErr } = await sb
      .from(CALLS)
      .select("id")
      .eq("order_number", orderNumber)
      .order("created_at", { ascending: false })
      .limit(1);
    if (selErr) throw selErr;
    const id = data?.[0]?.id;
    if (!id) return;
    const { error } = await sb
      .from(CALLS)
      .update({
        outcome,
        outcome_note: note ?? null,
        outcome_updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    console.error("[db] updateCallOutcome failed", e);
  }
}

// Outcome of the most-recent call for an order, used by the Telnyx webhook to
// decide whether a connected-but-unproductive call should be retried.
//   string    → an outcome was recorded (coming / no-show / transferred)
//   null      → a call row exists but the assistant logged no outcome
//   undefined → can't tell (Supabase unconfigured / query error / no row) →
//               callers should NOT retry on this, to avoid loops on an outage.
export async function getLatestCallOutcome(
  orderNumber: number
): Promise<string | null | undefined> {
  const sb = db();
  if (!sb || !Number.isFinite(orderNumber)) return undefined;
  try {
    const { data, error } = await sb
      .from(CALLS)
      .select("outcome")
      .eq("order_number", orderNumber)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return undefined;
    return (data[0].outcome as string | null) ?? null;
  } catch (e) {
    console.error("[db] getLatestCallOutcome failed", e);
    return undefined;
  }
}

export async function insertWhatsAppSend(input: NewWhatsAppSend): Promise<void> {
  const sb = db();
  if (!sb) return;
  try {
    const { error } = await sb.from(SENDS).insert(input);
    if (error) throw error;
  } catch (e) {
    console.error("[db] insertWhatsAppSend failed", e);
  }
}

// ---- Reads (dashboard). Return [] on any failure. ----

export async function listCalls(limit = 100): Promise<CallRow[]> {
  const sb = db();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from(CALLS)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as CallRow[]) ?? [];
  } catch (e) {
    console.error("[db] listCalls failed", e);
    return [];
  }
}

export async function listWhatsAppSends(limit = 100): Promise<WhatsAppSendRow[]> {
  const sb = db();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from(SENDS)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as WhatsAppSendRow[]) ?? [];
  } catch (e) {
    console.error("[db] listWhatsAppSends failed", e);
    return [];
  }
}

// ---- Allowed numbers (sender allowlist) ----

// Is this WhatsApp sender permitted to use the bot?
//   true  → on the active allowlist
//   false → reachable allowlist, sender not on it (block + tell them)
//   null  → enforcement unavailable (Supabase unconfigured or a query error);
//           the caller should fail OPEN so the bot never breaks on an outage.
export async function isPhoneAllowed(phone: string): Promise<boolean | null> {
  const sb = db();
  if (!sb) return null;
  const target = normalizePhone(phone);
  if (!target) return false;
  try {
    const { data, error } = await sb
      .from(ALLOWED)
      .select("phone_number")
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).some(
      (r: { phone_number: string }) => normalizePhone(r.phone_number) === target
    );
  } catch (e) {
    console.error("[db] isPhoneAllowed failed", e);
    return null; // fail open
  }
}

export async function listAllowedNumbers(): Promise<AllowedNumberRow[]> {
  const sb = db();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from(ALLOWED)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as AllowedNumberRow[]) ?? [];
  } catch (e) {
    console.error("[db] listAllowedNumbers failed", e);
    return [];
  }
}

// Add (or update the label of) one or more numbers. Phones are normalized and
// de-duplicated; blanks are dropped. Upserts on the unique phone_number so a
// re-add just refreshes the label and re-activates the row. Throws on failure
// (admin path — the API route surfaces the error to the user).
export async function upsertAllowedNumbers(
  items: NewAllowedNumber[]
): Promise<{ saved: number; skipped: number }> {
  const sb = db();
  if (!sb) throw new Error("Supabase is not configured");

  const byPhone = new Map<string, { phone_number: string; label: string | null; is_active: boolean }>();
  let skipped = 0;
  for (const item of items) {
    const phone_number = normalizePhone(item.phone_number);
    if (!phone_number) {
      skipped++;
      continue;
    }
    const label = item.label?.toString().trim() || null;
    byPhone.set(phone_number, { phone_number, label, is_active: true });
  }

  const rows = [...byPhone.values()];
  if (rows.length === 0) return { saved: 0, skipped };

  const { error } = await sb
    .from(ALLOWED)
    .upsert(rows, { onConflict: "phone_number" });
  if (error) throw error;
  return { saved: rows.length, skipped };
}

export async function deleteAllowedNumber(id: string): Promise<void> {
  const sb = db();
  if (!sb) throw new Error("Supabase is not configured");
  const { error } = await sb.from(ALLOWED).delete().eq("id", id);
  if (error) throw error;
}
