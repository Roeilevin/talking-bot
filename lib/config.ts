export const config = {
  beinHarim: {
    baseUrl: process.env.BH_API_BASE_URL || "https://dev-v3.beinharimtours.com/api/v2",
    apiKey: process.env.BH_API_KEY || "",
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
