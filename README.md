# Rollenspiel-Con-Kalender

Mobilfreundlicher Con-Kalender für einen Freundeskreis.
Frontend: statische Seite auf **GitHub Pages**. Datenbank und Login: **Supabase** (kostenloser Plan).

- Con-Termine sind öffentlich lesbar.
- Teilnahme („Will hin / Vielleicht / Nicht / War da“) sehen nur eingeloggte Freunde.
- Favoriten sieht nur die Person selbst.
- Entfernung = Luftlinie ab dem eigenen Startort, den jede Person in ihrem Profil festlegt.
- Mit „.ics“ lädst du deine Favoriten und Zusagen als Kalenderdatei herunter.

## Einrichtung (einmalig, alles über die Weboberfläche)

### 1. Supabase-Projekt
1. Auf supabase.com → **New project** → Region **Central EU (Frankfurt)**.
2. **SQL Editor → New query** → Inhalt von `supabase/schema.sql` einfügen → **Run**.
3. **Authentication → Sign In / Providers**:
   - Unter *Email*: „Enable Email provider“ an lassen.
   - **„Allow new users to sign up“ ausschalten**. Dann können sich nur Personen anmelden, die du eingeladen hast.
4. **Authentication → URL Configuration**:
   - *Site URL*: `https://<dein-github-name>.github.io/con-kalender/`
   - Dieselbe Adresse auch unter *Redirect URLs* eintragen.
5. **Project Settings → API**: *Project URL* und den **Publishable key** (`sb_publishable_…`) in `config.js` eintragen.
   Den **Secret key** (`sb_secret_…`) brauchst du nur für Schritt 2.3. **Gib ihn nie weiter und trag ihn nie in eine Datei ein.**

### 2. GitHub
1. Repo **Settings → Pages**: *Source: Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
2. **Settings → Actions → General → Workflow permissions**: „Read and write permissions“ aktivieren (das braucht das Backup).
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SECRET_KEY` = Secret key (`sb_secret_…`)
4. **Actions → „Cons synchronisieren“ → Run workflow**. Damit werden die Termine aus `data/cons.json` in die Datenbank übertragen.

### 3. Zugänge anlegen (Login mit E-Mail + Passwort)
1. In Supabase: **Authentication → Users → Add user → Create new user**, E-Mail und Startpasswort eintragen, **„Auto Confirm User“** anhaken. Für dich und jede weitere Person.
2. Startpasswort persönlich weitergeben. Nach dem ersten Login: unter „Profil“ Spitzname, Startort und ein eigenes Passwort setzen.
3. Dich selbst zum Admin machen: **Table Editor → profiles** → in deiner Zeile `is_admin` auf `true` setzen.
   Als Admin darfst du alle Cons bearbeiten. Alle anderen können Cons eintragen, aber nur ihre eigenen bearbeiten.

## So funktioniert das Eintragen

- **Über die Seite:** eingeloggt auf **„+ Con“** tippen. Der Eintrag landet direkt in der Datenbank.
- **Über das Repo (z. B. durch Claude):** Einträge in `data/cons.json` landen nach jedem Push automatisch in der Datenbank. Das Feld `slug` ist der eindeutige Schlüssel.
  ⚠️ Einträge, die aus `cons.json` stammen, werden beim nächsten Sync überschrieben. Ändere sie deshalb in der Datei, nicht auf der Seite.

## Nur den Namen eingeben – Claude recherchiert

1. Auf der Seite **„+ Con“** antippen, oben nur den **Namen** eintragen und auf **„Anfragen“** tippen.
   Alternativ in der GitHub-App: **Issues → New issue → „Con-Anfrage“**.
2. Die Action **„Con-Anfragen an Claude“** prüft stündlich, ob neue Anfragen da sind, und legt für jede ein Issue mit dem Label `con-anfrage` an.
3. Eine geplante Claude-Aufgabe läuft täglich. Sie recherchiert Termin, Ort, Beschreibung, Link und Fristen, trägt alles in `data/cons.json` ein und schließt das Issue.
4. Danach überträgt die Sync-Action den Eintrag in die Datenbank. Auf der Seite verschwindet die Anfrage, und die Con erscheint in der Liste.
   Findet Claude nichts Eindeutiges, bekommt das Issue zusätzlich das Label `nicht-gefunden` und einen Kommentar mit Rückfragen.

## Wartung

- Die Action **„Keepalive + Backup“** läuft alle 3 Tage.
  - Sie hält das kostenlose Supabase-Projekt aktiv, das sonst nach etwa 7 Tagen ohne Nutzung pausiert.
  - Sie sichert die Con-Tabelle nach `backup/cons-backup.json`.
  - Teilnahmen und Favoriten werden bewusst **nicht** gesichert, weil das Repo öffentlich ist.
- Falls das Projekt doch einmal pausiert: im Supabase-Dashboard auf **Restore** klicken.

## Demo-Modus

Solange `config.js` leer ist, läuft die Seite im Demo-Modus. Die Daten kommen dann aus `data/cons.json`, und deine Eingaben werden nur in deinem Browser gespeichert.

## Datenschutz

- Die Teilnahme ist nur für eingeloggte, eingeladene Personen sichtbar.
- Jede Person kann ihre Einträge jederzeit selbst löschen; dafür den gewählten Status erneut antippen.
- Gespeichert werden nur E-Mail-Adresse (für den Login), Spitzname, Startort und die Teilnahme-Markierungen.
