// Con-Kalender – Frontend (ohne Build-Schritt, läuft direkt auf GitHub Pages)
const CFG = window.CON_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
const $ = (s) => document.querySelector(s);

const STATUS_LABEL = { ja: "Will hin", vielleicht: "Vielleicht", nein: "Nicht", war_da: "War da" };
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

// ---------------------------------------------------------------- Backends
function demoBackend() {
  const ls = {
    get(k, d) { try { return JSON.parse(localStorage.getItem("ck_" + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ck_" + k, JSON.stringify(v)); } catch {} },
  };
  const me = { id: "demo-user", email: "demo@local" };
  return {
    mode: "demo",
    async init() {},
    user: () => me,
    onAuth() {},
    async cons() {
      const base = await fetch("data/cons.json").then((r) => r.json()).catch(() => []);
      const local = ls.get("cons", []);
      const deleted = new Set(ls.get("deleted", []));
      const map = new Map();
      for (const c of [...base, ...local]) map.set(c.slug, { ...c, id: c.slug, created_by: c.source === "repo" ? null : me.id });
      return [...map.values()].filter((c) => !deleted.has(c.id));
    },
    async profiles() { return [{ id: me.id, ...ls.get("profile", { nickname: "Ich" }), is_admin: true }]; },
    async attendance() { return Object.entries(ls.get("att", {})).map(([con_id, status]) => ({ con_id, user_id: me.id, status })); },
    async favorites() { return ls.get("fav", []).map((con_id) => ({ con_id })); },
    async setAttendance(conId, status) { const a = ls.get("att", {}); if (status) a[conId] = status; else delete a[conId]; ls.set("att", a); },
    async setFavorite(conId, on) { const f = new Set(ls.get("fav", [])); on ? f.add(conId) : f.delete(conId); ls.set("fav", [...f]); },
    async saveCon(con) {
      const list = ls.get("cons", []);
      if (!con.slug) con.slug = slugify(con.name, con.start_date);
      const i = list.findIndex((c) => c.slug === con.slug);
      i >= 0 ? (list[i] = con) : list.push(con);
      ls.set("cons", list);
    },
    async deleteCon(id) { const d = ls.get("deleted", []); d.push(id); ls.set("deleted", d); },
    async saveProfile(p) { ls.set("profile", { ...ls.get("profile", {}), ...p }); },
    async requests() { return ls.get("req", []); },
    async addRequest(name, note) { const r = ls.get("req", []); r.push({ id: Date.now() + "", name, note, status: "offen", requested_by: me.id }); ls.set("req", r); },
    async signIn() { throw new Error("Im Demo-Modus nicht verfügbar."); },
    async setPassword() {},
    async calToken() { return "00000000-0000-0000-0000-000000000000"; },
    async signOut() {},
  };
}

async function supabaseBackend() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  let session = null;
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  return {
    mode: "live",
    async init() { session = (await sb.auth.getSession()).data.session; },
    user: () => session?.user ?? null,
    onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => { const changed = (s?.user?.id) !== (session?.user?.id); session = s; if (changed) cb(); }); },
    async cons() { return ok(await sb.from("cons").select("*").order("start_date", { ascending: true, nullsFirst: false })); },
    async profiles() { return session ? ok(await sb.from("profiles").select("id,nickname,home_label,home_lat,home_lon,is_admin")) : []; },
    async attendance() { return session ? ok(await sb.from("attendance").select("con_id,user_id,status")) : []; },
    async favorites() { return session ? ok(await sb.from("favorites").select("con_id")) : []; },
    async setAttendance(conId, status) {
      if (status) ok(await sb.from("attendance").upsert({ con_id: conId, user_id: session.user.id, status, updated_at: new Date().toISOString() }));
      else ok(await sb.from("attendance").delete().eq("con_id", conId).eq("user_id", session.user.id));
    },
    async setFavorite(conId, on) {
      if (on) ok(await sb.from("favorites").upsert({ con_id: conId, user_id: session.user.id }));
      else ok(await sb.from("favorites").delete().eq("con_id", conId).eq("user_id", session.user.id));
    },
    async saveCon(con) {
      const { id, ...rest } = con;
      if (id) ok(await sb.from("cons").update(rest).eq("id", id));
      else ok(await sb.from("cons").insert({ ...rest, slug: slugify(rest.name, rest.start_date), source: "web" }));
    },
    async deleteCon(id) { ok(await sb.from("cons").delete().eq("id", id)); },
    async saveProfile(p) { ok(await sb.from("profiles").update(p).eq("id", session.user.id)); },
    async requests() { return session ? ok(await sb.from("con_requests").select("*").in("status", ["offen", "in Arbeit", "nicht gefunden"]).order("created_at")) : []; },
    async addRequest(name, note) { ok(await sb.from("con_requests").insert({ name, note, requested_by: session.user.id })); },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : error.message);
    },
    async setPassword(password) { ok(await sb.auth.updateUser({ password })); },
    async calToken(rotate) { return ok(await sb.rpc(rotate ? "rotate_calendar_token" : "my_calendar_token")); },
    async signOut() { await sb.auth.signOut(); },
  };
}

