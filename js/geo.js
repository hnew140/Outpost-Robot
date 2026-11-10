/* Fonctions géographiques pures (aucune dépendance au DOM de la page,
 * sauf DOMParser pour lire les fichiers XML). Points = [lat, lon, ele|null]. */
(function (root) {
  'use strict';

  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  function dist(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
      Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  function cardinal(b) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return dirs[Math.round(b / 45) % 8];
  }

  /* Statistiques : distances cumulées, dénivelés (avec hystérésis de 3 m
   * pour ne pas compter le bruit des altitudes). */
  function stats(points) {
    const n = points.length;
    const cum = new Float64Array(n);
    const gainCum = new Float64Array(n);
    let gain = 0, loss = 0, ref = null, minEle = Infinity, maxEle = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i > 0) cum[i] = cum[i - 1] + dist(points[i - 1], points[i]);
      const e = points[i][2];
      if (e != null && isFinite(e)) {
        if (e < minEle) minEle = e;
        if (e > maxEle) maxEle = e;
        if (ref == null) ref = e;
        else {
          const d = e - ref;
          if (d >= 3) { gain += d; ref = e; } else if (d <= -3) { loss -= d; ref = e; }
        }
      }
      gainCum[i] = gain;
    }
    const hasEle = minEle !== Infinity;
    return {
      cum, gainCum,
      distance: n ? cum[n - 1] : 0,
      gain, loss,
      minEle: hasEle ? minEle : null,
      maxEle: hasEle ? maxEle : null,
      hasEle,
    };
  }

  /* Durée estimée (méthode DIN 33466 : 4 km/h, 300 m/h en montée, 500 m/h en descente). */
  function duration(distanceM, gainM, lossM) {
    const h = distanceM / 4000;
    const v = gainM / 300 + lossM / 500;
    return Math.max(h, v) + Math.min(h, v) / 2; // heures
  }

  /* Point de l'itinéraire le plus proche d'une position. */
  function nearest(pos, pts, cum) {
    const kx = Math.cos(rad(pos[0])) * R * Math.PI / 180;
    const ky = R * Math.PI / 180;
    if (pts.length === 1) {
      return { d: dist(pos, pts[0]), i: 0, t: 0, along: 0, lat: pts[0][0], lon: pts[0][1] };
    }
    let best = { d: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = (pts[i][1] - pos[1]) * kx, ay = (pts[i][0] - pos[0]) * ky;
      const bx = (pts[i + 1][1] - pos[1]) * kx, by = (pts[i + 1][0] - pos[0]) * ky;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best.d) {
        best = { d, i, t, along: cum[i] + t * (cum[i + 1] - cum[i]), lat: pos[0] + py / ky, lon: pos[1] + px / kx };
      }
    }
    return best;
  }

  /* Interpolation d'un point à une distance donnée le long de l'itinéraire. */
  function pointAt(pts, cum, d) {
    const n = pts.length;
    if (!n) return null;
    if (d <= 0) return { lat: pts[0][0], lon: pts[0][1], ele: pts[0][2], i: 0 };
    if (d >= cum[n - 1]) return { lat: pts[n - 1][0], lon: pts[n - 1][1], ele: pts[n - 1][2], i: n - 1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo];
    const t = seg ? (d - cum[lo]) / seg : 0;
    const a = pts[lo], b = pts[hi];
    const ele = a[2] != null && b[2] != null ? a[2] + t * (b[2] - a[2]) : (a[2] ?? b[2]);
    return { lat: a[0] + t * (b[0] - a[0]), lon: a[1] + t * (b[1] - a[1]), ele, i: lo };
  }

  /* ---------- Import / export de fichiers ---------- */

  const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : null; };
  const validPt = (p) => p[0] != null && p[1] != null && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

  function byTag(el, tag) { return Array.from(el.getElementsByTagNameNS('*', tag)); }
  function childText(el, tag) {
    for (const c of el.children) if (c.localName === tag) return c.textContent.trim();
    return '';
  }

  function parseXML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier illisible (XML invalide)');
    return doc;
  }

  function parseGPX(text, fallbackName) {
    const doc = parseXML(text);
    const pt = (n) => [num(n.getAttribute('lat')), num(n.getAttribute('lon')), (() => {
      const e = byTag(n, 'ele')[0]; return e ? num(e.textContent) : null;
    })()];
    const meta = byTag(doc, 'metadata')[0];
    const docName = (meta && childText(meta, 'name')) || fallbackName;
    const waypoints = byTag(doc, 'wpt').map((w) => ({
      lat: num(w.getAttribute('lat')), lon: num(w.getAttribute('lon')), name: childText(w, 'name'),
    })).filter((w) => w.lat != null && w.lon != null);

    const routes = [];
    byTag(doc, 'trk').forEach((trk, k) => {
      const points = byTag(trk, 'trkpt').map(pt).filter(validPt);
      if (points.length) routes.push({ name: childText(trk, 'name') || docName + (k ? ' ' + (k + 1) : ''), points });
    });
    byTag(doc, 'rte').forEach((rte, k) => {
      const points = byTag(rte, 'rtept').map(pt).filter(validPt);
      if (points.length) routes.push({ name: childText(rte, 'name') || docName + ' (route ' + (k + 1) + ')', points });
    });
    if (!routes.length && waypoints.length >= 2) {
      routes.push({ name: docName, points: waypoints.map((w) => [w.lat, w.lon, null]) });
    }
    if (routes.length) routes[0].waypoints = waypoints;
    return routes;
  }

  function parseKML(text, fallbackName) {
    const doc = parseXML(text);
    const routes = [];
    const waypoints = [];
    byTag(doc, 'Placemark').forEach((pm) => {
      const name = childText(pm, 'name');
      byTag(pm, 'LineString').forEach((ls) => {
        const c = byTag(ls, 'coordinates')[0];
        if (!c) return;
        const points = c.textContent.trim().split(/\s+/).map((s) => {
          const [lon, lat, ele] = s.split(',').map(num);
          return [lat, lon, ele ?? null];
        }).filter(validPt);
        if (points.length) routes.push({ name: name || fallbackName, points });
      });
      // gx:Track (Google)
      const coords = byTag(pm, 'coord');
      if (coords.length) {
        const points = coords.map((c) => {
          const [lon, lat, ele] = c.textContent.trim().split(/\s+/).map(num);
          return [lat, lon, ele ?? null];
        }).filter(validPt);
        if (points.length) routes.push({ name: name || fallbackName, points });
      }
      byTag(pm, 'Point').forEach((p) => {
        const c = byTag(p, 'coordinates')[0];
        if (!c) return;
        const [lon, lat] = c.textContent.trim().split(',').map(num);
        if (lat != null && lon != null) waypoints.push({ lat, lon, name });
      });
    });
    if (routes.length) routes[0].waypoints = waypoints;
    return routes;
  }

  function parseGeoJSON(text, fallbackName) {
    const gj = JSON.parse(text);
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj, properties: {} }];
    const routes = [];
    const waypoints = [];
    const conv = (c) => [c[1], c[0], c[2] ?? null];
    feats.forEach((f) => {
      const g = f.geometry; if (!g) return;
      const name = (f.properties && f.properties.name) || fallbackName;
      if (g.type === 'LineString') routes.push({ name, points: g.coordinates.map(conv).filter(validPt) });
      else if (g.type === 'MultiLineString') routes.push({ name, points: g.coordinates.flat().map(conv).filter(validPt) });
      else if (g.type === 'Point') waypoints.push({ lat: g.coordinates[1], lon: g.coordinates[0], name: (f.properties && f.properties.name) || '' });
    });
    const out = routes.filter((r) => r.points.length);
    if (out.length) out[0].waypoints = waypoints;
    return out;
  }

  function parseFile(text, filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const t = text.trimStart();
    if (ext === 'kml' || /<kml[\s>]/i.test(t.slice(0, 500))) return parseKML(text, base);
    if (ext === 'geojson' || ext === 'json' || t[0] === '{') return parseGeoJSON(text, base);
    return parseGPX(text, base);
  }

  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

  function toGPX(route) {
    const wpts = (route.waypoints || []).map((w) =>
      `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${esc(w.name || '')}</name></wpt>`).join('\n');
    const pts = route.points.map((p) =>
      `      <trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">${p[2] != null ? `<ele>${(+p[2]).toFixed(1)}</ele>` : ''}${p[3] ? `<time>${new Date(p[3]).toISOString()}</time>` : ''}</trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Balise" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(route.name)}</name></metadata>
${wpts}
  <trk>
    <name>${esc(route.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  }

  /* ---------- Tuiles ---------- */

  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => {
    const r = rad(Math.max(-85.0511, Math.min(85.0511, lat)));
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };

  /* Liste des tuiles couvrant un couloir de `bufferM` mètres autour du tracé,
   * des zooms minZ à maxZ. Aux petits zooms on prend toute l'emprise. */
  function corridorTiles(points, bufferM, minZ, maxZ, bboxOnly) {
    const seen = new Set();
    const out = [];
    const add = (z, x, y) => {
      const max = 2 ** z;
      if (x < 0 || y < 0 || x >= max || y >= max) return;
      const k = z + '/' + x + '/' + y;
      if (!seen.has(k)) { seen.add(k); out.push([z, x, y]); }
    };
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of points) {
      if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0];
      if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1];
    }
    const latc = (s + n) / 2;
    const dLat = bufferM / 111320;
    const dLon = bufferM / (111320 * Math.cos(rad(latc)));
    for (let z = minZ; z <= maxZ; z++) {
      const tileM = (40075016.686 * Math.cos(rad(latc))) / 2 ** z;
      if (bboxOnly || z <= 12 || points.length < 2) {
        const x0 = lon2x(w - dLon, z), x1 = lon2x(e + dLon, z);
        const y0 = lat2y(n + dLat, z), y1 = lat2y(s - dLat, z);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(z, x, y);
        continue;
      }
      const r = Math.ceil(bufferM / tileM);
      const step = tileM / 3;
      const visit = (lat, lon) => {
        const tx = lon2x(lon, z), ty = lat2y(lat, z);
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            if (dx * dx + dy * dy <= (r + 0.5) ** 2) add(z, tx + dx, ty + dy);
      };
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const k = Math.max(1, Math.ceil(dist(a, b) / step));
        for (let j = 0; j < k; j++) visit(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k);
      }
      const last = points[points.length - 1];
      visit(last[0], last[1]);
    }
    return out;
  }

  function tileUrl(template, z, x, y) {
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  /* Coordonnées lisibles (degrés décimaux + degrés/minutes/secondes). */
  function formatCoords(lat, lon) {
    const dms = (v, pos, neg) => {
      const h = v >= 0 ? pos : neg; v = Math.abs(v);
      const t = Math.round(v * 36000); // dixièmes de seconde
      const d = Math.floor(t / 36000), m = Math.floor((t % 36000) / 600), s = ((t % 600) / 10).toFixed(1);
      return `${d}°${String(m).padStart(2, '0')}'${s.padStart(4, '0')}"${h}`;
    };
    return {
      dec: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      dms: `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'O')}`,
    };
  }

  const Geo = { dist, bearing, cardinal, stats, duration, nearest, pointAt, parseFile, toGPX, corridorTiles, tileUrl, formatCoords, lon2x, lat2y };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
  else root.Geo = Geo;
})(typeof self !== 'undefined' ? self : this);
