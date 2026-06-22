import { config } from "./config";
import type { OrderDetails } from "./bein-harim";

// Warm/friendly female Telnyx Ultra voices, one per language. Selected per call
// via the assistant's templated voice field (Telnyx.Ultra.{{voice_id}}).
const VOICE_BY_LANG: Record<string, string> = {
  he: "1daba551-67af-465e-a189-f91495aa2347", // Yael - Casual Presence
  en: "00a77add-48d5-4ef6-8157-71e5437b282d", // Callie - Encourager
  es: "727f663b-0e90-4031-90f2-558b7334425b", // Carmen - Friendly Neighbor
  fr: "6c64b57a-bc65-48e4-bff4-12dbe85606cd", // Eloise - Dialogue Anchor
  ru: "064b17af-d36b-4bfb-b003-be07dba1b649", // Tatiana - Friendly Storyteller
  de: "38aabb6a-f52b-4fb0-a3d1-988518f4dc06", // Alina - Engaging Assistant
  it: "d718e944-b313-4998-b011-d1cc078d4ef3", // Liv - Casual Friend
};
const DEFAULT_VOICE_ID = VOICE_BY_LANG.en;

function voiceIdForLanguage(languageCode: string): string {
  const key = (languageCode || "").slice(0, 2).toLowerCase();
  return VOICE_BY_LANG[key] || DEFAULT_VOICE_ID;
}

