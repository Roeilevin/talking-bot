// Scrape beinharimtours.com (which 403s non-browser crawlers, so Telnyx's
// own crawler can't read it) and upload page text into the Telnyx Cloud
// Storage bucket, then trigger embedding. Bounded crawl: same host only.
//
// Usage: TELNYX_API_KEY=... node scripts/scrape-and-embed.mjs
import crypto from "node:crypto";

const KEY = process.env.TELNYX_API_KEY;
if (!KEY) { console.error("Set TELNYX_API_KEY"); process.exit(1); }

const BUCKET = process.env.KB_BUCKET || "beinharim-kb";
const START = process.env.KB_START_URL || "https://www.beinharimtours.com";
const MAX_PAGES = Number(process.env.KB_MAX_PAGES || 60);
const MAX_DEPTH = Number(process.env.KB_MAX_DEPTH || 3);
const REGION = "us-central-1";
const HOST = `${REGION}.telnyxcloudstorage.com`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();

function s3Put(path, body, contentType) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalHeaders =
    `host:${HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + KEY, dateStamp), REGION), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return fetch(`https://${HOST}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Content-Type": contentType,
    },
    body,
  });
}

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: `${title}\n${desc}\n\n${body}`.trim() };
}

function slug(url) {
  const u = new URL(url);
  let s = (u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "home").slice(0, 80) + ".txt";
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal, redirect: "follow" });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("text/html")) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

const startHost = new URL(START).host;
const seen = new Set();
const queue = [{ url: START, depth: 0 }];
let uploaded = 0;

while (queue.length && uploaded < MAX_PAGES) {
  const { url, depth } = queue.shift();
  const norm = url.split("#")[0].replace(/\/$/, "");
  if (seen.has(norm)) continue;
  seen.add(norm);

  const html = await fetchPage(url);
  if (!html) { console.log("skip", url); continue; }

  const { title, text } = htmlToText(html);
  if (text.length > 200) {
    const res = await s3Put(`/${BUCKET}/${slug(url)}`, text, "text/plain; charset=utf-8");
    uploaded++;
    console.log(`[${uploaded}] ${res.status} ${url}  (${title.slice(0, 60)})`);
  }

  if (depth < MAX_DEPTH) {
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
    for (const href of links) {
      let abs;
      try { abs = new URL(href, url).toString(); } catch { continue; }
      const hu = new URL(abs);
      if (hu.host !== startHost) continue;
      if (/\.(jpg|jpeg|png|gif|svg|webp|css|js|ico|pdf|zip|mp4|woff2?)(\?|$)/i.test(hu.pathname)) continue;
      if (!seen.has(abs.split("#")[0].replace(/\/$/, ""))) queue.push({ url: abs, depth: depth + 1 });
    }
  }
}

console.log(`\nUploaded ${uploaded} pages to bucket '${BUCKET}'. Triggering embedding...`);
const embed = await fetch("https://api.telnyx.com/v2/ai/embeddings", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ bucket_name: BUCKET }),
});
console.log("embed trigger", embed.status, await embed.text());
