// Email normalization for addresses captured by voice. Speech-to-text often
// produces spoken forms ("john dot smith at gmail dot com") and mangles common
// provider domains; we repair those and flag when a correction was applied so the
// agent can read the fixed address back to the caller before sending.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Frequent voice/STT misfires on the big consumer providers.
const DOMAIN_FIXES: Record<string, string> = {
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gnail.com": "gmail.com",
  "googlemail.con": "googlemail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "outlok.com": "outlook.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yaho.com": "yahoo.com",
  "icloud.co": "icloud.com",
  "icloud.con": "icloud.com",
};

export interface NormalizedEmail {
  email: string;
  corrected: boolean;
}

// Returns the cleaned address (+ whether a domain typo was auto-corrected), or
// null if it still isn't a syntactically valid email.
export function normalizeEmail(raw: string): NormalizedEmail | null {
  let e = String(raw ?? "").trim().toLowerCase();
  // Collapse spoken forms before stripping spaces.
  e = e
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+/g, "");

  if (!e || !EMAIL_RE.test(e)) return null;

  const at = e.lastIndexOf("@");
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const fixed = DOMAIN_FIXES[domain];

  return fixed
    ? { email: `${local}@${fixed}`, corrected: true }
    : { email: e, corrected: false };
}
