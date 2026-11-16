// Überträgt data/cons.json per Upsert (Schlüssel: slug) nach Supabase.
// Läuft in der GitHub Action "Cons synchronisieren". Keine Abhängigkeiten nötig (Node 20+).
import { readFile } from "node:fs/promises";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Secrets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen – Sync übersprungen.");
  process.exit(0);
}

const FIELDS = ["slug", "name", "start_date", "end_date", "date_note", "city", "address", "country", "lat", "lon",
  "url", "description", "tags", "price", "lodging", "deadlines", "status", "checked_at"];

const cons = JSON.parse(await readFile(new URL("../data/cons.json", import.meta.url), "utf8"));
const seen = new Set();
const rows = cons.map((c, i) => {
  if (!c.slug || !c.name) throw new Error(`Eintrag ${i}: slug und name sind Pflicht.`);
  if (seen.has(c.slug)) throw new Error(`Doppelter slug: ${c.slug}`);
  seen.add(c.slug);
  const row = { source: "repo" };
  for (const f of FIELDS) row[f] = c[f] ?? (f === "tags" || f === "deadlines" ? [] : null);
  if (!row.end_date) row.end_date = row.start_date;
  if (!row.country) row.country = "DE";
  if (!row.status) row.status = "angekündigt";
  return row;
});

const res = await fetch(`${SUPABASE_URL}/rest/v1/cons?on_conflict=slug`, {
  method: "POST",
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error(await res.text()); process.exit(1); }
console.log(`${rows.length} Cons synchronisiert.`);
