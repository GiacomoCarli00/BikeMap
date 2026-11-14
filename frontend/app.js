// BikeMap frontend
const $ = (s) => document.querySelector(s);

const mobile = matchMedia("(max-width: 760px)");
const map = L.map("map", { zoomControl: false }).setView([45.8, 9.4], 8);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pinIcon = (emoji) => L.divIcon({ className: "pin-icon", html: emoji, iconSize: [26, 26], iconAnchor: [13, 24] });

const state = { start: null, end: null, via: [], result: null };
const markers = { start: null, end: null, via: [] };
const routeLayer = L.layerGroup().addTo(map);
const styleValue = () => document.querySelector("input[name=style]:checked").value;

function showError(msg) {
  $("#error").textContent = msg;
  $("#error").hidden = false;
  if (sheet.state === "min") setSheet("mid");
}

// ---------- pannello a scomparsa (solo mobile) ----------
const panel = $("#panel");
const sheet = { state: "mid" };
const snaps = () => ({ min: 84, mid: Math.round(innerHeight * 0.46), max: Math.round(innerHeight * 0.92) });
function setSheet(name) {
  sheet.state = name;
  panel.dataset.sheet = name;
  panel.style.height = mobile.matches ? `${snaps()[name]}px` : "";
}
// spazio della mappa non coperto dal pannello, per centrare bene il percorso
const mapPadding = () => ({
  paddingTopLeft: [30, 30],
  paddingBottomRight: [30, 30 + (mobile.matches ? snaps()[sheet.state] : 0)],
});
{
  const grip = $("#grip");
  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    if (!mobile.matches) return;
    drag = { y: e.clientY, h: panel.offsetHeight, moved: false };
    grip.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 6) drag.moved = true;
    const s = snaps();
    panel.style.height = `${Math.max(s.min, Math.min(s.max, drag.h + dy))}px`;
    panel.dataset.sheet = "drag";
  });
  const end = () => {
    if (!drag) return;
    panel.classList.remove("dragging");
    const s = snaps();
    if (!drag.moved) setSheet(sheet.state === "min" ? "mid" : "min");   // tocco: apri/chiudi
    else {
      const h = panel.offsetHeight;
      setSheet(Object.keys(s).reduce((a, b) => (Math.abs(s[b] - h) < Math.abs(s[a] - h) ? b : a)));
    }
    drag = null;
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  const sync = () => setSheet(sheet.state);
  mobile.addEventListener("change", sync);
  addEventListener("resize", () => { if (!drag && document.activeElement?.tagName !== "INPUT") sync(); });
  sync();
}

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

function addVia(latlng) {
  const p = { lat: latlng.lat, lon: latlng.lng };
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
    row.innerHTML = `<span>📍 Tappa ${i + 1}: ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</span><button title="Rimuovi">✕</button>`;
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
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const items = await r.json();
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
  input.addEventListener("focus", () => { if (mobile.matches) setSheet("max"); });
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
    const r = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: [state.start.lat, state.start.lon],
        end: [state.end.lat, state.end.lon],
        via: state.via.map((p) => [p.lat, p.lon]),
        style: styleValue(),
        max_waypoints: Number($("#max-wp").value),
        google_avoid_highways: $("#avoid-hw").checked,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Errore nel calcolo");
    state.result = data;
    draw(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.textContent = "Calcola percorso";
    updateButton();
  }
}
$("#calc").onclick = calc;
["#max-wp", "#avoid-hw"].forEach((s) => $(s).addEventListener("change", autoCalc));
document.querySelectorAll("input[name=style]").forEach((el) => el.addEventListener("change", autoCalc));

// ---------- parti dalla mia posizione ----------
$("#locate").onclick = () => {
  const btn = $("#locate");
  if (!navigator.geolocation || !window.isSecureContext) {
    showError("La posizione è disponibile solo se il sito è aperto in HTTPS.");
    return;
  }
  $("#error").hidden = true;
  btn.classList.add("busy");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove("busy");
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setPoint("start", p, "La mia posizione");
      if (state.end) calc();
      else map.setView([p.lat, p.lon], 12);
    },
    (err) => {
      btn.classList.remove("busy");
      showError(err.code === 1 ? "Permesso di accesso alla posizione negato." : "Non riesco a trovare la tua posizione.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

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

  $("#result").hidden = false;
  if (mobile.matches) { setSheet("mid"); $("#panel-body").scrollTop = 0; document.activeElement?.blur(); }
  map.fitBounds(L.latLngBounds(pts), mapPadding());

  // statistiche
  const km = data.route.distance_m / 1000;
  $("#r-dist").textContent = km.toFixed(0);
  $("#summary").textContent = `${km.toFixed(0)} km · ${fmtTime(data.route.time_s)}`;
  $("#r-time").textContent = fmtTime(data.route.time_s);
  const extraMin = (data.route.time_s - data.fastest.time_s) / 60;
  $("#r-extra").textContent = `${extraMin >= 0 ? "+" : ""}${fmtTime(Math.abs(extraMin * 60))}`;

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

// ---------- stato GraphHopper ----------
async function checkHealth() {
  const el = $("#status");
  try {
    const r = await (await fetch("/api/health")).json();
    el.textContent = r.graphhopper ? "motore pronto" : "motore spento";
    el.className = "status " + (r.graphhopper ? "ok" : "ko");
  } catch {
    el.textContent = "backend spento";
    el.className = "status ko";
  }
}
checkHealth();
setInterval(checkHealth, 15000);
