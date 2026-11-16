// Hält das Supabase-Projekt aktiv (Free-Plan pausiert nach ~7 Tagen Inaktivität)
// und sichert die Con-Tabelle nach backup/cons-backup.json.
// Der Zeitstempel sorgt für einen Commit pro Lauf – sonst deaktiviert GitHub den Zeitplan nach 60 Tagen ohne Repo-Aktivität.
// Teilnahmen und Favoriten werden bewusst NICHT gesichert, weil das Repo öffentlich ist.
import { writeFile, mkdir } from "node:fs/promises";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) { console.log("Secrets fehlen – übersprungen."); process.exit(0); }

const res = await fetch(`${SUPABASE_URL}/rest/v1/cons?select=*&order=start_date.asc`, {
  headers: { apikey: SUPABASE_SECRET_KEY },
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const rows = (await res.json()).map(({ created_by, ...r }) => r);
await mkdir(new URL("../backup/", import.meta.url), { recursive: true });
await writeFile(new URL("../backup/cons-backup.json", import.meta.url), JSON.stringify({ generated_at: new Date().toISOString(), cons: rows }, null, 2) + "\n");
console.log(`Keepalive ok, ${rows.length} Cons gesichert.`);
