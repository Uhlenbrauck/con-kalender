// Supabase Edge Function "ics": liefert den persönlichen Con-Kalender als iCalendar-Abo.
// Aufruf: https://<projekt>.supabase.co/functions/v1/ics?token=<uuid>
// Wichtig: in den Function-Einstellungen "Verify JWT" AUSschalten (Google sendet keinen Login).
// Nutzt nur den öffentlichen Publishable Key; der Zugriff ist über den geheimen Token geschützt.

const SUPABASE_URL = "https://nltyndgwvijrhrihwojn.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_rHId5qE95YPYn-jhpTfFhA_b5ZbG6v_";
const PAGE_URL = "https://uhlenbrauck.github.io/con-kalender/";

type Row = { slug: string; name: string; start_date: string | null; end_date: string | null; city: string | null;
  address: string | null; url: string | null; description: string | null; status: string;
  deadlines: { date: string; label: string }[] | null; updated_at: string; is_fav: boolean; going: boolean };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, (m) => "\\" + m);
const d8 = (s: string) => s.replace(/-/g, "");
const next = (s: string) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
const stamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
// RFC 5545: Zeilen > 75 Oktette falten
const fold = (line: string) => { const out: string[] = []; let cur = ""; for (const ch of line) {
  if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = " " + ch; } else cur += ch; } out.push(cur); return out.join("\r\n"); };

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("token fehlt", { status: 400 });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return new Response("Fehler", { status: 502 });
  const rows: Row[] = await r.json();

  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//con-kalender//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Con-Kalender", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const c of rows) {
    if (!c.start_date || c.status === "abgesagt") continue;
    const tag = c.going ? "✔ " : "★ ";
    const desc = [c.description, c.url, "Con-Kalender: " + PAGE_URL].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", `UID:${c.slug}@con-kalender`, `DTSTAMP:${stamp(c.updated_at)}`,
      `DTSTART;VALUE=DATE:${d8(c.start_date)}`, `DTEND;VALUE=DATE:${next(c.end_date || c.start_date)}`,
      `SUMMARY:${esc(tag + c.name)}`, `LOCATION:${esc(c.address || c.city || "")}`, `DESCRIPTION:${esc(desc)}`,
      ...(c.url ? [`URL:${c.url}`] : []), "TRANSP:TRANSPARENT", "END:VEVENT");
    for (const dl of c.deadlines || []) {
      if (!dl?.date) continue;
      L.push("BEGIN:VEVENT", `UID:${c.slug}-${d8(dl.date)}-frist@con-kalender`, `DTSTAMP:${stamp(c.updated_at)}`,
        `DTSTART;VALUE=DATE:${d8(dl.date)}`, `DTEND;VALUE=DATE:${next(dl.date)}`,
        `SUMMARY:${esc("⏰ " + dl.label + " – " + c.name)}`, `DESCRIPTION:${esc(c.url || PAGE_URL)}`,
        "TRANSP:TRANSPARENT", "END:VEVENT");
    }
  }
  L.push("END:VCALENDAR");
  return new Response(L.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "max-age=900" },
  });
});
