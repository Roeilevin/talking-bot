// Two-level inbound IVR served as TeXML.
//
// Level 1: language menu (press 1 English / 2 Spanish / 3 Hebrew / 4 German).
// Level 2 (in the chosen language):
//   1 = information about tours       -> general AI assistant
//   2 = on a trip / can't find pickup -> transfer to human ops
//   3 = assistance for your booking   -> dedicated booking AI assistant
//                                        (opens by asking for the order number)
//   4 = other inquiries               -> general AI assistant
//
// Telnyx AI Assistants can't capture inbound DTMF, so the menu lives in this
// TeXML layer in front of the assistants. The connect snippet mirrors what
// GET /v2/ai/assistants/{id}/texml returns: <Connect><AIAssistant id=.../></Connect>.
// The verb only takes id/join/participant* — there's no way to tell an assistant
// which digit was pressed, so option 3 uses a separate booking assistant instead
// of passing intent into the shared one.

export const PUBLIC_BASE = (
  process.env.PUBLIC_BASE_URL || "https://talking-bot-lilac.vercel.app"
).replace(/\/+$/, "");

// Base URL for the pre-generated Ultra-voice menu clips in public/ivr/
// (produced by scripts/generate-ivr-audio.mjs).
const CLIP_BASE = `${PUBLIC_BASE}/ivr`;

// Option 1 (on a trip / pickup) transfers here — the human operations line.
export const OPS_TRANSFER_NUMBER =
  process.env.IVR_TRANSFER_NUMBER || "+97235422003";

// Caller ID for the outbound transfer leg. MUST be a Telnyx number we own —
// presenting the inbound caller's number gets the leg rejected (instant
// hangup). Use the owned Israeli Bein Harim line so the Israeli ops number
// accepts it (mirrors what the no-show outbound flow does with From=owned).
export const TRANSFER_CALLER_ID =
  process.env.IVR_TRANSFER_CALLER_ID || "+97233825488";

export type LangCode = "en" | "es" | "he" | "de";

export interface LangEntry {
  code: LangCode;
  // General support assistant (menu options 1 = tours, 4 = other).
  assistantId: string;
  // Dedicated booking assistant (menu option 3) — clone of the general one that
  // opens by asking for the 6-digit order number. Created by
  // scripts/create-booking-assistants.mjs; overridable via env TELNYX_BOOKING_*.
  bookingAssistantId: string;
  // Telnyx platform TTS voice (id from GET /v2/text-to-speech/voices), native
  // to the language so the prompts pronounce correctly. Easy to swap, or move
  // to pre-recorded <Play> clips later.
  voice: string;
  // Level-2 menu prompt, spoken in the selected language.
  menu: string;
  // Spoken when option 2's human transfer isn't answered.
  unavailable: string;
}

// Digit (level 1) -> language. Assistant ids overridable via env.
export const LANGUAGES: Record<string, LangEntry> = {
  "1": {
    code: "en",
    assistantId:
      process.env.TELNYX_ASSISTANT_EN ||
      "assistant-8a3c00ed-392c-4479-a186-560890142518",
    bookingAssistantId:
      process.env.TELNYX_BOOKING_EN ||
      "assistant-a5e8d57e-aa99-4f7d-b1f2-b8485070054e",
    voice: "Telnyx.Bayan.Amanda",
    menu: "Press 1 for information about our tours. Press 2 if you're currently on a trip or can't find your pickup location. Press 3 for assistance with your booking. Press 4 for any other inquiry.",
    unavailable:
      "Sorry, our team is not available right now. Please try again later. Goodbye.",
  },
  "2": {
    code: "es",
    assistantId:
      process.env.TELNYX_ASSISTANT_ES ||
      "assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36",
    bookingAssistantId:
      process.env.TELNYX_BOOKING_ES ||
      "assistant-861cbddc-a827-468d-9917-45fc22a1fc82",
    voice: "Telnyx.NaturalHD.lark",
    menu: "Presione 1 para información sobre nuestros tours. Presione 2 si está de viaje ahora o no encuentra su punto de recogida. Presione 3 para asistencia con su reserva. Presione 4 para cualquier otra consulta.",
    unavailable:
      "Lo sentimos, nuestro equipo no está disponible en este momento. Por favor, inténtelo de nuevo más tarde. Adiós.",
  },
  "3": {
    code: "he",
    assistantId:
      process.env.TELNYX_ASSISTANT_HE ||
      "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005",
    bookingAssistantId:
      process.env.TELNYX_BOOKING_HE ||
      "assistant-4436ae27-6918-4075-874e-53784edd8fac",
    voice: "Telnyx.NaturalHD.aviva",
    menu: "הקישו 1 למידע על הטיולים שלנו. הקישו 2 אם אתם בטיול כעת או שאינכם מוצאים את נקודת האיסוף. הקישו 3 לסיוע בהזמנה שלכם. הקישו 4 לכל פנייה אחרת.",
    unavailable:
      "מצטערים, הצוות שלנו אינו זמין כרגע. אנא נסו שוב מאוחר יותר. להתראות.",
  },
  "4": {
    code: "de",
    assistantId:
      process.env.TELNYX_ASSISTANT_DE ||
      "assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c",
    bookingAssistantId:
      process.env.TELNYX_BOOKING_DE ||
      "assistant-25d91760-4051-4946-950e-697597e4edaa",
    voice: "Telnyx.NaturalHD.alfhild",
    menu: "Drücken Sie die 1 für Informationen zu unseren Touren. Drücken Sie die 2, wenn Sie gerade auf einer Tour sind oder Ihren Abholort nicht finden. Drücken Sie die 3 für Hilfe zu Ihrer Buchung. Drücken Sie die 4 für alle anderen Anliegen.",
    unavailable:
      "Es tut uns leid, unser Team ist im Moment nicht erreichbar. Bitte versuchen Sie es später erneut. Auf Wiederhören.",
  },
};

