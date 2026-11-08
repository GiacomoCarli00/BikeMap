// Motore di calcolo nel browser, usando il servizio pubblico Valhalla (OpenStreetMap).
// Replica le risposte del backend Python (/api/route), cosi' l'interfaccia resta identica.
//
// Differenze rispetto a GraphHopper:
// - Valhalla non ha la "curvatura" come costo: la modalita' Curve e' approssimata
//   abbassando l'uso delle autostrade. La tortuosita' colorata viene calcolata dalla geometria.
// - Il servizio e' gestito dalla comunita' OpenStreetMap: usare con moderazione.
(function () {
  const VALHALLA = "https://valhalla1.openstreetmap.de/route";
  const EARTH_R = 6371000;
  const SAMPLE_STEP_M = 100;   // come waypoints.py
  const TOLERANCE_M = 120;
  const TARGET_FIDELITY = 0.97;

  // ---------- geometria ----------
  const rad = (d) => (d * Math.PI) / 180;
  function haversine(a, b) {
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(h));
  }
  function cumulative(points) {
    const out = [0];
    for (let i = 0; i < points.length - 1; i++) out.push(out[i] + haversine(points[i], points[i + 1]));
    return out;
  }
  function resample(points, stepM) {
    if (points.length < 2) return points.slice();
    const out = [points[0]];
    let carry = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const seg = haversine(a, b);
      if (seg === 0) continue;
      let pos = stepM - carry;
      while (pos <= seg) {
        const t = pos / seg;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        pos += stepM;
      }
      carry = seg - (pos - stepM);
    }
    const last = points[points.length - 1];
    const tail = out[out.length - 1];
    if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
    return out;
  }
  function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // Indice spaziale: "quanto dista questo punto dalla polilinea?" (come PolylineIndex in geo.py)
  function makeIndex(points, refLat) {
    if (refLat === undefined) refLat = points.reduce((s, p) => s + p[0], 0) / Math.max(points.length, 1);
    const kx = Math.cos(rad(refLat)) * EARTH_R * Math.PI / 180, ky = EARTH_R * Math.PI / 180;
    const xy = points.map((p) => [p[1] * kx, p[0] * ky]);
    const cell = 500;
    const grid = new Map();
    const key = (x, y) => x + "," + y;
    for (let i = 0; i < xy.length - 1; i++) {
      const [ax, ay] = xy[i], [bx, by] = xy[i + 1];
      const steps = Math.max(1, Math.floor(Math.hypot(bx - ax, by - ay) / cell) + 1);
      const seen = new Set();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const c = key(Math.floor((ax + (bx - ax) * t) / cell), Math.floor((ay + (by - ay) * t) / cell));
        if (!seen.has(c)) {
          seen.add(c);
          if (!grid.has(c)) grid.set(c, []);
          grid.get(c).push(i);
        }
      }
    }
    return {
      refLat,
      distance(p) {
        const px = p[1] * kx, py = p[0] * ky;
        const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
        let best = Infinity;
        const checked = new Set();
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const list = grid.get(key(gx, gy));
            if (!list) continue;
            for (const i of list) {
              if (checked.has(i)) continue;
              checked.add(i);
              const d = pointSegDist(px, py, xy[i][0], xy[i][1], xy[i + 1][0], xy[i + 1][1]);
              if (d < best) best = d;
            }
          }
        }
        return best;
      },
    };
  }
  function nearestIndex(points, target) {
    let best = 0, bestD = Infinity;
    points.forEach((p, i) => { const d = haversine(p, target); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }

  // ---------- Valhalla ----------
  // Decodifica la polilinea compressa di Valhalla (precisione 1e-6).
  function decodePolyline6(str) {
    const pts = [];
    let lat = 0, lon = 0, i = 0;
    while (i < str.length) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += result & 1 ? ~(result >> 1) : result >> 1;
      pts.push([lat / 1e6, lon / 1e6]);
    }
    return pts;
  }

  // Il servizio accetta al massimo 10 punti per richiesta: i percorsi piu' lunghi vengono
  // spezzati in blocchi che si toccano agli estremi, e poi ricomposti.
  const MAX_LOCATIONS = 10;

  async function valhallaRoute(points, costing, useHighways) {
    if (points.length <= MAX_LOCATIONS) return valhallaSingle(points, costing, useHighways);
    let shape = [], distance_m = 0, time_s = 0;
    for (let s = 0; s < points.length - 1; s += MAX_LOCATIONS - 1) {
      const block = points.slice(s, Math.min(s + MAX_LOCATIONS, points.length));
      const part = await valhallaSingle(block, costing, useHighways);
      if (shape.length && part.points.length) part.points.shift();
      shape = shape.concat(part.points);
      distance_m += part.distance_m;
      time_s += part.time_s;
    }
    return { points: shape, distance_m, time_s };
  }

  // Una sola richiesta a Valhalla (al massimo MAX_LOCATIONS punti).
  async function valhallaSingle(points, costing, useHighways) {
    const locations = points.map((p, i) => ({
      lat: p[0], lon: p[1],
      type: i === 0 || i === points.length - 1 ? "break" : "through",
    }));
    const body = {
      locations,
      costing,
      costing_options: { [costing]: { use_highways: useHighways } },
      directions_options: { units: "kilometers" },
    };
    const r = await fetch(VALHALLA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok || !data.trip) throw new Error((data && data.error) || "Calcolo non riuscito (Valhalla)");
    let shape = [];
    for (const leg of data.trip.legs) {
      const pts = decodePolyline6(leg.shape);
      // il primo punto di ogni tratta coincide con l'ultimo della precedente: non duplicarlo
      if (shape.length && pts.length) pts.shift();
      shape = shape.concat(pts);
    }
    return {
      points: shape,
      distance_m: data.trip.summary.length * 1000,
      time_s: data.trip.summary.time,
    };
  }

  // ---------- curvatura e tortuosita' ----------
  // Divide il percorso in tratti di ~300 m: rapporto linea d'aria / lunghezza reale (1 = dritto).
  function curvature(points, chunkM = 300) {
    const out = [];
    if (points.length < 2) return out;
    const cum = cumulative(points);
    let a = 0;
    for (let b = 1; b < points.length; b++) {
      if (cum[b] - cum[a] >= chunkM || b === points.length - 1) {
        const real = cum[b] - cum[a];
        const air = haversine(points[a], points[b]);
        const v = real > 0 ? Math.min(1, air / real) : 1;
        out.push([a, b, Math.round(v * 1000) / 1000]);
        a = b;
      }
    }
    return out;
  }
  function curvyShare(points, details) {
    const cum = cumulative(points);
    const total = cum[cum.length - 1] || 1;
    const buckets = { molto_curvo: 0, curvo: 0, mosso: 0, dritto: 0 };
    for (const [a, b, v] of details) {
      const d = cum[b] - cum[a];
      if (v < 0.8) buckets.molto_curvo += d;
      else if (v < 0.9) buckets.curvo += d;
      else if (v < 0.98) buckets.mosso += d;
      else buckets.dritto += d;
    }
    const out = {};
    for (const k in buckets) out[k] = Math.round((buckets[k] / total) * 1000) / 1000;
    return out;
  }

  // ---------- link Google Maps e GPX (come export.py) ----------
  const fmt = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  function googleMapsUrl(start, end, waypoints) {
    let url = "https://www.google.com/maps/dir/?api=1" +
      `&origin=${encodeURIComponent(fmt(start))}` +
      `&destination=${encodeURIComponent(fmt(end))}` +
      "&travelmode=driving";
    if (waypoints.length) url += "&waypoints=" + encodeURIComponent(waypoints.map(fmt).join("|"));
    return url;
  }
  function gpx(points, name, waypoints) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Biker-Map" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>${esc(name)}</name><time>${now}</time></metadata>`,
    ];
    waypoints.forEach((w, i) => lines.push(`  <wpt lat="${w[0].toFixed(6)}" lon="${w[1].toFixed(6)}"><name>Tappa ${i + 1}</name></wpt>`));
    lines.push(`  <trk><name>${esc(name)}</name><trkseg>`);
    points.forEach((p) => lines.push(`    <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`));
    lines.push("  </trkseg></trk>", "</gpx>");
    return lines.join("\n");
  }

  // ---------- scelta delle tappe (come waypoints.py) ----------
  function longestOffRun(on, locked) {
    let bestLen = 0, bestMid = null;
    let i = 0;
    while (i < on.length) {
      if (on[i]) { i++; continue; }
      let j = i;
      while (j < on.length && !on[j]) j++;
      const mid = Math.floor((i + j - 1) / 2);
      if (j - i > bestLen && !locked.has(mid)) { bestLen = j - i; bestMid = mid; }
      i = j;
    }
    return bestMid;
  }

  async function chooseWaypoints(moto, carRouter, maxWaypoints, fixed) {
    const samples = resample(moto, SAMPLE_STEP_M);
    const motoIndex = makeIndex(moto);
    const start = moto[0], end = moto[moto.length - 1];

    const chosen = new Set();
    for (const p of fixed) chosen.add(nearestIndex(samples, p));
    chosen.delete(0);
    chosen.delete(samples.length - 1);
    const locked = new Set(chosen);

    async function evaluate(idx) {
      const pts = [start, ...[...idx].sort((a, b) => a - b).map((i) => samples[i]), end];
      const car = await carRouter(pts);
      const carIndex = makeIndex(car, motoIndex.refLat);
      const onMoto = samples.map((s) => carIndex.distance(s) <= TOLERANCE_M);
      const carSamples = resample(car, SAMPLE_STEP_M);
      const onCar = carSamples.map((s) => motoIndex.distance(s) <= TOLERANCE_M);
      const f = Math.min(
        onMoto.filter(Boolean).length / onMoto.length,
        onCar.filter(Boolean).length / onCar.length
      );
      return { car, f, on: onMoto };
    }

    let cur = await evaluate(chosen);
    let iterations = 1;
    while (cur.f < TARGET_FIDELITY && chosen.size < maxWaypoints) {
      const cand = longestOffRun(cur.on, locked);
      if (cand === null || cand === 0 || cand === samples.length - 1) break;
      const trial = new Set([...chosen, cand]);
      const t = await evaluate(trial);
      iterations++;
      chosen.add(cand);
      cur = t;
    }

    // Pulizia: togliamo le tappe diventate inutili
    for (const i of [...chosen].filter((x) => !locked.has(x)).sort((a, b) => a - b)) {
      const trial = new Set(chosen);
      trial.delete(i);
      const t = await evaluate(trial);
      iterations++;
      if (t.f >= cur.f - 0.003) {
        chosen.delete(i);
        cur = t;
      }
    }

    const wps = [...chosen].sort((a, b) => a - b).map((i) => samples[i]);
    return { waypoints: wps, simulated: cur.car, fidelity: cur.f, iterations };
  }

  // ---------- API pubblica: stessa forma della risposta di /api/route ----------
  async function route(req) {
    const avoidHw = !!req.google_avoid_highways;
    const motoHighways = req.style === "moto" ? 0.3 : 0.1;

    // Le tappe scelte dall'utente (anche i passi) sono obbligatorie, anche per il link di Google Maps
    const moto = await valhallaRoute([req.start, ...req.via, req.end], "motorcycle", motoHighways);
    const fastest = await valhallaRoute([req.start, req.end], "auto", avoidHw ? 0 : 1);

    const wp = await chooseWaypoints(
      moto.points,
      async (pts) => (await valhallaRoute(pts, "auto", avoidHw ? 0 : 1)).points,
      Math.min(req.max_waypoints, 9),
      req.via
    );

    const start = moto.points[0], end = moto.points[moto.points.length - 1];
    const curv = curvature(moto.points);
    return {
      route: {
        points: moto.points,
        distance_m: moto.distance_m,
        time_s: moto.time_s,
        curvature: curv,
        curvy_share: curvyShare(moto.points, curv),
      },
      fastest: { distance_m: fastest.distance_m, time_s: fastest.time_s },
      google: {
        url: googleMapsUrl(req.start, req.end, wp.waypoints),
        waypoints: wp.waypoints,
        simulated: wp.simulated,
        fidelity: Math.round(wp.fidelity * 1000) / 1000,
        iterations: wp.iterations,
      },
      gpx: gpx(moto.points, "Biker-Map", wp.waypoints),
      snapped: { start, end },
    };
  }

  const api = { route };
  if (typeof window !== "undefined") window.BikeMapEngine = api;
  if (typeof module !== "undefined") module.exports = api;
})();
