// Create/UPDATE the dedicated "Booking Agent" per language (EN/ES/HE/DE),
// reached from the inbound IVR when the caller presses 3 ("assistance for your
// booking").
//
// Each booking agent is a CLONE of that language's general support assistant
// (same model, voice, transcription, tools) with a booking-help flow layered on:
//   1. Ask for the order number — telling the caller it STARTS WITH 4 so it's
//      easy to find on their confirmation/voucher.
//   2. Ask what they want to do.
//   3. Call notify_office (BH back-office "bell" notification tied to the order)
//      with a short Hebrew summary of the request.
//   4. Tell the traveler the team received their request and will update them.
// The notify_office webhook tool is added on top of the cloned tools.
//
// UPSERT: each language has a known `existing` assistant id — the script UPDATES
// it in place (POST /v2/ai/assistants/{id}) so the ids wired into lib/ivr.ts stay
// valid. Clear `existing` (or set CREATE_NEW=1) to create fresh ones instead.
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/create-booking-assistants.mjs
import fs from "node:fs";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const KEY = process.env.TELNYX_API_KEY;
if (!KEY) { console.error("Set TELNYX_API_KEY in env or .env.local"); process.exit(1); }
const CREATE_NEW = process.env.CREATE_NEW === "1";

const API = "https://api.telnyx.com/v2/ai/assistants";
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "https://talking-bot-lilac.vercel.app").replace(/\/+$/, "");

// The "bell" notification for the operations team: posts the caller's request to
// the BH back office tied to their order (via /api/tools/notify-office ->
// /booking/checkout_notification/{order_id}). Same tool the no-show agent uses,
// but the order number comes from the caller (not a dynamic variable).
const notifyOfficeTool = {
  type: "webhook",
  timeout_ms: 8000,
  webhook: {
    name: "notify_office",
    description:
      "Send a notification to the Bein Harim operations team, tied to the caller's order. Call this once the caller has given their order number and explained what they want to do, to log their request for the ops team.",
    url: `${PUBLIC_BASE}/api/tools/notify-office`,
    method: "POST",
    body_parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "The caller's order number exactly as they gave it (it starts with the digit 4).",
        },
        message: {
          type: "string",
          description: "A short, clear summary of what the caller wants to do / their request, written in Hebrew, for the operations team.",
        },
      },
      required: ["order_id", "message"],
    },
  },
};

