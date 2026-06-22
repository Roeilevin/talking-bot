import { NextRequest, NextResponse } from "next/server";
import { sendCallerMessage } from "@/lib/converto";
import { affiliateUrl } from "@/lib/tours";

type LinkInput = string | { label?: string; url?: string };
type Link = { label: string; url: string };

// Normalize a caller-supplied link into { label, url }. Attaches the Bein Harim
// affiliate code to beinharimtours.com URLs so bookings made from the summary
// are attributed, matching get_tour_info / get_tour_availability.
function normalizeLink(link: LinkInput): Link | null {
  const raw = typeof link === "string" ? { url: link } : link;
  let url = String(raw?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/(^|\.)beinharimtours\.com/i.test(url)) url = affiliateUrl(url);
  const label = String((raw as { label?: string }).label ?? "").trim();
  return { label, url };
}

function renderLink(l: Link): string {
  return l.label ? `${l.label}: ${l.url}` : l.url;
}

// Called by the inbound AI assistant at the end of a support call to send a
// short WhatsApp summary — with any relevant links — to the caller. Honors the
// WhatsApp 24h session rule: rich free text inside an open session, approved
// template (call_summary_links → call_summary) when the window is closed.
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};
    console.log("[Tool: send-summary]", body);

    const { to, summary } = body;
    if (!to || !summary) {
      return NextResponse.json(
        { error: "Missing 'to' or 'summary' parameter" },
        { status: 400 }
      );
    }

    const normalized = String(to).replace(/[^0-9]/g, "");
    const summaryText = String(summary).trim();

    const links: Link[] = Array.isArray(body.links)
      ? (body.links as LinkInput[])
          .map(normalizeLink)
          .filter((l): l is Link => l !== null)
      : [];

    // Open 24h session: rich multi-line body, one clickable link per line.
    const sessionText = [
      summaryText,
      ...(links.length ? ["", ...links.map(renderLink)] : []),
    ].join("\n");

    // Closed window: template variables can't contain newlines, so links are
    // joined inline. {{2}} must be non-empty, so default to the site link.
    const linksInline = links.length
      ? links.map(renderLink).join("  |  ")
      : `More tours: ${affiliateUrl("https://www.beinharimtours.com/")}`;

    const channel = await sendCallerMessage(normalized, sessionText, [
      { name: "call_summary_links", params: [summaryText, linksInline] },
      { name: "call_summary", params: [summaryText] },
    ]);

    return NextResponse.json({ ok: true, channel, links: links.length });
  } catch (err) {
    console.error("[Tool: send-summary] Error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
