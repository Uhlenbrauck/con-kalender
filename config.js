// Supabase-Zugangsdaten (Dashboard → Settings → API Keys).
// Der Publishable Key (sb_publishable_…) darf öffentlich sein – der Schutz läuft über Row Level Security.
// Solange die Werte leer sind, läuft die Seite im Demo-Modus (Daten aus data/cons.json, Speicherung nur lokal).
window.CON_CONFIG = {
  SUPABASE_URL: "https://nltyndgwvijrhrihwojn.supabase.co",
  SUPABASE_ANON_KEY: "",
  TITLE: "Rollenspiel-Con-Kalender",
};