// Level-1 language menu order: digit -> language code (en, es, he, de),
// played as lang-<code>.mp3.
const LANGUAGE_MENU_ORDER = ["1", "2", "3", "4"];

export function byCode(code: string): LangEntry {
  return (
    Object.values(LANGUAGES).find((l) => l.code === code) || LANGUAGES["1"]
  );
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// The menu prompts are high-quality Ultra-voice MP3s (same voices as the AI
// agents), pre-generated into public/ivr/ and played with <Play> — Telnyx
// <Say> only exposes lower-tier voices. To change wording/voice, edit + re-run
// scripts/generate-ivr-audio.mjs and redeploy.
function play(clip: string): string {
  return `<Play>${CLIP_BASE}/${clip}</Play>`;
}

export function texml(inner: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

// Read a TeXML callback field from the form body first, then the query string.
export async function readParam(
  req: Request,
  name: string
): Promise<string | null> {
  const url = new URL(req.url);
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("form")) {
      const form = await req.formData();
      const v = form.get(name);
      if (typeof v === "string" && v.length) return v;
    }
  } catch {
    // fall through to query params
  }
  return url.searchParams.get(name);
}

// ---- Page builders ----

// Level 1: the language menu.
export function languageMenu(): Response {
  const lines = LANGUAGE_MENU_ORDER.map((d) =>
    play(`lang-${LANGUAGES[d].code}.mp3`)
  ).join(`<Pause length="1"/>`);
  return texml(
    `<Gather input="dtmf" numDigits="1" timeout="10" action="${PUBLIC_BASE}/api/texml/select-language" method="POST">${lines}</Gather>` +
      `<Redirect method="POST">${PUBLIC_BASE}/api/texml/language</Redirect>`
  );
}

// Level 2: the intent menu, in the chosen language.
export function intentMenu(lang: LangEntry): Response {
  return texml(
    `<Gather input="dtmf" numDigits="1" timeout="10" action="${PUBLIC_BASE}/api/texml/select-option?lang=${lang.code}" method="POST">` +
      play(`menu-${lang.code}.mp3`) +
      `</Gather>` +
      `<Redirect method="POST">${PUBLIC_BASE}/api/texml/menu?lang=${lang.code}</Redirect>`
  );
}

// Connect the caller to a specific AI assistant id.
function connectAssistantId(assistantId: string): Response {
  return texml(
    `<Connect><AIAssistant id="${xmlEscape(assistantId)}"></AIAssistant></Connect>`
  );
}

// Connect to the language's general support assistant (menu 1 = tours, 4 = other).
export function connectAssistant(lang: LangEntry): Response {
  return connectAssistantId(lang.assistantId);
}

// Connect to the language's dedicated booking assistant (menu 3) — it opens by
// asking for the caller's order number and what they need.
export function connectBookingAssistant(lang: LangEntry): Response {
  return connectAssistantId(lang.bookingAssistantId);
}

// Option 1: dial the human ops line; on no-answer run the fallback route.
export function transferToOps(lang: LangEntry): Response {
  return texml(
    `<Dial timeout="20" callerId="${xmlEscape(TRANSFER_CALLER_ID)}" action="${PUBLIC_BASE}/api/texml/after-transfer?lang=${lang.code}" method="POST">` +
      `<Number>${xmlEscape(OPS_TRANSFER_NUMBER)}</Number>` +
      `</Dial>`
  );
}

// After the transfer attempt: hang up if it connected, else say unavailable.
export function afterTransfer(lang: LangEntry, dialStatus: string): Response {
  if (dialStatus === "completed" || dialStatus === "answered") {
    return texml(`<Hangup/>`);
  }
  return texml(play(`unavail-${lang.code}.mp3`) + `<Hangup/>`);
}
