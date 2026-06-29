// Branded HTML email rendering for caller-facing emails sent by the inbound
// assistant (pickup details, tour info + booking link, availability lists, call
// summaries). The agent composes plain text in the caller's language; we wrap it
// in a responsive, table-based template (header / body / footer) with inline
// styles for broad email-client support, and auto-linkify any URLs and email
// addresses so booking links are clickable instead of raw text.

const BRAND = {
  name: "Bein Harim Tours",
  // Deep blue header with a warm gold accent — Israel-tourism feel.
  primary: "#0e3a5f",
  accent: "#c8a24b",
  link: "#1a6fb5",
  text: "#2b2b2b",
  muted: "#6b7280",
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#e5e7eb",
  website: "https://www.beinharimtours.com",
  email: "info@beinharimtours.com",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Turn raw text into safe HTML: escape everything, then make URLs and email
// addresses clickable. Trailing sentence punctuation is kept outside the link.
const TOKEN_RE =
  /(https?:\/\/[^\s<]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function linkifyInline(text: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1]) {
      let url = m[1];
      let trail = "";
      const tm = url.match(/[.,;:!?)\]]+$/);
      if (tm) {
        trail = url.slice(url.length - tm[0].length);
        url = url.slice(0, url.length - tm[0].length);
      }
      const safe = escapeHtml(url);
      out +=
        `<a href="${safe}" target="_blank" rel="noopener noreferrer" ` +
        `style="color:${BRAND.link};text-decoration:underline;word-break:break-word">${safe}</a>` +
        escapeHtml(trail);
    } else if (m[2]) {
      const safe = escapeHtml(m[2]);
      out += `<a href="mailto:${safe}" style="color:${BRAND.link};text-decoration:underline">${safe}</a>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// Plain text → paragraphs: blank lines split paragraphs, single newlines become
// soft <br> breaks within a paragraph.
function renderBody(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs
    .map((p) => {
      const html = linkifyInline(p).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px;color:${BRAND.text};font-size:15px;line-height:1.65">${html}</p>`;
    })
    .join("");
}

export interface BrandedEmail {
  html: string;
  text: string;
}

// Build the full multipart-ready email. `subject` becomes the preheader/title;
// `bodyText` is the agent-authored content. Returns both the HTML part and a
// clean plain-text fallback.
export function renderBrandedEmail(subject: string, bodyText: string): BrandedEmail {
  const safeSubject = escapeHtml(subject);
  const bodyHtml = renderBody(bodyText);
  const year = "2026"; // server has no Date.now(); BH copyright line, low-stakes

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${safeSubject}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg}">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="background:${BRAND.primary};padding:28px 32px;border-bottom:4px solid ${BRAND.accent}">
            <a href="${BRAND.website}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:0.5px">Bein Harim</span>
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${BRAND.accent};text-transform:uppercase;letter-spacing:2px;display:block;margin-top:4px">Tours of Israel</span>
            </a>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;font-family:Arial,Helvetica,sans-serif">
            <h1 style="margin:0 0 20px;color:${BRAND.primary};font-size:20px;line-height:1.3">${safeSubject}</h1>
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;background:#fafbfc;border-top:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif">
            <p style="margin:0 0 6px;color:${BRAND.muted};font-size:13px;line-height:1.6">
              <a href="${BRAND.website}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.link};text-decoration:none;font-weight:bold">beinharimtours.com</a>
              &nbsp;&middot;&nbsp;
              <a href="mailto:${BRAND.email}" style="color:${BRAND.link};text-decoration:none">${BRAND.email}</a>
            </p>
            <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6">
              &copy; ${year} ${BRAND.name}. This message was sent following your call to our support line.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  // Plain-text fallback: the original text plus a simple footer.
  const text = `${bodyText.trim()}\n\n—\n${BRAND.name}\n${BRAND.website}\n${BRAND.email}`;

  return { html, text };
}
