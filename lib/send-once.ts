// Guard against the assistant firing the same send twice.
//
// The LLM sometimes re-issues an identical tool call a second or two after the
// first (the tool result arrives while it is already mid-turn), which is how a
// caller ends up hearing "I've sent you the details" twice for one message. We
// key on recipient + what was sent and swallow the repeat, so the second call
// still succeeds — it just doesn't send again and tells the assistant not to
// re-announce it.
//
// In-memory and per-instance by design: the duplicate always lands in the same
// warm serverless instance seconds after the original, and a missed dedupe is
// only as bad as today's behaviour. No schema, no extra round-trip on the call.

const WINDOW_MS = 3 * 60 * 1000;
const recent = new Map<string, number>();

function sweep(now: number): void {
  for (const [k, at] of recent) if (now - at > WINDOW_MS) recent.delete(k);
}

export function sendKey(to: string, kind: string, parts: Array<string | number>): string {
  return `${to}|${kind}|${parts.join(",")}`;
}

// True when this exact send just happened — caller should skip it.
export function alreadySent(key: string): boolean {
  const now = Date.now();
  sweep(now);
  const at = recent.get(key);
  return at !== undefined && now - at <= WINDOW_MS;
}

export function markSent(key: string): void {
  recent.set(key, Date.now());
}

// Undo a claim when the send itself failed. Without this a transient WhatsApp
// error would look like a delivered message for the rest of the window, and the
// caller's "can you try again?" would be silently suppressed.
export function releaseSend(key: string): void {
  recent.delete(key);
}
