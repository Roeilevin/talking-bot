// Two-level inbound IVR served as TeXML.
//
// Level 1: language menu (press 1 English / 2 Spanish / 3 Hebrew / 4 German).
// Level 2 (in the chosen language): press 1 = transfer to human ops (on a trip /
//   pickup), press 2 = tour info via AI agent, press 3 = any other question via
//   AI agent. Options 2 & 3 both <Connect> the language's AI assistant.
//
// Telnyx AI Assistants can't capture inbound DTMF, so the menu lives in this
// TeXML layer in front of the assistants. The connect snippet mirrors what
// GET /v2/ai/assistants/{id}/texml returns: <Connect><AIAssistant id=.../></Connect>.

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
  assistantId: string;
  // Telnyx platform TTS voice (id from GET /v2/text-to-speech/voices), native
  // to the language so the prompts pronounce correctly. Easy to swap, or move
  // to pre-recorded <Play> clips later.
  voice: string;
  // Level-2 menu prompt, spoken in the selected language.
  menu: string;
  // Spoken when option 1's human transfer isn't answered.
  unavailable: string;
}

// Digit (level 1) -> language. Assistant ids overridable via env.
export const LANGUAGES: Record<string, LangEntry> = {
  "1": {
    code: "en",
    assistantId:
      process.env.TELNYX_ASSISTANT_EN ||
      "assistant-8a3c00ed-392c-4479-a186-560890142518",
    voice: "Telnyx.Bayan.Amanda",
    menu: "Press 1 if you're currently on a trip or looking for your pickup location. Press 2 for information about our tours. Press 3 for any other question.",
    unavailable:
      "Sorry, our team is not available right now. Please try again later. Goodbye.",
  },
  "2": {
    code: "es",
    assistantId:
      process.env.TELNYX_ASSISTANT_ES ||
      "assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36",
    voice: "Telnyx.NaturalHD.lark",
    menu: "Presione 1 si está de viaje ahora o busca su punto de recogida. Presione 2 para información sobre nuestros tours. Presione 3 para cualquier otra pregunta.",
    unavailable:
      "Lo sentimos, nuestro equipo no está disponible en este momento. Por favor, inténtelo de nuevo más tarde. Adiós.",
  },
  "3": {
    code: "he",
    assistantId:
      process.env.TELNYX_ASSISTANT_HE ||
      "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005",
    voice: "Telnyx.NaturalHD.aviva",
    menu: "הקישו 1 אם אתם בטיול כעת או מחפשים את נקודת האיסוף. הקישו 2 למידע על הטיולים שלנו. הקישו 3 לכל שאלה אחרת.",
    unavailable:
      "מצטערים, הצוות שלנו אינו זמין כרגע. אנא נסו שוב מאוחר יותר. להתראות.",
  },
  "4": {
    code: "de",
    assistantId:
      process.env.TELNYX_ASSISTANT_DE ||
      "assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c",
    voice: "Telnyx.NaturalHD.alfhild",
    menu: "Drücken Sie die 1, wenn Sie gerade auf einer Tour sind oder Ihren Abholort suchen. Drücken Sie die 2 für Informationen zu unseren Touren. Drücken Sie die 3 für alle anderen Fragen.",
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

// Connect the caller to the language's AI assistant.
export function connectAssistant(lang: LangEntry): Response {
  return texml(
    `<Connect><AIAssistant id="${xmlEscape(lang.assistantId)}"></AIAssistant></Connect>`
  );
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