// Source general assistant + existing booking id + booking-help greeting/directive.
const LANGS = {
  en: {
    source: "assistant-8a3c00ed-392c-4479-a186-560890142518",
    existing: "assistant-a5e8d57e-aa99-4f7d-b1f2-b8485070054e",
    name: "Bein Harim - Booking Agent (EN)",
    greeting:
      "Hi, this is the Bein Harim Tours automated assistant — I'm an AI and may occasionally make mistakes. I can help with your order. To start, what's your order number? It begins with a 4, so it's easy to spot on your confirmation.",
    directive:
      "## How this booking-help call works\nThe caller pressed the menu option for help with their order. Follow this flow, one step at a time:\n1. Ask for their order number, and tell them it starts with the digit 4 so it's easy to find on their confirmation or voucher. Help them locate it if needed. If you still don't have a usable order number after 2 attempts (they can't find it, don't have it, or keep giving one that clearly isn't valid), stop asking — tell them you'll connect them to a team member and use the transfer tool to transfer the call to the team.\n2. Once you have the order number, ask what they would like to do — what they need help with on their order.\n3. After they explain, call notify_office with order_id = the number they gave and message = a short, clear summary of their request written IN HEBREW for the operations team.\n4. Then tell the traveler, warmly and briefly, that the team has received their request and will get back to them with an update. Do not promise any specific outcome or timing.\n5. Ask if there's anything else; if not, thank them and end the call.\nThis line's job is to take the request and pass it to the operations team via notify_office — not to resolve it live. Use the other tools only if the caller specifically asks for something they cover (e.g. a pickup-location link). Never ask for the order number twice once it's given.\n\n",
  },
  es: {
    source: "assistant-a8eb4c15-1840-4204-b2ff-4eb5c86f8c36",
    existing: "assistant-861cbddc-a827-468d-9917-45fc22a1fc82",
    name: "Bein Harim - Booking Agent (ES)",
    greeting:
      "Hola, se ha comunicado con Bein Harim Tours. Soy un asistente de inteligencia artificial y a veces puedo cometer errores. Puedo ayudarle con su reserva. Para empezar, ¿cuál es su número de reserva? Comienza con un 4, así que es fácil de encontrar en su confirmación.",
    directive:
      "## Cómo funciona esta llamada de ayuda con la reserva\nLa persona que llama eligió la opción de ayuda con su reserva. Siga este flujo, paso a paso:\n1. Pida su número de reserva y dígale que comienza con el dígito 4, así es fácil de encontrar en su confirmación o voucher. Ayúdele a localizarlo si es necesario. Si después de 2 intentos aún no tiene un número de reserva utilizable (no lo encuentra, no lo tiene o sigue dando uno que claramente no es válido), deje de preguntar — dígale que lo conectará con un miembro del equipo y use la herramienta transfer para transferir la llamada al equipo.\n2. Cuando tenga el número, pregunte qué le gustaría hacer — en qué necesita ayuda con su reserva.\n3. Después de que lo explique, llame a notify_office con order_id = el número que dio y message = un resumen breve y claro de su solicitud escrito EN HEBREO para el equipo de operaciones.\n4. Luego dígale al viajero, de forma cálida y breve, que el equipo ha recibido su solicitud y se pondrá en contacto con una actualización. No prometa ningún resultado ni plazo específico.\n5. Pregunte si necesita algo más; si no, agradézcale y finalice la llamada.\nLa función de esta línea es tomar la solicitud y pasarla al equipo de operaciones mediante notify_office — no resolverla en vivo. Use las demás herramientas solo si la persona pide específicamente algo que cubran (por ejemplo, un enlace del punto de recogida). Nunca pida el número de reserva dos veces una vez dado.\n\n",
  },
  he: {
    source: "assistant-eb38b76f-b649-4f50-ace9-0e792ab9c005",
    existing: "assistant-4436ae27-6918-4075-874e-53784edd8fac",
    name: "Bein Harim - Booking Agent (HE)",
    greeting:
      "שלום, הגעתם לבין הרים טיולים. אני עוזר ממוחשב ולעיתים אני עלול לטעות. אני יכול לעזור עם ההזמנה שלכם. נתחיל — מה מספר ההזמנה שלכם? הוא מתחיל בספרה 4, כך שקל למצוא אותו באישור ההזמנה.",
    directive:
      "## איך מתנהלת שיחת הסיוע בהזמנה\nהמתקשר בחר באפשרות סיוע בהזמנה שלו. פעלו לפי השלבים, אחד בכל פעם:\n1. בקשו את מספר ההזמנה, ואמרו שהוא מתחיל בספרה 4 כך שקל למצוא אותו באישור או בשובר. עזרו לאתר אותו במידת הצורך. אם אחרי 2 ניסיונות עדיין אין בידיכם מספר הזמנה תקין (הם לא מוצאים אותו, אין להם אותו, או שהם ממשיכים למסור מספר שברור שאינו תקין), הפסיקו לשאול — אמרו להם שתעבירו אותם לנציג מהצוות והשתמשו בכלי transfer כדי להעביר את השיחה לצוות.\n2. לאחר קבלת המספר, שאלו מה הם רוצים לעשות — במה הם צריכים עזרה בנוגע להזמנה.\n3. לאחר שהסבירו, קראו ל-notify_office עם order_id = המספר שמסרו ו-message = סיכום קצר וברור של הבקשה שלהם, כתוב בעברית, עבור צוות התפעול.\n4. לאחר מכן אמרו למטייל, בחמימות ובקצרה, שהצוות קיבל את הבקשה ויחזור אליו עם עדכון. אל תבטיחו תוצאה או זמן מסוים.\n5. שאלו אם יש עוד משהו; אם לא, הודו לו וסיימו את השיחה.\nתפקיד הקו הזה הוא לקבל את הבקשה ולהעביר אותה לצוות התפעול באמצעות notify_office — לא לפתור אותה בשיחה. השתמשו בכלים האחרים רק אם המתקשר מבקש במפורש משהו שהם מכסים (למשל קישור לנקודת האיסוף). לעולם אל תבקשו את מספר ההזמנה פעמיים לאחר שנמסר.\n\n",
  },
  de: {
    source: "assistant-a1de7cf2-26c6-4117-820b-a1c0082aac7c",
    existing: "assistant-25d91760-4051-4946-950e-697597e4edaa",
    name: "Bein Harim - Booking Agent (DE)",
    greeting:
      "Hallo, Sie haben Bein Harim Tours erreicht. Ich bin ein KI-Assistent und mache gelegentlich Fehler. Ich kann Ihnen bei Ihrer Buchung helfen. Zunächst: Wie lautet Ihre Buchungsnummer? Sie beginnt mit einer 4, also ist sie auf Ihrer Bestätigung leicht zu finden.",
    directive:
      "## Ablauf dieses Anrufs zur Buchungshilfe\nDer Anrufer hat die Menüoption für Hilfe zu seiner Buchung gewählt. Folgen Sie diesem Ablauf, Schritt für Schritt:\n1. Fragen Sie nach der Buchungsnummer und sagen Sie, dass sie mit der Ziffer 4 beginnt, damit sie auf der Bestätigung oder dem Voucher leicht zu finden ist. Helfen Sie bei Bedarf, sie zu finden. Wenn Sie nach 2 Versuchen immer noch keine brauchbare Buchungsnummer haben (der Anrufer findet sie nicht, hat sie nicht oder nennt wiederholt eine offensichtlich ungültige), hören Sie auf zu fragen — sagen Sie, dass Sie ihn mit einem Teammitglied verbinden, und verwenden Sie das transfer-Tool, um den Anruf an das Team weiterzuleiten.\n2. Sobald Sie die Nummer haben, fragen Sie, was der Anrufer tun möchte — wobei er Hilfe zu seiner Buchung braucht.\n3. Nachdem er es erklärt hat, rufen Sie notify_office auf mit order_id = der genannten Nummer und message = einer kurzen, klaren Zusammenfassung seines Anliegens, auf HEBRÄISCH geschrieben, für das Operations-Team.\n4. Sagen Sie dem Reisenden dann herzlich und kurz, dass das Team seine Anfrage erhalten hat und sich mit einem Update melden wird. Versprechen Sie kein bestimmtes Ergebnis und keinen Zeitrahmen.\n5. Fragen Sie, ob es sonst noch etwas gibt; wenn nicht, bedanken Sie sich und beenden Sie den Anruf.\nDie Aufgabe dieser Leitung ist es, das Anliegen aufzunehmen und über notify_office an das Operations-Team weiterzugeben — nicht es live zu lösen. Verwenden Sie die anderen Tools nur, wenn der Anrufer ausdrücklich nach etwas fragt, das sie abdecken (z. B. ein Link zum Abholort). Fragen Sie niemals zweimal nach der Buchungsnummer, wenn sie bereits genannt wurde.\n\n",
  },
};

