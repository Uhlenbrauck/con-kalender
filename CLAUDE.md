# Hinweise für Claude

## Con-Anfragen bearbeiten (Issues mit Label `con-anfrage`)
1. `gh issue list --label con-anfrage --state open` – jede Anfrage einzeln bearbeiten.
2. Recherche nur aus der offiziellen Con-Seite oder seriösen Quellen (Easy-Con, conservices, Veranstalter). Nächste Ausgabe ab heute suchen.
3. Eintrag in `data/cons.json` ergänzen (Schema siehe vorhandene Einträge):
   - `slug`: `<name>-<jahr>` kleingeschrieben, eindeutig; nie einen bestehenden Slug umbenennen.
   - `description`: 1–2 Sätze **in eigenen Worten**, kein kopierter Text.
   - `lat`/`lon` auf Stadt- oder Location-Ebene, `country` als ISO-Code.
   - Termin unbekannt → `start_date: null` und `date_note` mit üblichem Zeitraum; `status: "angekündigt"`.
   - Fristen (Ticket-VVK, Runden-/SL-Anmeldung) als `deadlines: [{ "date": "JJJJ-MM-TT", "label": "…" }]`.
   - `checked_at` = heutiges Datum.
4. JSON prüfen (`node -e "JSON.parse(require('fs').readFileSync('data/cons.json'))"`), committen, pushen.
5. Issue schließen mit kurzem Kommentar (Termin, Ort, Quelle). Nicht eindeutig → Label `nicht-gefunden` setzen, Rückfrage kommentieren, schließen.

## Aktualisierung bestehender Einträge
- Einträge ohne Datum oder mit `checked_at` älter als 30 Tage erneut prüfen; Datum/Status/Fristen nachtragen.
- Vergangene Cons nicht löschen (Archiv „War da“); stattdessen bei bekannter Folgeausgabe einen neuen Eintrag `<name>-<folgejahr>` anlegen.

## Neue Cons entdecken
- Con-Verzeichnisse regelmäßig abgleichen: https://www.we20.de/events und https://rollenspiel-kompass.de/conventions/ (außerdem Easy-Con „Open Conventions“).
- Nur Cons in Deutschland (bzw. grenznah) aufnehmen; Einträge aus Verzeichnissen mit `date_note: "laut Con-Verzeichnis …"` markieren, bis die Con-Seite den Termin bestätigt – dann `status: "bestätigt"`, `date_note: null`, `url` auf die Con-Seite.

## Sonst
- `config.js` enthält nur URL und anon-Key; niemals den service_role-Key ins Repo schreiben.
