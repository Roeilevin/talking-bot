// Live check of the Bein Harim "checkout_notification" endpoint — the call the
// no-show assistant makes via the `notify_office` tool
// (app/api/tools/notify-office -> lib/bein-harim.ts sendCheckoutNotification).
//
// The agent has been "saying it sent" the office notification while the request
// apparently never lands. This script reproduces the EXACT request that
// sendCheckoutNotification() builds and fires it at the TEST environment so we
// can see, end to end, whether the call we make is well-formed and succeeds.
//
// Run:  node scripts/test-notification.mjs [orderId] [message]
//   defaults: orderId=426946, a Hebrew test message
// Targets the TEST env by default (BH_API_BASE_URL_TEST / BH_API_KEY_TEST).
// Set BH_TARGET=production to hit the production credentials instead.

import fs from "node:fs";

function loadEnvLocal() {
  for (const f of [".env.local", ".env.development.local", ".env"]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* file may not exist */
    }
  }
}
loadEnvLocal();

const TARGET = (process.env.BH_TARGET || "test").toLowerCase();

const ENVS = {
  test: {
    base:
      process.env.BH_API_BASE_URL_TEST ||
      "https://dev-v3.beinharimtours.com/api/v2",
    key: process.env.BH_API_KEY_TEST,
  },
  production: {
    base:
      process.env.BH_API_BASE_URL || "https://dev-v3.beinharimtours.com/api/v2",
    key: process.env.BH_API_KEY,
  },
};

const { base: BASE, key: KEY } = ENVS[TARGET] || ENVS.test;

if (!KEY) {
  console.error(
    `Missing API key for the "${TARGET}" environment. Expected ` +
      `${TARGET === "production" ? "BH_API_KEY" : "BH_API_KEY_TEST"} in .env.local.`
  );
  process.exit(1);
}

const orderId = Number(process.argv[2] || 426946);
const message =
  process.argv[3] ||
  "בדיקת מערכת – הודעה אוטומטית מהבוט (notify_office). אנא התעלמו.";

// --- Reproduce sendCheckoutNotification() exactly ---------------------------
const url = `${BASE}/booking/checkout_notification/${orderId}`;
const headers = {
  "Content-Type": "application/json",
  "BH-API-KEY": KEY,
};
const body = JSON.stringify({ message });

console.log("=== notify_office / checkout_notification probe ===");
console.log(`env:        ${TARGET}`);
console.log(`order_id:   ${orderId}`);
console.log(`POST ${url}`);
console.log(`headers:    ${JSON.stringify({ ...headers, "BH-API-KEY": `***${KEY.slice(-4)}` })}`);
console.log(`body:       ${body}`);
console.log("");

const started = Date.now();
try {
  const res = await fetch(url, { method: "POST", headers, body });
  const elapsed = Date.now() - started;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }

  console.log(`HTTP ${res.status} ${res.statusText}  (${elapsed}ms)`);
  console.log(`raw body:   ${text.slice(0, 1500)}`);
  console.log("");

  // Mirror the success/failure logic of sendCheckoutNotification().
  if (!res.ok) {
    console.log(`RESULT: ❌ FAIL — non-2xx status (${res.status}). The bot would throw here.`);
    process.exit(2);
  }
  if (json && json.error) {
    console.log(`RESULT: ❌ FAIL — API returned error: ${json.error}. The bot would throw here.`);
    process.exit(2);
  }

  const officeMessageId = json?.data?.office_message_id;
  console.log(
    `RESULT: ✅ SUCCESS — office_message_id=${officeMessageId ?? "(not returned)"}`
  );
  if (officeMessageId == null) {
    console.log(
      "NOTE: success status but no office_message_id in data — confirm the office actually received it."
    );
  }
} catch (e) {
  console.log(`RESULT: ❌ FETCH ERROR — ${e.message}`);
  process.exit(2);
}