// ---------------------------------------------------------------- Helfer
function slugify(name, date) {
  const base = (name || "con").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base + (date ? "-" + date.slice(0, 4) : "") + "-" + Math.random().toString(36).slice(2, 6);
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } }
function parseDate(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function today() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
function fmtRange(a, b) {
  const s = parseDate(a), e = parseDate(b);
  if (!s) return "Termin offen";
  const f = (d) => `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  if (!e || +e === +s) return `${f(s)} ${s.getFullYear()}`;
  return `${f(s)} – ${f(e)} ${e.getFullYear()}`;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=de&q=" + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const j = await r.json();
  if (!j.length) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
function showBanner(msg, ms = 6000) {
  const b = $("#banner"); b.textContent = msg; b.hidden = false;
  clearTimeout(showBanner.t); if (ms) showBanner.t = setTimeout(() => (b.hidden = true), ms);
}

// ---------------------------------------------------------------- Zustand
const state = { cons: [], profiles: {}, att: [], fav: new Set(), req: [] };
let api;

async function load() {
  const [cons, profiles, att, fav, req] = await Promise.all([api.cons(), api.profiles(), api.attendance(), api.favorites(), api.requests().catch(() => [])]);
  state.req = req;
  state.cons = cons;
  state.profiles = Object.fromEntries(profiles.map((p) => [p.id, p]));
  state.att = att;
  state.fav = new Set(fav.map((f) => f.con_id));
  fillTagFilter();
  render();
}
function me() { const u = api.user(); return u ? state.profiles[u.id] || { id: u.id } : null; }

function fillTagFilter() {
  const sel = $("#f-tag"), cur = sel.value;
  const tags = [...new Set(state.cons.flatMap((c) => c.tags || []))].sort((a, b) => a.localeCompare(b, "de"));
  sel.innerHTML = '<option value="">Alle Tags</option>' + tags.map((t) => `<option>${esc(t)}</option>`).join("");
  sel.value = tags.includes(cur) ? cur : "";
}

// ---------------------------------------------------------------- Karte
let view = "list", map = null, layer = null;
const COL = { fav: "#c8962c", going: "#2f7d4f", normal: "#7a2e3a", tbd: "#8a8a8a" };
function setView(v) {
  view = v;
  $("#v-list").classList.toggle("on", v === "list"); $("#v-map").classList.toggle("on", v === "map");
  $("#list").hidden = v === "map"; $("#map-wrap").hidden = v !== "map";
  render();
}
function renderMap(rows, user, home) {
  if (!window.L) { $("#map-hint").textContent = "Karte wird geladen …"; return setTimeout(() => view === "map" && render(), 500); }
  if (!map) {
    map = L.map("map", { scrollWheelZoom: true }).setView([51.2, 9.5], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const lg = L.control({ position: "bottomleft" });
    lg.onAdd = () => Object.assign(document.createElement("div"), { className: "legend",
      innerHTML: `<div><i style="background:${COL.fav}"></i>Favorit</div><div><i style="background:${COL.going}"></i>jemand will hin</div>` +
        `<div><i style="background:${COL.normal}"></i>Con</div><div><i style="background:${COL.tbd}"></i>Termin offen</div>` });
    lg.addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 0);
  layer.clearLayers();
  const groups = new Map();
  for (const r of rows) { if (r.c.lat == null) continue; const k = (+r.c.lat).toFixed(3) + "," + (+r.c.lon).toFixed(3); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  const pts = [];
  for (const g of groups.values()) {
    const fav = g.some((r) => state.fav.has(r.c.id)), going = g.some((r) => r.att.some((a) => a.status === "ja"));
    const tbd = g.every((r) => !r.c.start_date);
    const color = fav ? COL.fav : going ? COL.going : tbd ? COL.tbd : COL.normal;
    const ll = [+g[0].c.lat, +g[0].c.lon]; pts.push(ll);
    const html = g.map((r) => {
      const url = safeUrl(r.c.url), going = r.att.filter((a) => a.status === "ja").map((a) => esc(state.profiles[a.user_id]?.nickname || "?"));
      return `<div class="pc"><b>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.c.name)}</a>` : esc(r.c.name)}</b><br>` +
        `${fmtRange(r.c.start_date, r.c.end_date)}${r.c.date_note && !r.c.start_date ? ` <i>(${esc(r.c.date_note)})</i>` : ""}<br>${esc(r.c.city || "")}` +
        `${r.dist != null ? ` · ~${Math.round(r.dist)} km` : ""}${going.length ? `<br>Will hin: ${going.join(", ")}` : ""}</div>`;
    }).join("");
    L.circleMarker(ll, { radius: g.length > 1 ? 9 : 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: .95 })
      .bindPopup(html, { maxWidth: 260 }).bindTooltip(g.length > 1 ? `${g.length} Cons` : g[0].c.name).addTo(layer);
  }
  if (home) { L.circleMarker([home.home_lat, home.home_lon], { radius: 6, color: "#1f1b2e", weight: 2, fillColor: "#fff", fillOpacity: 1 })
    .bindTooltip("Startort: " + (home.home_label || "")).addTo(layer); pts.push([home.home_lat, home.home_lon]); }
  if (!renderMap.fitted && pts.length) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 9 }); renderMap.fitted = true; }
  const noLoc = rows.filter((r) => r.c.lat == null).length;
  $("#map-hint").textContent = `${rows.length - noLoc} Cons auf der Karte` + (noLoc ? ` · ${noLoc} ohne Ort` : "");
}
$("#v-list").addEventListener("click", () => setView("list"));
$("#v-map").addEventListener("click", () => setView("map"));

