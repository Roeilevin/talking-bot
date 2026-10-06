// Poll a WhatsApp template until Meta finishes reviewing it, then (optionally)
// send the guide no-show test to a number.
// Run: node scripts/wait-template-approval.mjs guide_noshow_alert he [--send 0504425422]
import { loadEnv, requireKey, rpc } from "./lib/converto-mcp.mjs";
import { spawn } from "node:child_process";

loadEnv();
const KEY = requireKey();
const [name = "guide_noshow_alert", language = "he"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sendTo = process.argv.includes("--send") ? process.argv[process.argv.indexOf("--send") + 1] : null;

const MAX_MINUTES = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < MAX_MINUTES * 2; i++) {
  const r = await rpc(KEY, "get_template", { name, language });
  const tpl = r.parsed?.template || r.parsed?.data || r.parsed;
  const status = tpl?.status || "UNKNOWN";
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${name}/${language}: ${status}`);

  if (status === "APPROVED") {
    if (!sendTo) process.exit(0);
    console.log(`Approved — sending the test to ${sendTo}...`);
    const child = spawn(process.execPath, ["scripts/send-guide-noshow-test.mjs", sendTo], { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    break;
  }
  if (status === "REJECTED") {
    console.log(`Rejected: ${JSON.stringify(tpl?.rejected_reason || tpl || {}).slice(0, 300)}`);
    process.exit(1);
  }
  await sleep(30_000);
}