// Strip read-only per-tool fields and drop handoff/hangup (shared hangup is
// auto-applied; declaring another 400s), then add notify_office.
function buildTools(sourceTools) {
  const cloned = (sourceTools || [])
    .filter((t) => t.type !== "handoff" && t.type !== "hangup")
    .map(({ tool_id, shared, ...rest }) => rest);
  const hasNotifyOffice = cloned.some((t) => t.webhook && t.webhook.name === "notify_office");
  return hasNotifyOffice ? cloned : [...cloned, notifyOfficeTool];
}

async function getAssistant(id) {
  const res = await fetch(`${API}/${id}`, { headers: H });
  const txt = await res.text();
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status} ${txt.slice(0, 400)}`);
  return JSON.parse(txt);
}

async function upsert(lang, cfg) {
  const src = await getAssistant(cfg.source);
  const body = {
    name: cfg.name,
    description: `${lang.toUpperCase()} booking-assistance agent (IVR option 3). Cloned from ${cfg.source}. Asks for the order number (starts with 4), then notifies the ops team via notify_office.`,
    model: src.model,
    greeting: cfg.greeting,
    instructions: cfg.directive + (src.instructions || ""),
    transcription: src.transcription,
    voice_settings: src.voice_settings,
    tools: buildTools(src.tools),
  };

  const update = cfg.existing && !CREATE_NEW;
  const url = update ? `${API}/${cfg.existing}` : API;
  const res = await fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) { console.error(`X ${lang} ${update ? "update" : "create"} failed: ${res.status} ${txt.slice(0, 1200)}`); process.exit(1); }
  let id = cfg.existing || "";
  try { id = JSON.parse(txt).id || id; } catch {}
  console.log(`OK ${lang} booking agent ${update ? "updated" : "created"} (${res.status})`);
  console.log(`TELNYX_BOOKING_${lang.toUpperCase()}=${id}`);
}

for (const [lang, cfg] of Object.entries(LANGS)) {
  await upsert(lang, cfg);
}
console.log("Done.");
