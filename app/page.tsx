export default function Home() {
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem", maxWidth: 600, margin: "0 auto" }}>
      <h1>Bein Harim Talking Bot</h1>
      <p>WhatsApp-to-voice automation service.</p>
      <p>
        <a href="/dashboard" style={{ textDecoration: "underline" }}>
          → History &amp; management dashboard
        </a>
      </p>
      <h2>Endpoints</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>POST /api/webhooks/converto</code> — Inbound WhatsApp messages
        </li>
        <li>
          <code>POST /api/webhooks/telnyx</code> — Telnyx call events
        </li>
        <li>
          <code>POST /api/tools/send-whatsapp</code> — AI tool: send WhatsApp
        </li>
        <li>
          <code>POST /api/tools/mark-noshow</code> — AI tool: mark no-show
        </li>
      </ul>
      <h2>Flow</h2>
      <ol style={{ lineHeight: 2 }}>
        <li>Receive 6-digit order number via WhatsApp</li>
        <li>Fetch order details from Bein Harim API</li>
        <li>If tour is not today → reply via WhatsApp</li>
        <li>If tour is today → trigger AI voice call</li>
        <li>AI agent handles conversation and outcomes</li>
      </ol>
    </div>
  );
}