export async function startAssistantCall(
  order: OrderDetails,
  teamPhone: string,
  attempt = 1
): Promise<{ call_control_id: string }> {
  const to = formatPhoneNumber(order.customer_phone);

  // Carry order context + the requesting team member in the StatusCallback
  // query string so the Telnyx webhook can report unanswered calls back to them.
  // `attempt` lets the webhook cap automatic retries (see MAX_CALL_ATTEMPTS).
  const customerName = `${order.customer_first_name} ${order.customer_last_name}`;
  const statusCallback =
    `${config.publicBaseUrl}/api/webhooks/telnyx` +
    `?order_number=${encodeURIComponent(order.order_number)}` +
    `&customer_name=${encodeURIComponent(customerName)}` +
    `&team_phone=${encodeURIComponent(teamPhone)}` +
    `&attempt=${attempt}`;

  const res = await fetch(
    `https://api.telnyx.com/v2/texml/ai_calls/${config.telnyx.callControlAppId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.telnyx.apiKey}`,
      },
      body: JSON.stringify({
        To: to,
        From: config.telnyx.phoneNumber,
        AIAssistantId: config.telnyx.assistantId,
        StatusCallback: statusCallback,
        StatusCallbackMethod: "POST",
        StatusCallbackEvent: "completed",
        AIAssistantDynamicVariables: {
          order_number: String(order.order_number),
          customer_name: `${order.customer_first_name} ${order.customer_last_name}`,
          customer_phone: to,
          tour_date: order.tour_date,
          pickup_hotel: order.pickup_hotel,
          pickup_city: order.pickup_city,
          pickup_time: order.pickup_time,
          language_name: order.guide_language_name,
          language_code: order.guide_language_code,
          voice_id: voiceIdForLanguage(order.guide_language_code),
          team_phone: teamPhone,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telnyx start assistant call error: ${res.status} ${body}`);
  }

  const json = await res.json();
  return {
    call_control_id:
      json.call_sid || json.data?.call_control_id || json.call_control_id,
  };
}

// ---- Telnyx AI Conversations API (read-only, for the dashboard) ----
// Telnyx stores each AI conversation server-side. We pull transcripts lazily by
// call_control_id (outbound) or conversation id (inbound). Every helper is
// error-safe and returns null/[] so it can never affect the live call flow.

const TELNYX_API = "https://api.telnyx.com/v2";

export interface TranscriptMessage {
  role: string;
  content: string;
  timestamp: string | null;
}

export interface InboundConversation {
  id: string;
  caller: string | null;
  assistantId: string | null;
  createdAt: string | null;
  lastMessageAt: string | null;
}

async function telnyxGet(path: string): Promise<unknown | null> {
  if (!config.telnyx.apiKey) return null;
  try {
    const res = await fetch(`${TELNYX_API}${path}`, {
      headers: {
        Authorization: `Bearer ${config.telnyx.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[telnyx] GET ${path} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[telnyx] GET ${path} failed`, e);
    return null;
  }
}

// Telnyx response lists live under `data`; tolerate a couple of shapes.
function asList(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const candidate = obj.data ?? obj.conversations ?? obj.messages;
  return Array.isArray(candidate) ? (candidate as Record<string, unknown>[]) : [];
}

function metaOf(row: Record<string, unknown>): Record<string, unknown> {
  const m = row.metadata;
  return m && typeof m === "object" ? (m as Record<string, unknown>) : {};
}

export async function getConversationByCallControlId(
  callControlId: string
): Promise<string | null> {
  if (!callControlId) return null;
  const json = await telnyxGet(
    `/ai/conversations?metadata->call_control_id=eq.${encodeURIComponent(
      callControlId
    )}`
  );
  const row = asList(json)[0];
  return row && typeof row.id === "string" ? row.id : null;
}

function normalizeMessage(
  m: Record<string, unknown>
): TranscriptMessage | null {
  if (!m || typeof m !== "object") return null;
  const role = String(m.role ?? m.sender ?? "unknown").toLowerCase();
  let content = "";
  if (typeof m.content === "string") content = m.content;
  else if (Array.isArray(m.content))
    content = (m.content as unknown[])
      .map((c) =>
        typeof c === "string"
          ? c
          : String((c as Record<string, unknown>)?.text ?? "")
      )
      .join(" ");
  else content = String(m.text ?? "");
  content = content.trim();
  if (!content) return null;
  const ts = m.sent_at ?? m.created_at ?? m.timestamp ?? null;
  return { role, content, timestamp: typeof ts === "string" ? ts : null };
}

export async function getTranscript(
  conversationId: string
): Promise<TranscriptMessage[]> {
  if (!conversationId) return [];
  const json = await telnyxGet(
    `/ai/conversations/${encodeURIComponent(conversationId)}/messages`
  );
  return asList(json)
    .map(normalizeMessage)
    .filter((m): m is TranscriptMessage => m !== null)
    .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
}

export async function getTranscriptByCallControlId(
  callControlId: string
): Promise<TranscriptMessage[]> {
  const id = await getConversationByCallControlId(callControlId);
  return id ? getTranscript(id) : [];
}

// Recent inbound support conversations. Filtered to the inbound assistant when
// TELNYX_INBOUND_ASSISTANT_ID is configured; otherwise lists recent conversations.
export async function listInboundConversations(
  limit = 50
): Promise<InboundConversation[]> {
  const params = new URLSearchParams();
  params.set("order", "created_at.desc");
  params.set("limit", String(Math.max(1, Math.min(limit, 200))));
  let query = `/ai/conversations?${params.toString()}`;
  if (config.telnyx.inboundAssistantId) {
    query += `&metadata->assistant_id=eq.${encodeURIComponent(
      config.telnyx.inboundAssistantId
    )}`;
  }
  const json = await telnyxGet(query);
  return asList(json)
    .filter((row) => typeof row.id === "string")
    .map((row) => {
      const meta = metaOf(row);
      const caller =
        meta.telnyx_end_user_target ?? meta.caller ?? meta.from ?? null;
      const assistantId = meta.assistant_id ?? null;
      return {
        id: String(row.id),
        caller: typeof caller === "string" ? caller : null,
        assistantId: typeof assistantId === "string" ? assistantId : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        lastMessageAt:
          typeof row.last_message_at === "string" ? row.last_message_at : null,
      };
    });
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") || digits.startsWith("1") || digits.startsWith("242")) {
    return `+${digits}`;
  }
  if (digits.startsWith("0")) {
    return `+972${digits.slice(1)}`;
  }
  return `+${digits}`;
}
