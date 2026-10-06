// One-off: create the `guide_noshow_alert` WhatsApp template via the Converto
// public MCP endpoint (JSON-RPC). Auth: CVTO env var = cvto_live_ channel key.
// Run:  $env:CVTO="cvto_live_..."; node scripts/create-guide-noshow-template.mjs
// (PowerShell)   or   CVTO=cvto_live_... node scripts/create-guide-noshow-template.mjs
//
// Sent to the GUIDE running the tour when an order is marked no-show, so a
// traveller who did board can be reported back with one tap. Three positional
// params: {{1}} = guide name, {{2}} = order number, {{3}} = traveller name.
//
// A template is REQUIRED here, not a nicety: the alert is business-initiated
// and the guide has no open 24h WhatsApp session, so free text would be
// rejected by Meta (error 131047). lib/guide-alert.ts sends this template first
// and only falls back to free text if it is refused.
//
// The quick-reply button is what lib/guide-alert.ts matches on the way back
// (GUIDE_JOINED_BUTTON) — keep the two strings identical.
import {
  loadEnv,
  requireKey,
  findTemplate,
  createTemplate,
  buttonsOf,
} from "./lib/converto-mcp.mjs";

loadEnv();
const KEY = requireKey();

export const BUTTON_TEXT = "התייר הצטרף";
export const TEMPLATE_NAME = "guide_noshow_alert";
export const TEMPLATE_LANGUAGE = "he";

const BODY = {
  type: "BODY",
  text: "שלום {{1}},\nהזמנה מספר {{2}} של הנוסע/ת {{3}} סומנה כאי-הגעה (no-show).\nאם הנוסע/ת בכל זאת הצטרף/ה לטיול, יש ללחוץ על הכפתור \"התייר הצטרף\" ונעדכן את המשרד.",
  example: { body_text: [["פרנק היינו", "394118", "Janna Senger"]] },
};

const withButton = {
  name: TEMPLATE_NAME,
  language: TEMPLATE_LANGUAGE,
  category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [
    BODY,
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: BUTTON_TEXT }] },
  ],
};

// Same message without the button. Only used with --no-button: the guide then
// has to TYPE the reply (which lib/guide-alert.ts still matches), so it is a
// deliberate downgrade, never a silent one.
const withoutButton = { ...withButton, components: [BODY] };

const allowButtonless = process.argv.includes("--no-button");

const existing = await findTemplate(KEY, TEMPLATE_NAME);
if (existing) {
  const buttons = buttonsOf(existing);
  console.log(
    `Template ${TEMPLATE_NAME} already exists: status=${existing.status || "?"} ` +
      `language=${existing.language || "?"} buttons=${buttons ? JSON.stringify(buttons) : "NONE"}`
  );
  if (!buttons) {
    console.log(
      "!! It has no quick-reply button, and an approved template's buttons cannot be added later.\n" +
        "   Delete it in the Converto/Meta console and re-run, or the guide will have to type the reply."
    );
    process.exit(1);
  }
  process.exit(0);
}

let r = await createTemplate(KEY, withButton);
if (r.ok) {
  console.log(`OK ${TEMPLATE_NAME} (with quick-reply button "${BUTTON_TEXT}"): ${r.why}`);
  console.log("Meta reviews new templates — wait for status APPROVED before relying on it.");
  process.exit(0);
}

console.log(`X ${TEMPLATE_NAME} with button: ${r.why}`);
if (!allowButtonless) {
  console.log(
    "Not falling back to a buttonless template — that would take the name and lose the tap.\n" +
      "Fix the rejection above, or re-run with --no-button to accept a typed reply instead."
  );
  process.exit(1);
}

r = await createTemplate(KEY, withoutButton);
console.log(
  r.ok
    ? `OK ${TEMPLATE_NAME} (NO button — the guide must reply "${BUTTON_TEXT}" as text): ${r.why}`
    : `X ${TEMPLATE_NAME}: ${r.why}`
);
process.exit(r.ok ? 0 : 1);
