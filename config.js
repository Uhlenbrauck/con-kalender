// Supabase-Zugangsdaten (Dashboard → Project Settings → API).
// Der "anon public"-Schlüssel darf öffentlich sein – der Schutz läuft über Row Level Security.
// Solange die Werte leer sind, läuft die Seite im Demo-Modus (Daten aus data/cons.json, Speicherung nur lokal).
window.CON_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  TITLE: "Rollenspiel-Con-Kalender",
};
