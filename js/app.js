/* Balise — application de randonnée hors-ligne, usage personnel. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const TILE_CACHE = 'balise-tiles-v1';

  /* ================= Utilitaires ================= */

  const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + ' km' : Math.round(m) + ' m');
  const fmtM = (m) => (m == null ? '–' : Math.round(m) + ' m');
  const fmtH = (h) => { const t = Math.round(h * 60); return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0'); };
  const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  /* ================= Base de données locale (IndexedDB) ================= */

  const DB = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('balise', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('routes', { keyPath: 'id' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (store, mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      routes: () => run('routes', 'readonly', (s) => s.getAll()),
      put: (r) => run('routes', 'readwrite', (s) => s.put(r)),
      del: (id) => run('routes', 'readwrite', (s) => s.delete(id)),
      get: (k) => run('kv', 'readonly', (s) => s.get(k)),
      set: (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)),
      unset: (k) => run('kv', 'readwrite', (s) => s.delete(k)),
    };
  })();

  /* ================= Carte ================= */

  const IGN = (layer, fmt) =>
    `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

  const LAYERS = {
    topo: {
      name: 'OpenTopoMap (monde, courbes de niveau)',
      url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      native: 16, maxDl: 4000, kb: 30,
      attr: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), © contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    ignplan: {
      name: 'IGN Plan (France)',
      url: IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'),
      native: 16, maxDl: 15000, kb: 25,
      attr: '© <a href="https://www.ign.fr">IGN</a> – Géoplateforme',
    },
    ignortho: {
      name: 'IGN Photos aériennes (France)',
      url: IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'),
      native: 17, maxDl: 15000, kb: 45,
      attr: '© <a href="https://www.ign.fr">IGN</a> – Géoplateforme',
    },
    osm: {
      name: 'OpenStreetMap (en ligne uniquement)',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      native: 19, maxDl: 0, kb: 20,
      attr: '© contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  };

  const view = lsGet('view', { c: [45.83, 6.86], z: 11 });
  const map = L.map('map', { zoomControl: false, preferCanvas: true, maxZoom: 19, attributionControl: true })
    .setView(view.c, view.z);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.on('moveend', () => { const c = map.getCenter(); lsSet('view', { c: [c.lat, c.lng], z: map.getZoom() }); });

  let baseLayer = null;
  let baseKey = lsGet('layer', 'topo');
  if (!LAYERS[baseKey]) baseKey = 'topo';
  function setBase(key) {
    if (baseLayer) map.removeLayer(baseLayer);
    const l = LAYERS[key];
    baseLayer = L.tileLayer(l.url, { maxNativeZoom: l.native, maxZoom: 19, attribution: l.attr }).addTo(map);
    baseKey = key; lsSet('layer', key);
    renderLayerMenu();
  }

  function renderLayerMenu() {
    $('#layer-menu').innerHTML = Object.entries(LAYERS).map(([k, l]) =>
      `<button data-layer="${k}" class="${k === baseKey ? 'active' : ''}">${esc(l.name)}</button>`).join('');
  }
  $('#btn-layers').onclick = () => { $('#layer-menu').hidden = !$('#layer-menu').hidden; };
  $('#layer-menu').onclick = (e) => {
    const k = e.target.dataset.layer; if (!k) return;
    setBase(k); $('#layer-menu').hidden = true;
  };
  map.on('click', () => { $('#layer-menu').hidden = true; $('#search-results').hidden = true; });
  setBase(baseKey);

  /* ================= Interface : onglets et panneau ================= */

  let currentTab = 'map';
  function showPane(name) {
    document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    $('#sheet').hidden = !name;
    $('#sheet').classList.remove('min');
  }
  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'map') showPane(null);
    else if (tab === 'routes') { showPane('routes'); renderRoutes(); }
    else showPane(tab);
    Draw.setActive(tab === 'draw');
    if (tab === 'record') Rec.render();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
  $('#sheet-handle').onclick = () => $('#sheet').classList.toggle('min');

  /* ================= Recherche de lieux ================= */

  $('#search').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (!q) return;
    $('#search-input').blur();
    const m = q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1].replace(',', '.')), lon = parseFloat(m[2].replace(',', '.'));
      map.setView([lat, lon], 15);
      L.popup().setLatLng([lat, lon]).setContent(q).openOn(map);
      return;
    }
    const ul = $('#search-results');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=fr&q=' + encodeURIComponent(q));
      const res = await r.json();
      ul.innerHTML = res.length ? res.map((p, i) => `<li data-i="${i}">${esc(p.display_name)}</li>`).join('') : '<li>Aucun résultat</li>';
      ul.hidden = false;
      ul.onclick = (ev) => {
        const p = res[ev.target.dataset.i]; if (!p) return;
        ul.hidden = true;
        if (p.boundingbox) map.fitBounds([[+p.boundingbox[0], +p.boundingbox[2]], [+p.boundingbox[1], +p.boundingbox[3]]], { maxZoom: 15 });
        else map.setView([+p.lat, +p.lon], 14);
      };
    } catch (err) {
      toast('Recherche impossible sans réseau. Tu peux taper des coordonnées : 45.92, 6.87');
    }
  };

  /* ================= GPS ================= */

  const GPS = {
    watchId: null, last: null, subs: new Set(), follow: false, users: new Set(),
    marker: null, accCircle: null,
    acquire(who) {
      this.users.add(who);
      if (this.watchId != null) return;
      if (!('geolocation' in navigator)) { toast('GPS non disponible sur cet appareil'); return; }
      this.watchId = navigator.geolocation.watchPosition(
        (p) => this.update(p),
        (err) => {
          if (err.code === 1) toast('Autorise la localisation pour cette application (réglages du navigateur).', 6000);
          else toast('Signal GPS faible…');
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    },
    release(who) {
      this.users.delete(who);
      if (!this.users.size && this.watchId != null) {
        navigator.geolocation.clearWatch(this.watchId); this.watchId = null;
      }
    },
    update(p) {
      const c = p.coords;
      this.last = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, ele: c.altitude, heading: c.heading, speed: c.speed, time: p.timestamp };
      const ll = [c.latitude, c.longitude];
      if (!this.marker) {
        this.accCircle = L.circle(ll, { radius: c.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
        this.marker = L.marker(ll, {
          icon: L.divIcon({ className: 'me', html: '<div class="me-arrow"></div><div class="me-dot"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
          interactive: false, zIndexOffset: 1000,
        }).addTo(map);
      } else {
        this.marker.setLatLng(ll);
        this.accCircle.setLatLng(ll).setRadius(c.accuracy);
      }
      const el = this.marker.getElement();
      if (el) {
        const arrow = el.querySelector('.me-arrow');
        const moving = c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.4;
        arrow.style.display = moving ? 'block' : 'none';
        if (moving) arrow.style.transform = `rotate(${c.heading}deg)`;
      }
      if (this.follow) map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
      this.subs.forEach((f) => f(this.last));
    },
  };

  function setFollow(on) {
    GPS.follow = on;
    $('#btn-locate').classList.toggle('active', on);
    if (on) {
      GPS.acquire('locate');
      if (GPS.last) map.setView([GPS.last.lat, GPS.last.lon], Math.max(map.getZoom(), 15));
      else toast('Recherche de la position GPS…');
    }
  }
  $('#btn-locate').onclick = () => setFollow(!GPS.follow);
  map.on('dragstart', () => { if (GPS.follow) setFollow(false); });

  /* Écran toujours allumé pendant navigation / enregistrement */
  const Wake = {
    lock: null, wanted: 0,
    async on() { this.wanted++; await this.get(); },
    off() { this.wanted = Math.max(0, this.wanted - 1); if (!this.wanted && this.lock) { this.lock.release(); this.lock = null; } },
    async get() {
      if (!this.wanted || this.lock || !('wakeLock' in navigator)) return;
      try { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } catch (e) { /* refusé */ }
    },
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Wake.get(); });

  /* ================= Urgence ================= */

  let sosSub = null;
  function sosText() {
    const g = GPS.last;
    if (!g) return null;
    const f = Geo.formatCoords(g.lat, g.lon);
    return `Position GPS : ${f.dec}\n${f.dms}\nPrécision : ±${Math.round(g.acc)} m` +
      (g.ele != null ? `\nAltitude : ${Math.round(g.ele)} m` : '') +
      `\nHeure : ${new Date(g.time).toLocaleTimeString('fr-FR')}\nhttps://www.openstreetmap.org/?mlat=${g.lat.toFixed(5)}&mlon=${g.lon.toFixed(5)}#map=16/${g.lat.toFixed(5)}/${g.lon.toFixed(5)}`;
  }
  $('#btn-sos').onclick = () => {
    GPS.acquire('sos');
    const upd = () => { $('#sos-coords').textContent = sosText() || 'Recherche du GPS… (sors à découvert si possible)'; };
    sosSub = upd; GPS.subs.add(upd); upd();
    $('#sos').showModal();
  };
  $('#sos').addEventListener('close', () => { GPS.subs.delete(sosSub); GPS.release('sos'); });
  $('#sos-copy').onclick = async () => {
    const t = sosText(); if (!t) return;
    try { await navigator.clipboard.writeText(t); toast('Coordonnées copiées'); } catch (e) { toast('Copie impossible'); }
  };
  $('#sos-sms').onclick = () => {
    const t = sosText(); if (!t) return;
    location.href = 'sms:?&body=' + encodeURIComponent('Besoin d\'aide. ' + t);
  };

  /* ================= Itinéraires ================= */

  let routes = [];
  const routeLayers = new Map(); // id -> layer group
  let selected = null; // route sélectionnée
  let selectedStats = null;

  function summarize(points) {
    const s = Geo.stats(points);
    return { distance: s.distance, gain: s.gain, loss: s.loss, minEle: s.minEle, maxEle: s.maxEle, hours: Geo.duration(s.distance, s.gain, s.loss) };
  }

  async function loadRoutes() {
    routes = (await DB.routes()).sort((a, b) => b.created - a.created);
    drawAllRoutes();
  }

  function routeLayer(r, highlight) {
    const g = L.layerGroup();
    const ll = r.points.map((p) => [p[0], p[1]]);
    if (highlight) L.polyline(ll, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(g);
    L.polyline(ll, { color: highlight ? '#e8590c' : '#c2255c', weight: highlight ? 5 : 4, opacity: highlight ? 1 : 0.75 })
      .on('click', (e) => { L.DomEvent.stop(e); if (Draw.active) Draw.add(e.latlng.lat, e.latlng.lng); else openDetail(r.id); }).addTo(g);
    if (highlight || ll.length) {
      L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#2b8a3e', fillOpacity: 1 }).bindTooltip('Départ').addTo(g);
      if (ll.length > 1) L.circleMarker(ll[ll.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c92a2a', fillOpacity: 1 }).bindTooltip('Arrivée').addTo(g);
    }
    (r.waypoints || []).forEach((w) => {
      L.circleMarker([w.lat, w.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#5f3dc4', fillOpacity: 1 }).bindTooltip(esc(w.name || 'Point')).addTo(g);
    });
    return g;
  }

  function drawAllRoutes() {
    routeLayers.forEach((l) => map.removeLayer(l));
    routeLayers.clear();
    routes.forEach((r) => {
      const l = routeLayer(r, selected && selected.id === r.id).addTo(map);
      routeLayers.set(r.id, l);
    });
  }

  function renderRoutes() {
    const ul = $('#route-list');
    $('#route-empty').hidden = routes.length > 0;
    ul.innerHTML = routes.map((r) => `
      <li data-id="${r.id}">
        <b>${esc(r.name)}</b>
        <span class="muted small">${fmtKm(r.summary.distance)} · D+ ${fmtM(r.summary.gain)} · ${fmtH(r.summary.hours)}
          ${r.offline ? ' · <span class="ok">✓ hors-ligne</span>' : ''}</span>
      </li>`).join('');
    updateStorageInfo();
  }
  $('#route-list').onclick = (e) => { const li = e.target.closest('li'); if (li) openDetail(li.dataset.id); };

  async function saveNewRoute(name, points, waypoints, extra) {
    const r = { id: uid(), name, points, waypoints: waypoints || [], created: Date.now(), summary: summarize(points), ...extra };
    await DB.put(r);
    routes.unshift(r);
    drawAllRoutes();
    return r;
  }

  $('#file-import').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    let count = 0, last = null;
    for (const f of files) {
      try {
        const parsed = Geo.parseFile(await f.text(), f.name);
        if (!parsed.length) { toast(`${f.name} : aucun tracé trouvé`); continue; }
        for (const p of parsed) { last = await saveNewRoute(p.name, p.points, p.waypoints); count++; }
      } catch (err) {
        toast(`${f.name} : ${err.message}`, 5000);
      }
    }
    if (count) { toast(`${count} itinéraire(s) importé(s)`); renderRoutes(); if (last) openDetail(last.id); }
  };

  function openDetail(id) {
    const r = routes.find((x) => x.id === id); if (!r) return;
    selected = r;
    selectedStats = Geo.stats(r.points);
    drawAllRoutes();
    if (currentTab !== 'routes') {
      currentTab = 'routes';
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'routes'));
      Draw.setActive(false);
    }
    showPane('detail');
    $('#detail-name').textContent = r.name;
    const s = r.summary;
    $('#detail-stats').innerHTML = statsHTML([
      ['Distance', fmtKm(s.distance)], ['D+', fmtM(s.gain)], ['D−', fmtM(s.loss)],
      ['Durée est.', fmtH(s.hours)], ['Alt. min', fmtM(s.minEle)], ['Alt. max', fmtM(s.maxEle)],
    ]);
    $('#detail-offline').innerHTML = r.offline
      ? `<span class="ok">✓ Carte téléchargée</span> (${esc(LAYERS[r.offline.layer] ? LAYERS[r.offline.layer].name : r.offline.layer)}, marge ${r.offline.buffer} m, ${r.offline.count} tuiles, le ${new Date(r.offline.date).toLocaleDateString('fr-FR')})`
      : '<span class="warn">Carte pas encore téléchargée : sans réseau, le fond de carte sera vide.</span>';
    fillLayerSelect();
    updateEstimate();
    requestAnimationFrame(() => Profile.draw($('#detail-profile'), r.points, selectedStats, null));
    map.fitBounds(L.latLngBounds(r.points.map((p) => [p[0], p[1]])), { paddingTopLeft: [20, 80], paddingBottomRight: [20, Math.min(window.innerHeight * 0.55, 420)], maxZoom: 16 });
  }

  function statsHTML(items) {
    return items.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  }

  $('#detail-back').onclick = () => { selected = null; profileMarker.remove(); drawAllRoutes(); showPane('routes'); renderRoutes(); };
  $('#detail-rename').onclick = async () => {
    const n = prompt('Nouveau nom', selected.name);
    if (!n) return;
    selected.name = n.trim(); await DB.put(selected);
    $('#detail-name').textContent = selected.name;
  };
  $('#detail-delete').onclick = async () => {
    if (!confirm(`Supprimer « ${selected.name} » ?`)) return;
    await DB.del(selected.id);
    routes = routes.filter((r) => r.id !== selected.id);
    selected = null; profileMarker.remove();
    drawAllRoutes(); showPane('routes'); renderRoutes();
  };
  $('#detail-export').onclick = () => {
    const blob = new Blob([Geo.toGPX(selected)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = selected.name.replace(/[^\w\- àâäéèêëîïôöùûüç]+/gi, '_') + '.gpx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  /* ================= Profil altimétrique ================= */

  const profileMarker = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: '#1971c2', fillOpacity: 1, interactive: false });

  const Profile = {
    draw(canvas, pts, st, markerDist) {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight || canvas.height;
      if (!w) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      if (!st.hasEle || st.distance === 0) {
        ctx.fillStyle = css.getPropertyValue('--muted');
        ctx.font = '13px system-ui';
        ctx.fillText('Pas de données d\'altitude dans ce tracé', 8, h / 2);
        canvas._geom = null;
        return;
      }
      const padL = 34, padB = 14, padT = 6;
      let lo = st.minEle, hi = st.maxEle;
      if (hi - lo < 50) { const m = (hi + lo) / 2; lo = m - 25; hi = m + 25; }
      const X = (d) => padL + (d / st.distance) * (w - padL - 4);
      const Y = (e) => padT + (1 - (e - lo) / (hi - lo)) * (h - padT - padB);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const e = pts[i][2]; if (e == null) continue;
        const x = X(st.cum[i]), y = Y(e);
        if (!started) { ctx.moveTo(x, h - padB); ctx.lineTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.lineTo(X(st.distance), h - padB); ctx.closePath();
      ctx.fillStyle = 'rgba(232,89,12,.22)'; ctx.fill();
      ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); started = false;
      for (let i = 0; i < pts.length; i++) {
        const e = pts[i][2]; if (e == null) continue;
        if (!started) { ctx.moveTo(X(st.cum[i]), Y(e)); started = true; } else ctx.lineTo(X(st.cum[i]), Y(e));
      }
      ctx.stroke();
      ctx.fillStyle = css.getPropertyValue('--muted'); ctx.font = '10px system-ui';
      ctx.fillText(Math.round(hi) + ' m', 0, padT + 8);
      ctx.fillText(Math.round(lo) + ' m', 0, h - padB);
      ctx.fillText('0', padL, h - 2);
      const end = fmtKm(st.distance);
      ctx.fillText(end, w - ctx.measureText(end).width - 2, h - 2);
      if (markerDist != null) {
        const x = X(Math.max(0, Math.min(st.distance, markerDist)));
        ctx.strokeStyle = '#1971c2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
      }
      canvas._geom = { padL, w, total: st.distance };
    },
    distAt(canvas, clientX) {
      const g = canvas._geom; if (!g) return null;
      const x = clientX - canvas.getBoundingClientRect().left;
      return Math.max(0, Math.min(1, (x - g.padL) / (g.w - g.padL - 4))) * g.total;
    },
  };

  function profileInteract(e) {
    if (!selected) return;
    const cv = $('#detail-profile');
    const t = e.touches ? e.touches[0] : e;
    const d = Profile.distAt(cv, t.clientX); if (d == null) return;
    const p = Geo.pointAt(selected.points, selectedStats.cum, d);
    Profile.draw(cv, selected.points, selectedStats, d);
    profileMarker.setLatLng([p.lat, p.lon]).addTo(map);
    $('#profile-readout').textContent = `à ${fmtKm(d)} · altitude ${fmtM(p.ele)} · D+ cumulé ${fmtM(selectedStats.gainCum[p.i])}`;
  }
  $('#detail-profile').addEventListener('pointerdown', profileInteract);
  $('#detail-profile').addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') profileInteract(e); });
  window.addEventListener('resize', () => {
    if (selected && !$('#detail-profile').closest('.pane').hidden) Profile.draw($('#detail-profile'), selected.points, selectedStats, null);
  });

  /* ================= Téléchargement des cartes hors-ligne ================= */

  function fillLayerSelect() {
    const sel = $('#dl-layer');
    sel.innerHTML = Object.entries(LAYERS).filter(([, l]) => l.maxDl > 0)
      .map(([k, l]) => `<option value="${k}">${esc(l.name)}</option>`).join('');
    sel.value = LAYERS[baseKey].maxDl > 0 ? baseKey : 'topo';
  }

  function planTiles(points, layerKey, buffer, bboxOnly, minZ) {
    const l = LAYERS[layerKey];
    const tiles = Geo.corridorTiles(points, buffer, minZ ?? 8, l.native, bboxOnly);
    return { layer: l, tiles, urls: tiles.map(([z, x, y]) => Geo.tileUrl(l.url, z, x, y)) };
  }

  function estimateText(plan) {
    const mb = (plan.tiles.length * plan.layer.kb) / 1024;
    let t = `${plan.tiles.length} tuiles, environ ${mb < 1 ? '<1' : Math.round(mb)} Mo.`;
    if (plan.tiles.length > plan.layer.maxDl) t += ` ⚠ Trop grand pour ce fond (max ${plan.layer.maxDl}) : réduis la marge ou découpe l'itinéraire.`;
    return t;
  }

  function updateEstimate() {
    if (!selected) return;
    const plan = planTiles(selected.points, $('#dl-layer').value, +$('#dl-buffer').value);
    $('#dl-estimate').textContent = estimateText(plan);
    $('#dl-start').disabled = plan.tiles.length > plan.layer.maxDl;
  }
  $('#dl-layer').onchange = updateEstimate;
  $('#dl-buffer').onchange = updateEstimate;

  let dlAbort = null;
  async function downloadTiles(urls, progressEl) {
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { /* ignore */ } }
    const cache = await caches.open(TILE_CACHE);
    const ctrl = new AbortController(); dlAbort = ctrl;
    let i = 0, done = 0, failed = 0, quota = false;
    const bar = progressEl.firstElementChild;
    progressEl.hidden = false;
    const tick = () => { bar.style.width = ((done + failed) / urls.length) * 100 + '%'; };
    async function fetchOne(u) {
      try {
        const r = await fetch(u, { mode: 'cors', signal: ctrl.signal });
        return r.ok ? r : null;
      } catch (e) {
        if (ctrl.signal.aborted) throw e;
        // Serveur sans CORS : réponse « opaque », utilisable quand même pour l'affichage.
        return fetch(u, { mode: 'no-cors', signal: ctrl.signal });
      }
    }
    async function worker() {
      while (i < urls.length && !ctrl.signal.aborted && !quota) {
        const u = urls[i++];
        try {
          if (await cache.match(u)) { done++; tick(); continue; }
          let r = null;
          for (let attempt = 0; attempt < 3 && !r; attempt++) {
            try { r = await fetchOne(u); } catch (e) { if (ctrl.signal.aborted) return; }
          }
          if (r) { await cache.put(u, r); done++; } else failed++;
        } catch (e) {
          if (e && e.name === 'QuotaExceededError') quota = true; else failed++;
        }
        tick();
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    dlAbort = null;
    return { done, failed, aborted: ctrl.signal.aborted, quota };
  }

  async function runDownload(plan, onDone) {
    $('#dl-start').disabled = true; $('#dl-cancel').hidden = false;
    $('#btn-area').disabled = true;
    const prog = document.querySelector('.pane:not([hidden]) .progress') || $('.progress');
    const res = await downloadTiles(plan.urls, prog);
    $('#dl-start').disabled = false; $('#dl-cancel').hidden = true; $('#btn-area').disabled = false;
    setTimeout(() => { prog.hidden = true; }, 1500);
    if (res.quota) toast('Plus de place de stockage sur le téléphone !', 6000);
    else if (res.aborted) toast('Téléchargement annulé');
    else if (res.failed) toast(`Terminé, mais ${res.failed} tuiles ont échoué : relance le téléchargement pour compléter.`, 7000);
    else toast('✓ Carte disponible hors-ligne');
    if (!res.aborted && !res.quota && onDone) await onDone(res);
    updateStorageInfo();
  }

  $('#dl-start').onclick = async () => {
    if (!selected) return;
    const layerKey = $('#dl-layer').value, buffer = +$('#dl-buffer').value;
    const plan = planTiles(selected.points, layerKey, buffer);
    if (plan.tiles.length > plan.layer.maxDl) return;
    const r = selected;
    await runDownload(plan, async (res) => {
      if (res.failed > plan.tiles.length * 0.05) return;
      r.offline = { layer: layerKey, buffer, count: plan.tiles.length, date: Date.now() };
      await DB.put(r);
      if (selected === r) openDetail(r.id);
    });
  };
  $('#dl-cancel').onclick = () => { if (dlAbort) dlAbort.abort(); };

  $('#btn-area').onclick = async () => {
    const key = LAYERS[baseKey].maxDl > 0 ? baseKey : 'topo';
    const b = map.getBounds();
    const pts = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    const plan = planTiles(pts, key, 0, true, Math.max(8, Math.min(map.getZoom(), LAYERS[key].native) - 4));
    if (plan.tiles.length > LAYERS[key].maxDl) { toast(`Zone trop grande (${plan.tiles.length} tuiles). Zoome davantage.`, 5000); return; }
    if (!confirm(`Télécharger la zone affichée (${LAYERS[key].name}) ?\n${estimateText(plan)}`)) return;
    // la barre de progression du panneau "routes"
    let prog = $('[data-pane="routes"] .progress');
    if (!prog) {
      prog = document.createElement('div'); prog.className = 'progress'; prog.innerHTML = '<div></div>';
      $('#btn-area').parentElement.after(prog);
    }
    await runDownload(plan);
  };

  async function updateStorageInfo() {
    const el = $('#storage-info');
    try {
      const cache = await caches.open(TILE_CACHE);
      const n = (await cache.keys()).length;
      let t = `${n} tuiles de carte enregistrées.`;
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        t += ` Espace utilisé : ${Math.round((e.usage || 0) / 1048576)} Mo sur ${Math.round((e.quota || 0) / 1048576)} Mo disponibles.`;
      }
      if (navigator.storage && navigator.storage.persisted && !(await navigator.storage.persisted())) {
        t += ' ⚠ Le navigateur pourrait effacer ces données s\'il manque de place : installe l\'appli sur l\'écran d\'accueil pour limiter ce risque.';
      }
      el.textContent = t;
    } catch (e) { el.textContent = 'Stockage indisponible (navigation privée ?)'; }
  }
  $('#btn-clear-tiles').onclick = async () => {
    if (!confirm('Effacer toutes les cartes téléchargées ? Les itinéraires sont conservés.')) return;
    await caches.delete(TILE_CACHE);
    for (const r of routes) if (r.offline) { delete r.offline; await DB.put(r); }
    renderRoutes(); toast('Cartes effacées');
  };

  /* ================= Navigation ================= */

  const Nav = {
    route: null, st: null, sub: null, off: false, lastAlert: 0, audio: null, arrived: false,
    start(r) {
      this.stop(true);
      this.route = r; this.st = Geo.stats(r.points); this.off = false; this.arrived = false;
      try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audio = null; }
      $('#nav-hud').hidden = false;
      document.body.classList.add('navigating');
      selected = r; selectedStats = this.st; drawAllRoutes();
      setTab('map');
      this.sub = (g) => this.update(g);
      GPS.subs.add(this.sub);
      GPS.acquire('nav');
      setFollow(true);
      Wake.on();
      lsSet('nav', r.id);
      if (!r.offline && !navigator.onLine) toast('⚠ Carte non téléchargée pour cet itinéraire', 6000);
      requestAnimationFrame(() => Profile.draw($('#hud-profile'), r.points, this.st, null));
      if (GPS.last) this.update(GPS.last);
    },
    stop(silent) {
      if (!this.route) return;
      GPS.subs.delete(this.sub); GPS.release('nav'); Wake.off();
      this.route = null;
      $('#nav-hud').hidden = true; $('#offroute').hidden = true;
      document.body.classList.remove('navigating');
      lsSet('nav', null);
      if (!silent) toast('Navigation arrêtée');
    },
    beep() {
      if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      const a = this.audio; if (!a) return;
      try {
        a.resume();
        [0, 0.35].forEach((t0) => {
          const o = a.createOscillator(), g = a.createGain();
          o.frequency.value = 880; o.connect(g); g.connect(a.destination);
          g.gain.setValueAtTime(0.3, a.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t0 + 0.3);
          o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + 0.3);
        });
      } catch (e) { /* ignore */ }
    },
    update(g) {
      if (!this.route) return;
      const pts = this.route.points, st = this.st;
      const near = Geo.nearest([g.lat, g.lon], pts, st.cum);
      const remain = Math.max(0, st.distance - near.along);
      const idx = Math.min(pts.length - 1, near.i + (near.t > 0.5 ? 1 : 0));
      const gainRemain = st.gain - st.gainCum[idx];
      const lossRemain = Math.max(0, st.loss * (remain / (st.distance || 1)));
      $('#hud-remain').textContent = fmtKm(remain);
      $('#hud-gain').textContent = st.hasEle ? fmtM(gainRemain) : '–';
      const p = Geo.pointAt(pts, st.cum, near.along);
      $('#hud-ele').textContent = g.ele != null ? fmtM(g.ele) : (p && p.ele != null ? '≈' + fmtM(p.ele) : '–');
      $('#hud-time').textContent = fmtH(Geo.duration(remain, gainRemain, lossRemain));
      Profile.draw($('#hud-profile'), pts, st, near.along);

      // Hors itinéraire ? (on tient compte de la précision GPS)
      const threshold = Math.max(50, Math.min(g.acc || 0, 100));
      const isOff = near.d > threshold;
      const now = Date.now();
      if (isOff) {
        const b = Geo.bearing([g.lat, g.lon], [near.lat, near.lon]);
        $('#offroute-text').textContent = `Le sentier est à ${fmtKm(near.d)} direction ${Geo.cardinal(b)} (${Math.round(b)}°)`;
        $('#offroute').hidden = false;
        if (!this.off || now - this.lastAlert > 60000) { this.beep(); this.lastAlert = now; }
      } else {
        if (this.off) { toast('✓ De retour sur l\'itinéraire'); if (navigator.vibrate) navigator.vibrate(150); }
        $('#offroute').hidden = true;
      }
      this.off = isOff;

      if (!this.arrived && remain < 30 && !isOff && st.distance > 100) {
        this.arrived = true; toast('🏁 Arrivée ! Bravo.', 6000);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    },
  };
  $('#detail-nav').onclick = () => { if (selected) Nav.start(selected); };
  $('#nav-stop').onclick = () => Nav.stop();

  /* ================= Tracer un itinéraire ================= */

  const Draw = {
    active: false, segments: [], anchors: [], layer: L.layerGroup(), busy: false,
    setActive(on) {
      this.active = on;
      if (on) { this.layer.addTo(map); this.render(); } else if (!this.anchors.length) map.removeLayer(this.layer);
      document.body.classList.toggle('drawing', on);
    },
    points() {
      if (!this.anchors.length) return [];
      const out = [this.anchors[0]];
      this.segments.forEach((s) => { for (let i = 1; i < s.length; i++) out.push(s[i]); });
      return out;
    },
    async add(lat, lon) {
      if (this.busy) return;
      const pt = [lat, lon, null];
      if (!this.anchors.length) { this.anchors.push(pt); this.render(); return; }
      const prev = this.anchors[this.anchors.length - 1];
      let seg = [prev, pt];
      if ($('#draw-snap').checked) {
        this.busy = true; document.body.classList.add('busy');
        try { seg = await routeBetween(prev, pt); } catch (e) { toast('Pas de chemin trouvé ou pas de réseau : segment en ligne droite.'); }
        this.busy = false; document.body.classList.remove('busy');
      }
      this.anchors.push(seg[seg.length - 1]);
      this.segments.push(seg);
      this.render();
    },
    undo() { if (this.segments.length) this.segments.pop(); this.anchors.pop(); this.render(); },
    clear() { this.segments = []; this.anchors = []; this.render(); },
    render() {
      this.layer.clearLayers();
      const pts = this.points();
      if (pts.length > 1) L.polyline(pts.map((p) => [p[0], p[1]]), { color: '#1971c2', weight: 5 }).addTo(this.layer);
      this.anchors.forEach((a, i) => L.circleMarker([a[0], a[1]], { radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#1971c2', fillOpacity: 1, interactive: false }).addTo(this.layer));
      const s = summarize(pts.length ? pts : [[0, 0, null]]);
      $('#draw-stats').innerHTML = statsHTML([['Distance', fmtKm(pts.length ? s.distance : 0)], ['D+', pts.length && s.minEle != null ? fmtM(s.gain) : '–'], ['Durée est.', fmtH(pts.length ? s.hours : 0)]]);
    },
  };
  map.on('click', (e) => { if (Draw.active) Draw.add(e.latlng.lat, e.latlng.lng); });
  $('#draw-undo').onclick = () => Draw.undo();
  $('#draw-clear').onclick = () => Draw.clear();
  $('#draw-save').onclick = async () => {
    const pts = Draw.points();
    if (pts.length < 2) { toast('Ajoute au moins deux points sur la carte'); return; }
    const name = prompt('Nom de l\'itinéraire', 'Rando du ' + new Date().toLocaleDateString('fr-FR'));
    if (name == null) return;
    const r = await saveNewRoute(name.trim() || 'Itinéraire', pts, []);
    Draw.clear(); Draw.setActive(false);
    toast('Itinéraire enregistré. Pense à télécharger la carte !', 5000);
    openDetail(r.id);
  };

  /* Calcul d'itinéraire le long des sentiers (BRouter, service public gratuit basé sur OpenStreetMap). */
  async function routeBetween(a, b) {
    const url = `https://brouter.de/brouter?lonlats=${a[1].toFixed(6)},${a[0].toFixed(6)}|${b[1].toFixed(6)},${b[0].toFixed(6)}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('routage ' + r.status);
      const gj = await r.json();
      const coords = gj.features[0].geometry.coordinates;
      const pts = coords.map((c) => [c[1], c[0], c[2] != null ? c[2] : null]);
      if (pts.length < 2) throw new Error('vide');
      return pts;
    } finally { clearTimeout(timer); }
  }

  /* ================= Enregistrement de trace ================= */

  const Rec = {
    state: null, // {points, startedAt, elapsed, running, resumedAt}
    layer: null, sub: null, timer: null,
    async init() {
      this.state = await DB.get('rec') || null;
      if (this.state) {
        this.state.running = false; // après rechargement : en pause
        this.drawLine();
        toast('Un enregistrement en cours a été retrouvé (en pause). Onglet « Enregistrer ».', 6000);
      }
    },
    elapsed() { const s = this.state; if (!s) return 0; return s.elapsed + (s.running ? Date.now() - s.resumedAt : 0); },
    persist() { if (this.state) DB.set('rec', this.state).catch(() => {}); },
    start() {
      if (!this.state) this.state = { points: [], startedAt: Date.now(), elapsed: 0, running: false };
      if (this.state.running) return;
      this.state.running = true; this.state.resumedAt = Date.now();
      this.sub = (g) => this.onPos(g);
      GPS.subs.add(this.sub); GPS.acquire('rec'); Wake.on();
      this.timer = setInterval(() => this.render(), 1000);
      this.persist(); this.render();
      toast('Enregistrement démarré. Garde l\'appli ouverte.');
    },
    pause() {
      if (!this.state || !this.state.running) return;
      this.state.elapsed = this.elapsed(); this.state.running = false;
      GPS.subs.delete(this.sub); GPS.release('rec'); Wake.off();
      clearInterval(this.timer);
      this.persist(); this.render();
    },
    async stop() {
      if (!this.state) return;
      this.pause();
      const pts = this.state.points;
      if (pts.length < 2) {
        if (confirm('Trace trop courte. L\'abandonner ?')) { this.state = null; await DB.unset('rec'); this.drawLine(); this.render(); }
        return;
      }
      const name = prompt('Nom de la trace', 'Trace du ' + new Date(this.state.startedAt).toLocaleDateString('fr-FR'));
      if (name == null) return;
      const r = await saveNewRoute(name.trim() || 'Trace', pts, [], { recorded: true, movingTime: this.state.elapsed });
      this.state = null; await DB.unset('rec'); this.drawLine(); this.render();
      openDetail(r.id);
    },
    onPos(g) {
      if (!this.state || !this.state.running) return;
      if (g.acc > 40) return; // point trop imprécis
      const pts = this.state.points;
      const p = [g.lat, g.lon, g.ele != null ? Math.round(g.ele * 10) / 10 : null, g.time];
      const last = pts[pts.length - 1];
      if (last && Geo.dist(last, p) < Math.max(5, g.acc / 2)) return;
      pts.push(p);
      this.drawLine();
      if (pts.length % 5 === 0 || pts.length < 5) this.persist();
    },
    drawLine() {
      const pts = this.state ? this.state.points : [];
      if (!this.layer) this.layer = L.polyline([], { color: '#1971c2', weight: 4, dashArray: '6 6', interactive: false }).addTo(map);
      this.layer.setLatLngs(pts.map((p) => [p[0], p[1]]));
    },
    render() {
      const s = this.state;
      const pts = s ? s.points : [];
      const sm = pts.length > 1 ? summarize(pts) : { distance: 0, gain: 0 };
      $('#rec-stats').innerHTML = statsHTML([['Durée', fmtDur(this.elapsed())], ['Distance', fmtKm(sm.distance)], ['D+', fmtM(sm.gain)], ['Points', pts.length]]);
      const running = !!(s && s.running);
      $('#rec-start').hidden = running;
      $('#rec-start').textContent = s ? '▶ Reprendre' : '● Démarrer';
      $('#rec-pause').hidden = !running;
      $('#rec-stop').hidden = !s;
      $('#tabs [data-tab="record"]').classList.toggle('rec-on', running);
    },
  };
  $('#rec-start').onclick = () => Rec.start();
  $('#rec-pause').onclick = () => Rec.pause();
  $('#rec-stop').onclick = () => Rec.stop();
  window.addEventListener('pagehide', () => Rec.persist());

  /* ================= Installation (PWA) ================= */

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btn-install').hidden = true; };

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }

  window.addEventListener('offline', () => toast('Hors réseau : seules les cartes téléchargées s\'affichent.'));

  /* ================= Démarrage ================= */

  (async () => {
    try {
      await loadRoutes();
      await Rec.init();
      Rec.render();
      const navId = lsGet('nav', null);
      if (navId) {
        const r = routes.find((x) => x.id === navId);
        if (r && confirm(`Reprendre la navigation sur « ${r.name} » ?`)) Nav.start(r);
        else lsSet('nav', null);
      }
    } catch (e) {
      console.error(e);
      toast('Erreur de stockage local : ' + e.message, 8000);
    }
  })();

  // Pour les tests
  window.Balise = { map, routes: () => routes, saveNewRoute, openDetail, Nav, GPS, Rec, LAYERS, planTiles };
})();
