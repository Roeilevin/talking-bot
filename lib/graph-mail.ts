import { config } from "./config";

// Microsoft Graph (app-only / client-credentials) email sender. Mail is sent as
// the configured shared mailbox (info@) and saved to its Sent Items, so the team
// sees every agent-sent email in Outlook. The app registration is locked to that
// one mailbox via an Exchange Application Access Policy.

const GRAPH = "https://graph.microsoft.com/v1.0";
const tokenUrl = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

export interface MailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64-encoded file bytes
}

export function isGraphMailConfigured(): boolean {
  const { tenantId, clientId, clientSecret } = config.microsoft;
  return Boolean(tenantId && clientId && clientSecret);
}

// Client-credentials token, cached in-process and refreshed ~1 min before expiry.
let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = config.microsoft;
  if (!isGraphMailConfigured()) {
    throw new Error(
      "Microsoft Graph not configured (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET)"
    );
  }
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const res = await fetch(tokenUrl(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Graph token error: ${res.status} ${json.error_description || json.error || ""}`
    );
  }
  cached = {
    token: json.access_token as string,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: MailAttachment[];
}): Promise<void> {
  const token = await getToken();
  const mailbox = config.microsoft.senderMailbox;

  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: opts.bodyHtml
      ? { contentType: "HTML", content: opts.bodyHtml }
      : { contentType: "Text", content: opts.bodyText ?? "" },
    toRecipients: [{ emailAddress: { address: opts.to } }],
  };

  if (opts.attachments?.length) {
    message.attachments = opts.attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    }));
  }

  const res = await fetch(
    `${GRAPH}/users/${encodeURIComponent(mailbox)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph sendMail error: ${res.status} ${body.slice(0, 500)}`);
  }
}