// Personen-Auswahl für den Teilnahme-Filter (Ich, Jemand, einzelne Freunde)
function fillWhoFilter(user) {
  if (!user) return;
  const sel = $("#f-who"), cur = sel.value || "me";
  const others = Object.values(state.profiles).filter((p) => p.id !== user.id)
    .sort((a, b) => (a.nickname || "").localeCompare(b.nickname || "", "de"));
  const html = '<option value="me">Ich</option><option value="any">Jemand aus der Gruppe</option>' +
    others.map((p) => `<option value="${esc(p.id)}">${esc(p.nickname || "?")}</option>`).join("");
  if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "me";
}

// ---------------------------------------------------------------- Rendern
function render() {
  const user = api.user(), prof = me();
  $("#btn-account").textContent = user ? (prof?.nickname || "Profil") : "Anmelden";
  $("#btn-add").hidden = !user;
  $("#f-fav").closest("label").hidden = !user;
  $("#att-filter").hidden = !user;
  fillWhoFilter(user);

  const rq = $("#requests");
  rq.hidden = !user || !state.req.length;
  if (!rq.hidden) {
    const lbl = { offen: "wartet", "in Arbeit": "Claude recherchiert", "nicht gefunden": "nicht gefunden" };
    rq.innerHTML = "🔎 Anfragen: " + state.req.map((r) => `<b>${esc(r.name)}</b> (${lbl[r.status] || esc(r.status)})`).join(" · ");
  }

  const q = $("#f-search").value.trim().toLowerCase();
  const time = $("#f-time").value, maxDist = +$("#f-dist").value || 0, tag = $("#f-tag").value;
  const onlyFav = $("#f-fav").checked, who = $("#f-who").value, stat = user ? $("#f-status").value : "";
  const t0 = today();
  const home = prof && prof.home_lat != null ? prof : null;

  let rows = state.cons.map((c) => {
    const end = parseDate(c.end_date || c.start_date);
    const dist = home && c.lat != null ? haversine(home.home_lat, home.home_lon, c.lat, c.lon) : null;
    const att = state.att.filter((a) => a.con_id === c.id);
    return { c, end, dist, att, mine: att.find((a) => a.user_id === user?.id)?.status };
  });
  rows = rows.filter(({ c, end, dist, att, mine }) => {
    if (time === "upcoming" && end && end < t0) return false;
    if (time === "past" && (!end || end >= t0)) return false;
    if (maxDist && (dist == null || dist > maxDist)) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (onlyFav && !state.fav.has(c.id)) return false;
    if (stat) {
      const pool = who === "me" ? att.filter((a) => a.user_id === user.id)
        : who === "any" ? att : att.filter((a) => a.user_id === who);
      if (stat === "none" ? pool.length : !pool.some((a) => a.status === stat)) return false;
    }
    if (q && ![c.name, c.city, c.description, ...(c.tags || [])].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  rows.sort((a, b) => (a.c.start_date || "9999").localeCompare(b.c.start_date || "9999") * (time === "past" ? -1 : 1));

  if (view === "map") { renderMap(rows, user, home); $("#foot-info").textContent = `${rows.length} von ${state.cons.length} Cons`; return; }
  const list = $("#list");
  if (!rows.length) { list.innerHTML = '<p class="empty">Keine Cons für diese Auswahl.</p>'; return; }
  let html = "", lastMonth = "";
  for (const r of rows) {
    const s = parseDate(r.c.start_date);
    const mKey = s ? `${MONTHS_LONG[s.getMonth()]} ${s.getFullYear()}` : "Termin offen";
    if (mKey !== lastMonth) { html += `<h2 class="month">${mKey}</h2>`; lastMonth = mKey; }
    html += cardHtml(r, user, home);
  }
  list.innerHTML = html;
  $("#foot-info").textContent = `${rows.length} von ${state.cons.length} Cons` + (api.mode === "demo" ? " · Demo-Modus" : "") +
    (home ? ` · Entfernungen: Luftlinie ab ${home.home_label || "Startort"}` : "");
}

function cardHtml({ c, dist, att, mine }, user, home) {
  const s = parseDate(c.start_date);
  const t0 = today();
  const soon = (c.deadlines || []).filter((d) => { const x = parseDate(d.date); return x && x >= t0 && (x - t0) / 864e5 <= 60; });
  const badges = [
    c.status === "abgesagt" ? '<span class="badge cancel">Abgesagt</span>' : "",
    c.status === "angekündigt" || c.date_note ? `<span class="badge tbc">${esc(c.date_note || "unbestätigt")}</span>` : "",
    ...soon.map((d) => `<span class="badge deadline">⏰ ${esc(d.label)} bis ${fmtRange(d.date).replace(/ \d{4}$/, "")}</span>`),
  ].join("");
  const url = safeUrl(c.url);
  const meta = [fmtRange(c.start_date, c.end_date), c.city && esc(c.city) + (c.country && c.country !== "DE" ? ` (${esc(c.country)})` : ""),
    dist != null ? `~${Math.round(dist)} km` : ""].filter(Boolean).join(" · ");

  const others = user ? Object.entries(STATUS_LABEL).map(([k, label]) => {
    const names = att.filter((a) => a.status === k).map((a) => esc(state.profiles[a.user_id]?.nickname || "?"));
    return names.length ? `<span>${label}: <b>${names.join(", ")}</b></span>` : "";
  }).filter(Boolean).join(" · ") : "";

  const canEdit = user && (me()?.is_admin || c.created_by === user.id);
  const deadlinesAll = (c.deadlines || []).map((d) => `${fmtRange(d.date)}: ${esc(d.label)}`).join("<br>");

  return `<article class="card${c.status === "abgesagt" ? " cancelled" : ""}" data-id="${esc(c.id)}">
    <div class="card-head">
      <div class="date-box">${s ? `<div class="d">${s.getDate()}</div><div class="m">${MONTHS[s.getMonth()]}</div>` : '<div class="d">?</div>'}</div>
      <div class="card-main">
        <h3 class="card-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</h3>
        <div class="meta">${meta}</div>
        <div class="tags">${badges}${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
      ${user ? `<button class="fav${state.fav.has(c.id) ? " on" : ""}" data-act="fav" aria-label="Favorit">${state.fav.has(c.id) ? "★" : "☆"}</button>` : ""}
    </div>
    ${c.description || c.price || c.lodging || deadlinesAll || c.address ? `<details class="more"><summary>Details</summary>
      ${c.description ? `<p>${esc(c.description)}</p>` : ""}
      ${c.address ? `<div class="kv">📍 ${esc(c.address)}</div>` : ""}
      ${c.price ? `<div class="kv">💶 ${esc(c.price)}</div>` : ""}
      ${c.lodging ? `<div class="kv">🛏️ ${esc(c.lodging)}</div>` : ""}
      ${deadlinesAll ? `<div class="kv">⏰ ${deadlinesAll}</div>` : ""}
      ${c.checked_at ? `<div class="kv">Zuletzt geprüft: ${fmtRange(c.checked_at)}</div>` : ""}
      ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Zur Con-Seite →</a></p>` : ""}
    </details>` : ""}
    ${user ? `<div class="att">${Object.entries(STATUS_LABEL).map(([k, l]) =>
      `<button data-act="att" data-s="${k}" class="${mine === k ? "on" : ""}">${l}</button>`).join("")}
      ${canEdit ? '<button class="edit-link" data-act="edit">Bearbeiten</button>' : ""}</div>
      ${others ? `<div class="who">${others}</div>` : ""}` : ""}
  </article>`;
}

// ---------------------------------------------------------------- Aktionen
$("#list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  try {
    if (btn.dataset.act === "fav") {
      const on = !state.fav.has(id);
      await api.setFavorite(id, on); on ? state.fav.add(id) : state.fav.delete(id);
    } else if (btn.dataset.act === "att") {
      const uid = api.user().id, cur = state.att.find((a) => a.con_id === id && a.user_id === uid);
      const next = cur?.status === btn.dataset.s ? null : btn.dataset.s;
      await api.setAttendance(id, next);
      state.att = state.att.filter((a) => !(a.con_id === id && a.user_id === uid));
      if (next) state.att.push({ con_id: id, user_id: uid, status: next });
    } else if (btn.dataset.act === "edit") {
      return openConForm(state.cons.find((c) => c.id === id));
    }
    render();
  } catch (err) { showBanner("Fehler: " + err.message); }
});

for (const id of ["f-search", "f-time", "f-dist", "f-tag", "f-fav", "f-who"]) $("#" + id).addEventListener("input", render);
// "War da" betrifft vergangene Cons – Zeitraum dann automatisch erweitern
$("#f-status").addEventListener("input", () => {
  if ($("#f-status").value === "war_da" && $("#f-time").value === "upcoming") $("#f-time").value = "all";
  render();
});

// Konto / Profil
$("#btn-account").addEventListener("click", () => {
  const user = api.user(), p = me();
  $("#acc-login").hidden = !!user; $("#acc-profile").hidden = !user;
  $("#acc-title").textContent = user ? "Profil" : "Anmelden";
  $("#acc-logout").hidden = api.mode === "demo";
  if (user) {
    $("#p-nick").value = p?.nickname || ""; $("#p-home").value = p?.home_label || "";
    $("#p-geo-result").textContent = p?.home_lat != null ? `Gespeichert: ${p.home_lat.toFixed(3)}, ${p.home_lon.toFixed(3)}` : "Noch kein Startort.";
    delete $("#p-home").dataset.lat;
    $("#cal-link").hidden = true; $("#cal-actions").hidden = false;
  }
  $("#dlg-account").showModal();
});
$("#acc-send").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("#acc-email").value.trim(), pass = $("#acc-pass").value; if (!email || !pass) return;
  try { await api.signIn(email, pass); $("#acc-pass").value = ""; $("#dlg-account").close(); await load(); }
  catch (err) { showBanner("Anmeldung nicht möglich: " + err.message); }
});
$("#p-geo").addEventListener("click", async () => {
  const q = $("#p-home").value.trim(); if (!q) return;
  $("#p-geo-result").textContent = "Suche …";
  try {
    const g = await geocode(q);
    if (!g) return ($("#p-geo-result").textContent = "Nicht gefunden.");
    Object.assign($("#p-home").dataset, { lat: g.lat, lon: g.lon });
    $("#p-geo-result").textContent = "Gefunden: " + g.label;
  } catch { $("#p-geo-result").textContent = "Suche fehlgeschlagen."; }
});
$("#p-save").addEventListener("click", async (e) => {
  e.preventDefault();
  const d = $("#p-home").dataset;
  const patch = { nickname: $("#p-nick").value.trim() || "Ich", home_label: $("#p-home").value.trim() || null };
  if (d.lat) Object.assign(patch, { home_lat: +d.lat, home_lon: +d.lon });
  if (!patch.home_label) Object.assign(patch, { home_lat: null, home_lon: null });
  const newPass = $("#p-pass").value;
  if (newPass && newPass.length < 8) return showBanner("Passwort muss mindestens 8 Zeichen haben.");
  try {
    await api.saveProfile(patch);
    if (newPass) { await api.setPassword(newPass); $("#p-pass").value = ""; showBanner("Passwort geändert.", 3000); }
    $("#dlg-account").close(); await load();
  } catch (err) { showBanner("Fehler: " + err.message); }
});
$("#acc-logout").addEventListener("click", async () => { await api.signOut(); $("#dlg-account").close(); await load(); });

// Kalender-Abo
async function showCal(rotate) {
  try {
    const token = await api.calToken(rotate);
    const url = `${CFG.SUPABASE_URL || "https://example.supabase.co"}/functions/v1/ics?token=${token}`;
    const webcal = url.replace(/^https:/, "webcal:");
    $("#cal-url").value = url;
    $("#cal-google").href = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
    $("#cal-webcal").href = webcal;
    $("#cal-link").hidden = false; $("#cal-actions").hidden = true;
    if (rotate) showBanner("Neuer Abo-Link erzeugt – im Kalender bitte neu abonnieren.", 5000);
  } catch (err) { showBanner("Fehler: " + err.message); }
}
$("#cal-show").addEventListener("click", () => showCal(false));
$("#cal-rotate").addEventListener("click", () => showCal(true));
$("#cal-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#cal-url").value); showBanner("Link kopiert.", 2000); }
  catch { $("#cal-url").select(); }
});

// Con-Formular
let editing = null;
function openConForm(con) {
  editing = con || null;
  const f = $("#con-form"); f.reset();
  $("#con-form-title").textContent = con ? "Con bearbeiten" : "Con eintragen";
  $("#con-delete").hidden = !con;
  $("#quick-req").hidden = !!con; $("#q-name").value = ""; $("#q-note").value = "";
  $("#c-geo-result").textContent = "";
  if (con) {
    for (const k of ["name", "start_date", "end_date", "date_note", "city", "country", "address", "url", "description", "price", "lodging", "status", "lat", "lon"])
      if (f.elements[k]) f.elements[k].value = con[k] ?? "";
    f.elements.tags.value = (con.tags || []).join(", ");
    f.elements.deadlines.value = (con.deadlines || []).map((d) => `${d.date} ${d.label}`).join("\n");
    if (con.lat != null) $("#c-geo-result").textContent = `Koordinaten: ${(+con.lat).toFixed(3)}, ${(+con.lon).toFixed(3)}`;
  }
  $("#dlg-con").showModal();
}
$("#btn-add").addEventListener("click", () => openConForm(null));
$("#q-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#q-send").click(); } });
$("#q-send").addEventListener("click", async () => {
  const name = $("#q-name").value.trim(); if (!name) return;
  try {
    await api.addRequest(name, $("#q-note").value.trim() || null);
    $("#dlg-con").close(); await load();
    showBanner(`„${name}“ angefragt – Claude recherchiert und trägt die Con ein.`, 6000);
  } catch (err) { showBanner("Fehler: " + err.message); }
});
$("#c-geo").addEventListener("click", async () => {
  const f = $("#con-form"), q = [f.elements.address.value, f.elements.city.value].filter(Boolean).join(", ");
  if (!q) return;
  $("#c-geo-result").textContent = "Suche …";
  try {
    const g = await geocode(q);
    if (!g) return ($("#c-geo-result").textContent = "Nicht gefunden – nur Ort probieren.");
    f.elements.lat.value = g.lat; f.elements.lon.value = g.lon;
    $("#c-geo-result").textContent = "Gefunden: " + g.label;
  } catch { $("#c-geo-result").textContent = "Suche fehlgeschlagen."; }
});
$("#con-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  const f = e.target, v = (k) => f.elements[k].value.trim() || null;
  const deadlines = (f.elements.deadlines.value || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/); return m ? { date: m[1], label: m[2] } : null;
  }).filter(Boolean);
  const con = {
    ...(editing ? { id: editing.id, slug: editing.slug } : {}),
    name: v("name"), start_date: v("start_date"), end_date: v("end_date") || v("start_date"), date_note: v("date_note"),
    city: v("city"), country: (v("country") || "DE").toUpperCase(), address: v("address"),
    lat: v("lat") ? +v("lat") : null, lon: v("lon") ? +v("lon") : null,
    url: v("url"), description: v("description"), price: v("price"), lodging: v("lodging"),
    tags: (f.elements.tags.value || "").split(",").map((t) => t.trim()).filter(Boolean),
    deadlines, status: f.elements.status.value,
  };
  try { await api.saveCon(con); $("#dlg-con").close(); await load(); showBanner("Gespeichert.", 2500); }
  catch (err) { showBanner("Fehler: " + err.message); }
});
$("#con-delete").addEventListener("click", async () => {
  if (!editing) return;
  try { await api.deleteCon(editing.id); $("#dlg-con").close(); await load(); } catch (err) { showBanner("Fehler: " + err.message); }
});

// ICS-Export: Favoriten + eigene Zusagen
$("#btn-ics").addEventListener("click", () => {
  const uid = api.user()?.id;
  const ids = new Set([...state.fav, ...state.att.filter((a) => a.user_id === uid && a.status === "ja").map((a) => a.con_id)]);
  const cons = state.cons.filter((c) => (uid ? ids.has(c.id) : true) && c.start_date && c.status !== "abgesagt");
  if (!cons.length) return showBanner("Keine Favoriten oder Zusagen mit Datum vorhanden.");
  const d = (s) => s.replace(/-/g, "");
  const plusOne = (s) => { const x = parseDate(s); x.setDate(x.getDate() + 1); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`; };
  const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => "\\" + m);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//con-kalender//DE", "CALSCALE:GREGORIAN"];
  for (const c of cons) lines.push("BEGIN:VEVENT", `UID:${c.slug || c.id}@con-kalender`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d(c.start_date)}`, `DTEND;VALUE=DATE:${plusOne(c.end_date || c.start_date)}`,
    `SUMMARY:${icsEsc(c.name)}`, `LOCATION:${icsEsc(c.address || c.city)}`,
    `DESCRIPTION:${icsEsc([c.description, c.url].filter(Boolean).join("\n"))}`, ...(safeUrl(c.url) ? [`URL:${safeUrl(c.url)}`] : []), "END:VEVENT");
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "cons.ics" });
  document.body.append(a); a.click(); a.remove();
});

// ---------------------------------------------------------------- Start
(async () => {
  $("#title").textContent = document.title = CFG.TITLE || "Rollenspiel-Con-Kalender";
  try {
    api = DEMO ? demoBackend() : await supabaseBackend();
    await api.init();
    api.onAuth(() => load());
    if (DEMO) showBanner("Demo-Modus: Supabase ist noch nicht eingetragen (config.js). Änderungen bleiben nur in diesem Browser.", 0);
    await load();
  } catch (err) {
    $("#list").innerHTML = `<p class="empty">Laden fehlgeschlagen: ${esc(err.message)}</p>`;
  }
})();
