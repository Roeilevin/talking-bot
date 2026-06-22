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
