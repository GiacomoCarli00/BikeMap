// BikeMap frontend
const $ = (s) => document.querySelector(s);
// Indirizzo del motore di calcolo: vuoto = stesso sito (backend locale). Vedi config.js.
const API_BASE = (window.BIKEMAP_API_BASE || "").replace(/\/$/, "");
// "valhalla" = calcolo nel browser con Valhalla pubblico; "backend" = server GraphHopper (vedi config.js).
const ENGINE = window.BIKEMAP_ENGINE || "backend";

const map = L.map("map").setView([45.8, 9.4], 8);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pinIcon = (emoji) => L.divIcon({ className: "pin-icon", html: emoji, iconSize: [26, 26], iconAnchor: [13, 24] });

const state = { start: null, end: null, via: [], result: null };
const markers = { start: null, end: null, via: [] };
const routeLayer = L.layerGroup().addTo(map);

// ---------- punti ----------
function setPoint(kind, latlng, label) {
  state[kind] = { lat: latlng.lat, lon: latlng.lng ?? latlng.lon };
  const ll = [state[kind].lat, state[kind].lon];
  if (markers[kind]) markers[kind].setLatLng(ll);
  else {
    markers[kind] = L.marker(ll, { draggable: true, icon: pinIcon(kind === "start" ? "🟢" : "🏁") }).addTo(map);
    markers[kind].on("dragend", (e) => { setPoint(kind, e.target.getLatLng()); autoCalc(); });
  }
  $(`#${kind}-q`).value = label || `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
  updateButton();
}

function addVia(latlng, name) {
  const p = { lat: latlng.lat, lon: latlng.lng ?? latlng.lon, name };
  state.via.push(p);
  const m = L.marker([p.lat, p.lon], { draggable: true, icon: pinIcon("📍") }).addTo(map);
  m.on("dragend", (e) => { const ll = e.target.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; autoCalc(); });
  markers.via.push(m);
  renderVia();
}

function renderVia() {
  const box = $("#via-list");
  box.innerHTML = "";
  state.via.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "via";
    const label = p.name ? p.name : `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    row.innerHTML = `<span>📍 Tappa ${i + 1}: ${label}</span><button title="Rimuovi">✕</button>`;
    row.querySelector("button").onclick = () => {
      map.removeLayer(markers.via[i]);
      markers.via.splice(i, 1);
      state.via.splice(i, 1);
      renderVia();
      autoCalc();
    };
    box.appendChild(row);
  });
}

map.on("click", (e) => {
  if (!state.start) setPoint("start", e.latlng);
  else if (!state.end) { setPoint("end", e.latlng); calc(); }
});
map.on("contextmenu", (e) => { addVia(e.latlng); autoCalc(); });

function updateButton() { $("#calc").disabled = !(state.start && state.end); }
function autoCalc() { if (state.start && state.end && state.result) calc(); }

// ---------- ricerca luoghi ----------
// La ricerca va sempre direttamente a Nominatim: non dipende dal motore di calcolo.
async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "jsonv2", limit: "6", countrycodes: "it", "accept-language": "it" });
  const r = await fetch(url);
  if (!r.ok) throw new Error("Ricerca luoghi non disponibile");
  return (await r.json()).map((x) => ({ name: x.display_name, lat: parseFloat(x.lat), lon: parseFloat(x.lon) }));
}

function setupSearch(kind) {
  const input = $(`#${kind}-q`);
  const list = input.parentElement.querySelector(".results");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { list.innerHTML = ""; return; }
    timer = setTimeout(async () => {   // Nominatim chiede max 1 richiesta/secondo
      try {
        const items = await geocode(q);
        list.innerHTML = "";
        items.forEach((it) => {
          const li = document.createElement("li");
          li.textContent = it.name;
          li.onclick = () => {
            list.innerHTML = "";
            setPoint(kind, { lat: it.lat, lon: it.lon }, it.name.split(",").slice(0, 2).join(","));
            map.setView([it.lat, it.lon], 11);
            if (state.start && state.end) calc();
          };
          list.appendChild(li);
        });
      } catch { list.innerHTML = ""; }
    }, 600);
  });
  input.addEventListener("blur", () => setTimeout(() => (list.innerHTML = ""), 200));
}
setupSearch("start");
setupSearch("end");

// ---------- calcolo ----------
const CURVE_COLORS = () => [
  [0.8, css("--c-very")],
  [0.9, css("--c-curvy")],
  [0.98, css("--c-mixed")],
  [Infinity, css("--c-straight")],
];
const colorFor = (v) => CURVE_COLORS().find(([lim]) => v < lim)[1];

