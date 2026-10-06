// Send ONE real guide no-show alert to a phone number, through exactly the
// channel and payload lib/guide-alert.ts uses in production.
//
// Run:  $env:CVTO="cvto_live_..."; node scripts/send-guide-noshow-test.mjs 0504425422
//       node scripts/send-guide-noshow-test.mjs 0504425422 --order 394118
//
// It ensures the `guide_noshow_alert` template exists (creating it, with the
// quick-reply button, if it doesn't), fills it from a real Bein Harim order
// when BH credentials are around, and reports exactly what the API answered.
//
// The 24h rule is why this sends a TEMPLATE: a guide has no open WhatsApp
// session with us, so free text would be rejected (Meta 131047). If the
// template send is refused this script falls back to free text and says so —
// the same order lib/guide-alert.ts follows.
import {
  loadEnv,
  requireKey,
  findTemplate,
  createTemplate,
  buttonsOf,
  sendTemplate,
  sendText,
  sendButtons,
  normalizePhone,
} from "./lib/converto-mcp.mjs";

loadEnv();
const KEY = requireKey();

const TEMPLATE_NAME = "guide_noshow_alert";
const TEMPLATE_LANGUAGE = "he";
const BUTTON_TEXT = "התייר הצטרף";

const args = process.argv.slice(2);
const rawPhone = args.find((a) => !a.startsWith("--"));
if (!rawPhone) {
  console.error("Usage: node scripts/send-guide-noshow-test.mjs <phone> [--order 394118] [--yes]");
  process.exit(1);
}
const to = normalizePhone(rawPhone);
const orderArg = args.includes("--order") ? args[args.indexOf("--order") + 1] : "394118";

// Real order data makes the test message look like the real thing. Falls back
// to the sample values if BH credentials aren't in the environment.
async function fetchOrder(orderNumber) {
  // Same normalisation as lib/config.ts: the env value may omit /api/v2, and
  // without it BH answers an HTML "Page Not found" page with HTTP 200.
  const raw = (process.env.BH_API_BASE_URL_TEST || process.env.BH_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const base = /\/api\/v\d+$/.test(raw) ? raw : `${raw}/api/v2`;
  const key = process.env.BH_API_KEY_TEST || process.env.BH_API_KEY;
  if (!raw || !key) return null;
  try {
    const res = await fetch(`${base}/booking/order_details/${orderNumber}`, {
      headers: { "BH-API-KEY": key, Accept: "application/json" },
    });
    const json = await res.json();
    return json?.data || null;
  } catch (e) {
    console.log(`(order lookup failed: ${e.message} — using sample values)`);
    return null;
  }
}

// Same selection as guideForDate() in lib/bein-harim.ts.
function guideOf(order) {
  const days = order?.days || [];
  const hasPhone = (d) => (d?.guide?.phone || "").trim().length > 0;
  return (
    days.find((d) => d.date === order.tour_date && hasPhone(d))?.guide ||
    days.find(hasPhone)?.guide ||
    days[0]?.guide ||
    null
  );
}

const order = await fetchOrder(orderArg);
const guideName = (guideOf(order)?.name || "").trim() || "מדריך/ה";
const traveller =
  `${order?.customer_first_name || ""} ${order?.customer_last_name || ""}`.trim() || "Janna Senger";
const orderNumber = String(order?.order_number || orderArg);

console.log(
  `Sending to ${to} — order ${orderNumber}, guide "${guideName}", traveller "${traveller}"` +
    (order ? "" : " (sample values, BH lookup unavailable)")
);

// 1. The template must exist and carry the button, or the guide can't answer
//    with one tap.
let template = await findTemplate(KEY, TEMPLATE_NAME);
if (!template) {
  console.log(`Template ${TEMPLATE_NAME} not found — creating it with the quick-reply button...`);
  const created = await createTemplate(KEY, {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "POSITIONAL",
    components: [
      {
        type: "BODY",
        text: "שלום {{1}},\nהזמנה מספר {{2}} של הנוסע/ת {{3}} סומנה כאי-הגעה (no-show).\nאם הנוסע/ת בכל זאת הצטרף/ה לטיול, יש ללחוץ על הכפתור \"התייר הצטרף\" ונעדכן את המשרד.",
        example: { body_text: [["פרנק היינו", "394118", "Janna Senger"]] },
      },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: BUTTON_TEXT }] },
    ],
  });
  console.log(created.ok ? `created: ${created.why}` : `create failed: ${created.why}`);
  if (created.ok) {
    console.log("Meta reviews new templates — a send now may fail until it is APPROVED.");
    template = await findTemplate(KEY, TEMPLATE_NAME);
  }
} else {
  const buttons = buttonsOf(template);
  console.log(
    `Template ${TEMPLATE_NAME}: status=${template.status || "?"} buttons=${buttons ? JSON.stringify(buttons) : "NONE"}`
  );
  if (!buttons) {
    console.log("!! No quick-reply button on the approved template — the guide will have to type the reply.");
  }
}

// 2. Send it exactly as lib/converto.ts does: positional params, no button
//    component. If the channel demands button parameters for a quick-reply
//    template, the error below is what tells us to add them there too.
const params = [guideName, orderNumber, traveller];
let res = await sendTemplate(KEY, {
  to,
  template_name: TEMPLATE_NAME,
  language: TEMPLATE_LANGUAGE,
  params,
});
console.log(`template send → HTTP ${res.status} ${res.body.slice(0, 500)}`);

if (!res.ok && /button|component|parameter/i.test(res.body)) {
  console.log("Retrying with an explicit quick-reply button payload...");
  res = await sendTemplate(KEY, {
    to,
    template_name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    params,
    extra: {
      buttons: [{ type: "quick_reply", index: 0, payload: `guide_joined:${orderNumber}` }],
    },
  });
  console.log(`template send (with buttons) → HTTP ${res.status} ${res.body.slice(0, 500)}`);
  if (res.ok) {
    console.log("!! This shape worked — add the same field to sendWhatsAppTemplate in lib/converto.ts.");
  }
}

// 3. Free-text fallback, mirroring lib/guide-alert.ts. Only reached if the
//    template was refused, and it only arrives if a 24h session happens to be
//    open with this number.
if (!res.ok) {
  const text =
    `❌ הזמנה ${orderNumber} – ${traveller} סומנה כאי-הגעה (no-show).\n` +
    (order ? `סיור ${order.tour_date}, איסוף ${order.pickup_hotel} ${order.pickup_city} בשעה ${order.pickup_time}.\n\n` : "\n") +
    `אם הנוסע/ת בכל זאת הצטרף/ה לטיול, יש להשיב "${BUTTON_TEXT}" ונעדכן את המשרד.`;
  // Same ladder as lib/guide-alert.ts: keep the tap if a session is open.
  const b = await sendButtons(KEY, {
    to,
    text: text.replace(/יש להשיב.*$/s, "יש ללחוץ על הכפתור למטה ונעדכן את המשרד."),
    buttons: [{ id: `guide_joined:${orderNumber}`, title: BUTTON_TEXT }],
  });
  console.log(`interactive buttons → HTTP ${b.status} ${b.body.slice(0, 300)}`);
  if (b.ok) {
    console.log("Delivered as an interactive message WITH the button (a 24h session is open with this number).");
    process.exit(0);
  }

  const t = await sendText(KEY, { to, text });
  console.log(`free-text fallback → HTTP ${t.status} ${t.body.slice(0, 500)}`);
  console.log(
    t.ok
      ? "Delivered as free text (a 24h session is open with this number) — a real guide would NOT get this."
      : "Free text refused too — expected outside the 24h window; the template is the only way in."
  );
}
