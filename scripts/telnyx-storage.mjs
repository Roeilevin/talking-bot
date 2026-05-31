// One-off helper: Telnyx Cloud Storage is S3-compatible. Sign requests with
// SigV4 using the Telnyx API key as both access key id and secret access key.
// Usage:
//   node scripts/telnyx-storage.mjs list
//   node scripts/telnyx-storage.mjs create <bucket>
import crypto from "node:crypto";

const KEY = process.env.TELNYX_API_KEY;
if (!KEY) {
  console.error("Set TELNYX_API_KEY");
  process.exit(1);
}
const REGION = process.env.TELNYX_STORAGE_REGION || "us-central-1";
const HOST = `${REGION}.telnyxcloudstorage.com`;
const SERVICE = "s3";

function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function signedFetch(method, path, body = "") {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `host:${HOST}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + KEY, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${HOST}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
    body: method === "PUT" || method === "POST" ? body : undefined,
  });
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "list") {
  const res = await signedFetch("GET", "/");
  console.log("status", res.status);
  console.log(await res.text());
} else if (cmd === "create") {
  if (!arg) { console.error("need bucket name"); process.exit(1); }
  const res = await signedFetch("PUT", `/${arg}`);
  console.log("status", res.status);
  console.log(await res.text());
} else if (cmd === "get") {
  if (!arg) { console.error("need bucket/key path"); process.exit(1); }
  const res = await signedFetch("GET", `/${arg}`);
  console.log("status", res.status);
  console.log(await res.text());
} else {
  console.error("commands: list | create <bucket> | get <bucket/key>");
  process.exit(1);
}
