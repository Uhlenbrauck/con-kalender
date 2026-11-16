// 1) Offene Anfragen aus Supabase → GitHub-Issues (Label "con-anfrage"), Status "in Arbeit".
// 2) Bei geschlossenem Issue → Anfrage auf "erledigt" bzw. "nicht gefunden" (Label) setzen.
const { SUPABASE_URL: SB, SUPABASE_SECRET_KEY: KEY, GITHUB_TOKEN, REPO, EVENT, ISSUE_NUMBER, ISSUE_LABELS } = process.env;
if (!SB || !KEY) { console.log("Supabase-Secrets fehlen – übersprungen."); process.exit(0); }
const sbH = { apikey: KEY, "Content-Type": "application/json" };
const ghH = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
const must = async (r) => { if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r; };

if (EVENT === "issues") {
  const labels = (ISSUE_LABELS || "").split(",");
  if (!labels.includes("con-anfrage")) process.exit(0);
  const status = labels.includes("nicht-gefunden") ? "nicht gefunden" : "erledigt";
  await must(await fetch(`${SB}/rest/v1/con_requests?issue_number=eq.${ISSUE_NUMBER}`, {
    method: "PATCH", headers: sbH, body: JSON.stringify({ status }) }));
  console.log(`Anfrage zu Issue #${ISSUE_NUMBER}: ${status}`);
  process.exit(0);
}

const open = await (await must(await fetch(`${SB}/rest/v1/con_requests?status=eq.offen&select=*`, { headers: sbH }))).json();
for (const req of open) {
  const body = [`**Con-Name:** ${req.name}`, req.note ? `**Hinweise:** ${req.note}` : "",
    "", "_Automatisch aus dem Con-Kalender angelegt. Claude: recherchieren, in `data/cons.json` eintragen, Issue schließen._"].join("\n");
  const issue = await (await must(await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST", headers: ghH, body: JSON.stringify({ title: `Con-Anfrage: ${req.name}`, body, labels: ["con-anfrage"] }) }))).json();
  await must(await fetch(`${SB}/rest/v1/con_requests?id=eq.${req.id}`, {
    method: "PATCH", headers: sbH, body: JSON.stringify({ status: "in Arbeit", issue_number: issue.number }) }));
  console.log(`Issue #${issue.number} für "${req.name}" angelegt.`);
}
console.log(`${open.length} neue Anfrage(n).`);