async function calc() {
  if (!state.start || !state.end) return;
  const btn = $("#calc");
  btn.disabled = true;
  btn.textContent = "Calcolo in corso…";
  $("#error").hidden = true;
  try {
    const req = {
      start: [state.start.lat, state.start.lon],
      end: [state.end.lat, state.end.lon],
      via: state.via.map((p) => [p.lat, p.lon]),
      style: "moto_curve",            // stile fisso: la scelta Sport/Tour/Crossover riguarda i punti sulla mappa
      max_waypoints: Number($("#max-wp").value),
      google_avoid_highways: $("#avoid-hw").checked,
      shortest: $("#shortest").checked,
      exclude_highways: $("#no-hw").checked,
    };
    let data;
    if (ENGINE === "valhalla") {
      // Calcolo nel browser con Valhalla pubblico: nessun backend necessario
      data = await window.BikeMapEngine.route(req);
    } else {
      const r = await fetch(`${API_BASE}/api/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Errore nel calcolo");
    }
    state.result = data;
    draw(data);
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").hidden = false;
  } finally {
    updateCalcLabel();
    updateButton();
  }
}

function updateCalcLabel() {
  $("#calc").textContent = state.result
    ? `Ricalcola percorso (${state.via.length} tappe)`
    : "Calcola percorso";
}
$("#calc").onclick = calc;
["#max-wp", "#avoid-hw", "#no-hw"].forEach((s) => $(s).addEventListener("change", autoCalc));
// "Autostrade" compare solo con il percorso piu' breve
$("#shortest").addEventListener("change", () => {
  $("#no-hw-row").hidden = !$("#shortest").checked;
  if (!$("#shortest").checked) $("#no-hw").checked = false;
  autoCalc();
});

function draw(data) {
  routeLayer.clearLayers();
  const pts = data.route.points;

  // percorso simulato di Google, tratteggiato sotto
  L.polyline(data.google.simulated, { color: css("--sim"), weight: 3, dashArray: "6 8", opacity: 0.7 }).addTo(routeLayer);

  // percorso moto colorato per tortuosita'
  L.polyline(pts, { color: "#000", weight: 8, opacity: 0.25 }).addTo(routeLayer);
  const segs = data.route.curvature.length ? data.route.curvature : [[0, pts.length - 1, 1]];
  segs.forEach(([a, b, v]) => {
    L.polyline(pts.slice(a, b + 1), { color: colorFor(v), weight: 5, opacity: 0.95 })
      .bindTooltip(`curvatura ${v.toFixed(2)}`, { sticky: true })
      .addTo(routeLayer);
  });

  // tappe del link Google
  data.google.waypoints.forEach((w, i) => {
    L.marker(w, { icon: L.divIcon({ className: "wp-icon", html: String(i + 1), iconSize: [22, 22] }) })
      .bindTooltip(`Tappa Google ${i + 1}`)
      .addTo(routeLayer);
  });

  map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });

  // statistiche
  const km = data.route.distance_m / 1000;
  $("#r-dist").textContent = km.toFixed(0);
  $("#r-time").textContent = fmtTime(data.route.time_s);
  const extraMin = (data.route.time_s - data.fastest.time_s) / 60;
  $("#r-extra").textContent = `${extraMin >= 0 ? "+" : ""}${fmtTime(Math.abs(extraMin * 60))}`;

  // costi stimati: pedaggio (km a pedaggio x tariffa) e benzina per i tre tipi di percorso
  const c = window.BIKEMAP_COSTS;
  const eur = (x) => `${x.toFixed(2).replace(".", ",")} €`;
  const tollKm = data.route.toll_km || 0;
  $("#r-toll").textContent = tollKm > 0 ? `~${eur(tollKm * c.tollEurPerKm)}` : "0 €";
  $("#r-fuel-sport").textContent = `~${eur((km / c.kmPerL.sport) * c.fuelPricePerL)}`;
  $("#r-fuel-tour").textContent = `~${eur((km / c.kmPerL.tour) * c.fuelPricePerL)}`;
  $("#r-fuel-cross").textContent = `~${eur((km / c.kmPerL.crossover) * c.fuelPricePerL)}`;
  $("#cost-note").textContent =
    `Benzina a ${eur(c.fuelPricePerL)}/L (prezzo del ${c.fuelPriceDate}, da aggiornare). ` +
    `Pedaggio: ${tollKm.toFixed(0)} km a pedaggio × ${eur(c.tollEurPerKm)}/km (stima, non tariffa ufficiale).`;

  const sh = data.route.curvy_share;
  const bar = $("#curvy-bar");
  bar.innerHTML = "";
  [["molto_curvo", "--c-very"], ["curvo", "--c-curvy"], ["mosso", "--c-mixed"], ["dritto", "--c-straight"]].forEach(([k, c]) => {
    const d = document.createElement("div");
    d.style.width = `${sh[k] * 100}%`;
    d.style.background = css(c);
    d.title = `${k.replace("_", " ")}: ${(sh[k] * 100).toFixed(0)}%`;
    bar.appendChild(d);
  });

  $("#r-fid").textContent = `${Math.round(data.google.fidelity * 100)}%`;
  $("#r-nwp").textContent = data.google.waypoints.length;
  $("#open-gmaps").href = data.google.url;

  const qr = $("#qr");
  qr.innerHTML = "";
  if (window.QRCode) new QRCode(qr, { text: data.google.url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.L });

  $("#result").hidden = false;
  refreshPois();
}

function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}` : `${m} min`;
}

$("#copy-link").onclick = async () => {
  await navigator.clipboard.writeText(state.result.google.url);
  $("#copy-link").textContent = "Copiato ✓";
  setTimeout(() => ($("#copy-link").textContent = "Copia link"), 1500);
};
$("#dl-gpx").onclick = () => {
  const blob = new Blob([state.result.gpx], { type: "application/gpx+xml" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "bikemap.gpx" });
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- passi di montagna sulla mappa ----------
// I passi (file poi-motociclisti.json, da OpenStreetMap) si mostrano entro la distanza scelta
// con lo slider dal percorso calcolato. Toccandoli si includono nel giro.
const poiLayer = L.layerGroup().addTo(map);
let pois = [];     // passi di montagna (cerchi) - selezione Sport
let views = [];    // punti panoramici (quadrati) - selezione Tour
fetch("poi-motociclisti.json")
  .then((r) => r.json())
  .then((d) => { pois = d.passi.map((p) => ({ ...p, type: "passo" })); refreshPois(); })
  .catch(() => { pois = []; });
fetch("poi-panoramici.json")
  .then((r) => r.json())
  .then((d) => { views = d.punti.map((p) => ({ ...p, type: "panorama" })); refreshPois(); })
  .catch(() => { views = []; });

$("#poi-radius").addEventListener("input", refreshPois);
$("#mode").addEventListener("change", refreshPois);

// Quali punti mostrare in base alla selezione: Sport = passi, Tour = panoramici, Crossover = entrambi
function visiblePoints() {
  const mode = $("#mode").value;
  const list = [];
  if (mode === "sport" || mode === "crossover") list.push(...pois);
  if (mode === "tour" || mode === "crossover") list.push(...views);
  return list;
}

// Distanza approssimata in km (sufficiente per qualche centinaio di km in Italia)
function approxKm(a, b) {
  const kx = 111.32 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
  const dx = (a[1] - b[1]) * kx, dy = (a[0] - b[0]) * 110.57;
  return Math.hypot(dx, dy);
}

// Campioni del percorso (circa uno ogni qualche centinaio di metri), per il calcolo veloce
function sampleRoute(pts) {
  const step = Math.max(1, Math.floor(pts.length / 1500));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
}

// Distanza minima dal percorso (km), oppure Infinity se oltre il raggio
function distToRouteKm(p, samples, radiusKm) {
  let best = Infinity;
  for (const s of samples) {
    if (Math.abs(s[0] - p.lat) > radiusKm / 110) continue;   // scarto veloce in latitudine
    const d = approxKm([p.lat, p.lon], s);
    if (d < best) best = d;
  }
  return best <= radiusKm ? best : Infinity;
}

// Colore in base alla deviazione stimata (km in piu' rispetto al percorso)
function detourColor(km) {
  if (km < 15) return "#2da44e";   // verde
  if (km < 25) return "#d4a72c";   // giallo
  if (km < 35) return "#e16f24";   // arancio
  if (km < 50) return "#d0443a";   // rosso chiaro
  if (km < 100) return "#7a0c0c";  // rosso scuro
  return "#000000";                // nero: oltre 100 km
}

const sameSpot = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
const isSelected = (p) => state.via.some((v) => sameSpot(v, p));

function refreshPois() {
  poiLayer.clearLayers();
  const box = $("#pois");
  const list = visiblePoints();
  if (!state.result || !list.length) { box.hidden = true; return; }
  box.hidden = false;

  const radius = Number($("#poi-radius").value);
  $("#poi-km").textContent = radius;
  const samples = sampleRoute(state.result.route.points);
  let nPass = 0, nView = 0;
  for (const p of list) {
    const d = distToRouteKm(p, samples, radius);
    if (d === Infinity) continue;
    p.detour_km = 2 * d;                 // andata e ritorno dal punto del percorso piu' vicino
    const sel = isSelected(p);
    const color = detourColor(p.detour_km);
    if (p.type === "passo") {
      nPass++;
      L.circleMarker([p.lat, p.lon], {
        radius: sel ? 10 : 7,
        color: sel ? "#000" : "#333",
        weight: sel ? 4 : 1.5,
        fillColor: color,
        fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .on("click", (e) => openPoiPopup(p, e.latlng))
        .addTo(poiLayer);
    } else {
      nView++;
      // panoramici: quadrato, stessa colorazione
      const icon = L.divIcon({
        className: "sq-icon",
        html: `<div class="sq${sel ? " sel" : ""}" style="background:${color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([p.lat, p.lon], { icon, bubblingMouseEvents: false })
        .on("click", (e) => openPoiPopup(p, e.latlng))
        .addTo(poiLayer);
    }
  }
  const parts = [];
  if (nPass) parts.push(`${nPass} passi`);
  if (nView) parts.push(`${nView} panoramici`);
  $("#poi-count").textContent = `${parts.join(" + ") || "nessun punto"} entro ${radius} km · inclusi nel giro: ${state.via.length}`;
}

// "Info": cerca su Google il nome del punto piu' la localita' (ricavata dalle coordinate)
async function openInfo(p) {
  // la scheda si apre subito, cosi' il browser non la blocca; poi ci mettiamo la ricerca
  const win = window.open("", "_blank");
  let place = "Italia";
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/reverse?" +
      new URLSearchParams({ lat: p.lat, lon: p.lon, format: "jsonv2", zoom: "10", "accept-language": "it" }));
    const a = (await r.json()).address || {};
    const town = a.village || a.town || a.city || a.municipality || a.hamlet;
    place = [town, a.county || a.state].filter(Boolean).join(", ") || "Italia";
  } catch { /* senza localita' cerchiamo solo per nome */ }
  const url = "https://www.google.com/search?q=" + encodeURIComponent(`${p.name} ${place}`);
  if (win) win.location.href = url;
  else window.open(url, "_blank");
}

// Popup persistente con nome e conferma: funziona anche al tocco su telefono
function openPoiPopup(p, latlng) {
  const sel = isSelected(p);
  const box = document.createElement("div");
  box.className = "poi-pop";
  const title = document.createElement("b");
  title.textContent = p.name;
  const info = document.createElement("div");
  const quota = p.ele_m ? `${p.ele_m} m · ` : "";
  const kind = p.type === "passo" ? "passo" : "panoramico";
  info.textContent = `${kind} · ${quota}deviazione stimata: ~${p.detour_km.toFixed(0)} km`;
  const actions = document.createElement("div");
  actions.className = "poi-actions";
  const ok = document.createElement("button");
  ok.textContent = sel ? "Rimuovi dal giro" : "Aggiungi al giro";
  ok.onclick = () => { togglePoi(p); map.closePopup(); };
  const cancel = document.createElement("button");
  cancel.textContent = "Annulla";
  cancel.onclick = () => map.closePopup();
  const infoBtn = document.createElement("button");
  infoBtn.textContent = "Info";
  infoBtn.onclick = () => openInfo(p);
  actions.append(ok, infoBtn, cancel);
  box.append(title, info, actions);
  L.popup({ closeButton: true }).setLatLng(latlng).setContent(box).openOn(map);
}

function togglePoi(p) {
  const list = state.via.filter((v) => !sameSpot(v, p));
  if (list.length === state.via.length) list.push({ lat: p.lat, lon: p.lon, name: p.name });
  rebuildVia(list);
  sortViaAlongRoute();
  updateCalcLabel();
  refreshPois();
}

// Ricostruisce le tappe (e i loro segnaposto) dalla lista data
function rebuildVia(list) {
  markers.via.forEach((m) => map.removeLayer(m));
  markers.via = [];
  state.via = [];
  list.forEach((p) => addVia({ lat: p.lat, lng: p.lon }, p.name));
}

// Ordina le tappe nell'ordine in cui il percorso le attraversa
function sortViaAlongRoute() {
  if (!state.result) return;
  const pts = state.result.route.points;
  const progress = (p) => {
    let best = 0, bestD = Infinity;
    pts.forEach((q, i) => { const d = approxKm([p.lat, p.lon], q); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };
  const sorted = state.via.map((p) => ({ p, at: progress(p) })).sort((a, b) => a.at - b.at).map((x) => x.p);
  rebuildVia(sorted);
}

// ---------- stato GraphHopper ----------
// Nessun backend richiesto per la ricerca; il calcolo usa il motore in API_BASE.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
async function checkHealth() {
  const el = $("#status");
  if (ENGINE === "valhalla") {
    el.textContent = "motore: Valhalla pubblico";
    el.className = "status ok";
    return;
  }
  try {
    const r = await (await fetch(`${API_BASE}/api/health`)).json();
    el.textContent = r.graphhopper ? "motore pronto" : "motore spento";
    el.className = "status " + (r.graphhopper ? "ok" : "ko");
  } catch {
    el.textContent = "backend spento";
    el.className = "status ko";
  }
}
checkHealth();
setInterval(checkHealth, 15000);
