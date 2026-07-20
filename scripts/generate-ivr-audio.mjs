// Pre-generate the IVR menu audio as high-quality Ultra-voice MP3s (the same
// voices the AI agents use), written to public/ivr/ so the TeXML can <Play>
// them instead of the lower-quality platform <Say> TTS.
//
// Run (PowerShell):
//   $env:TELNYX_API_KEY="KEY..."; node scripts/generate-ivr-audio.mjs
// Re-run any time the wording/voices change, then commit the mp3s.
import fs from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const KEY = process.env.TELNYX_API_KEY;
if (!KEY) { console.error("Set TELNYX_API_KEY"); process.exit(1); }

// Ultra voices per language (match lib/telnyx.ts VOICE_BY_LANG / the agents).
const V = {
  en: "Telnyx.Ultra.00a77add-48d5-4ef6-8157-71e5437b282d", // Callie
  es: "Telnyx.Ultra.727f663b-0e90-4031-90f2-558b7334425b", // Carmen
  he: "Telnyx.Ultra.1daba551-67af-465e-a189-f91495aa2347", // Yael
  de: "Telnyx.Ultra.38aabb6a-f52b-4fb0-a3d1-988518f4dc06", // Alina
};

const clips = [
  // Level-1 language menu (each in its own language/voice).
  { file: "lang-en.mp3", voice: V.en, text: "Hi, this is Bein Harim Tours. For English, please press 1." },
  { file: "lang-es.mp3", voice: V.es, text: "Para español, por favor presione el 2." },
  { file: "lang-he.mp3", voice: V.he, text: "לעברית, אנא הקישו 3." },
  { file: "lang-de.mp3", voice: V.de, text: "Für Deutsch, drücken Sie bitte die 4." },
  // Level-2 intent menu.
  { file: "menu-en.mp3", voice: V.en, text: "Press 1 if you're currently on a trip or looking for your pickup location. Press 2 for information about our tours. Press 3 for any other question." },
  { file: "menu-es.mp3", voice: V.es, text: "Presione 1 si está de viaje ahora o busca su punto de recogida. Presione 2 para información sobre nuestros tours. Presione 3 para cualquier otra pregunta." },
  { file: "menu-he.mp3", voice: V.he, text: "הקישו 1 אם אתם בטיול כעת או מחפשים את נקודת האיסוף. הקישו 2 למידע על הטיולים שלנו. הקישו 3 לכל שאלה אחרת." },
  { file: "menu-de.mp3", voice: V.de, text: "Drücken Sie die 1, wenn Sie gerade auf einer Tour sind oder Ihren Abholort suchen. Drücken Sie die 2 für Informationen zu unseren Touren. Drücken Sie die 3 für alle anderen Fragen." },
  // No-answer transfer fallback.
  { file: "unavail-en.mp3", voice: V.en, text: "Sorry, our team is not available right now. Please try again later. Goodbye." },
  { file: "unavail-es.mp3", voice: V.es, text: "Lo sentimos, nuestro equipo no está disponible en este momento. Por favor, inténtelo de nuevo más tarde. Adiós." },
  { file: "unavail-he.mp3", voice: V.he, text: "מצטערים, הצוות שלנו אינו זמין כרגע. אנא נסו שוב מאוחר יותר. להתראות." },
  { file: "unavail-de.mp3", voice: V.de, text: "Es tut uns leid, unser Team ist im Moment nicht erreichbar. Bitte versuchen Sie es später erneut. Auf Wiederhören." },
];

const outDir = path.join("public", "ivr");
fs.mkdirSync(outDir, { recursive: true });

for (const c of clips) {
  const res = await fetch("https://api.telnyx.com/v2/text-to-speech/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: c.text, voice: c.voice }),
  });
  if (!res.ok) { console.error(`X ${c.file}: ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(outDir, c.file), buf);
  console.log(`OK ${c.file} (${buf.length} bytes)`);
}
console.log(`Done -> ${outDir}`);
