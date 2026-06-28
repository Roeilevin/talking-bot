// Bein Harim has two backends — production and a test/dev environment. The
// active one is chosen at runtime by the dashboard toggle (persisted in
// Supabase as the `bh_env` setting); see lib/bein-harim.ts getActiveBeinHarim().
const BH_PROD_BASE =
  process.env.BH_API_BASE_URL || "https://dev-v3.beinharimtours.com/api/v2";
const BH_PROD_KEY = process.env.BH_API_KEY || "";
const BH_TEST_BASE =
  process.env.BH_API_BASE_URL_TEST || "https://dev-v3.beinharimtours.com/api/v2";
const BH_TEST_KEY = process.env.BH_API_KEY_TEST || "";

export type BhEnv = "production" | "test";

export const config = {
  beinHarim: {
    // Default/primary credentials. Kept as baseUrl/apiKey for any code path that
    // doesn't resolve the runtime toggle. On Vercel production these are the real
    // production credentials.
    baseUrl: BH_PROD_BASE,
    apiKey: BH_PROD_KEY,
    // The two switchable environments. getActiveBeinHarim() picks one of these.
    environments: {
      production: { baseUrl: BH_PROD_BASE, apiKey: BH_PROD_KEY },
      test: { baseUrl: BH_TEST_BASE, apiKey: BH_TEST_KEY },
    } as Record<BhEnv, { baseUrl: string; apiKey: string }>,
  },
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY || "",
    phoneNumber: process.env.TELNYX_PHONE_NUMBER || "",
    callControlAppId: process.env.TELNYX_CALL_CONTROL_APP_ID || "",
    assistantId: process.env.TELNYX_ASSISTANT_ID || "",
    // Inbound support assistant — used to filter the dashboard's inbound-call list.
    inboundAssistantId: process.env.TELNYX_INBOUND_ASSISTANT_ID || "",
  },
  converto: {
    apiKey: process.env.CONVERTO_API_KEY || "",
    phoneNumber: process.env.CONVERTO_PHONE_NUMBER || "+972526588834",
    webhookSecret: process.env.CONVERTO_WEBHOOK_SECRET || "",
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  },
  // Microsoft Graph (app-only) for sending email from the info@ shared mailbox.
  // Used as the fallback delivery channel for callers who don't use WhatsApp.
  microsoft: {
    tenantId: process.env.MS_TENANT_ID || "",
    clientId: process.env.MS_CLIENT_ID || "",
    clientSecret: process.env.MS_CLIENT_SECRET || "",
    senderMailbox: process.env.MS_SENDER_MAILBOX || "info@beinharimtours.com",
  },
  // Shared password gating the /dashboard history page.
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  // WhatsApp number of the guide / operations team that receives call status updates
  opsWhatsAppNumber:
    process.env.OPS_WHATSAPP_NUMBER ||
    process.env.CONVERTO_PHONE_NUMBER ||
    "972526588834",
  transferPhoneNumber: process.env.TRANSFER_PHONE_NUMBER || "97235422003",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
} as const;

export function validateConfig() {
  const missing: string[] = [];
  if (!config.beinHarim.apiKey) missing.push("BH_API_KEY");
  if (!config.telnyx.apiKey) missing.push("TELNYX_API_KEY");
  if (!config.telnyx.phoneNumber) missing.push("TELNYX_PHONE_NUMBER");
  if (!config.converto.apiKey) missing.push("CONVERTO_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  // Dashboard / persistence are optional: warn but never block the bot from booting.
  const softMissing: string[] = [];
  if (!config.supabase.url) softMissing.push("SUPABASE_URL");
  if (!config.supabase.serviceRoleKey) softMissing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.dashboardPassword) softMissing.push("DASHBOARD_PASSWORD");
  if (softMissing.length > 0) {
    console.warn(
      `[config] Dashboard/history disabled — missing: ${softMissing.join(", ")}`
    );
  }

  // Test BH environment is optional: warn if the toggle could be flipped to a
  // 'test' env that has no credentials configured.
  if (!config.beinHarim.environments.test.apiKey) {
    console.warn(
      "[config] BH 'test' environment toggle has no BH_API_KEY_TEST set — switching to test will fail until it is configured."
    );
  }

  // Email fallback is optional: warn but never block the bot from booting.
  const emailMissing: string[] = [];
  if (!config.microsoft.tenantId) emailMissing.push("MS_TENANT_ID");
  if (!config.microsoft.clientId) emailMissing.push("MS_CLIENT_ID");
  if (!config.microsoft.clientSecret) emailMissing.push("MS_CLIENT_SECRET");
  if (emailMissing.length > 0) {
    console.warn(
      `[config] Email fallback (send_email) disabled — missing: ${emailMissing.join(", ")}`
    );
  }
}
