// BikeMap frontend
const $ = (s) => document.querySelector(s);

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
        style: $("#style").value,
        max_waypoints: Number($("#max-wp").value),
        google_avoid_highways: $("#avoid-hw").checked,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Errore nel calcolo");
    state.result = data;
    draw(data);
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").hidden = false;
  } finally {
    btn.textContent = "Calcola percorso";
    updateButton();
  }
}
$("#calc").onclick = calc;
["#style", "#max-wp", "#avoid-hw"].forEach((s) => $(s).addEventListener("change", autoCalc));

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
