/* ============================================================
   BoraLanchar! — mapa da entrega (Leaflet + OpenStreetMap)
   Carrega o Leaflet só quando precisa. Usado na tela do cliente e no painel.
     const m = await BoraMapa.create(el);
     m.set({ store: {lat,lng}, dest: {lat,lng}, couriers: [{id, lat, lng, name, heading}] });
   ============================================================ */
window.BoraMapa = (() => {
  const CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  let loading = null;
  function load() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((ok, fail) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = JS; s.async = true;
      s.onload = () => ok(window.L); s.onerror = () => { loading = null; fail(new Error('mapa')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pin = (L, cls, html) => L.divIcon({ className: 'bm-pin ' + cls, html, iconSize: [40, 40], iconAnchor: [20, 20] });
  const ok = (p) => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng);
  const parse = (geo) => { if (!geo) return null; const [lat, lng] = String(geo).split(',').map(Number); return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null; };

  async function create(el, opts = {}) {
    const L = await load();
    const map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: !!opts.scroll });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, subdomains: 'abc', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    map.setView([-20.2, -40.3], 12);
    let store = null, dest = null; const bikes = new Map(); let fitted = false, userMoved = false;
    map.on('dragstart', () => { userMoved = true; });

    function set({ store: s, dest: d, couriers = [] } = {}) {
      if (ok(s)) { if (!store) store = L.marker([s.lat, s.lng], { icon: pin(L, 'bm-store', '<span>🍔</span>'), keyboard: false, title: 'Loja' }).addTo(map); else store.setLatLng([s.lat, s.lng]); }
      if (ok(d)) { if (!dest) dest = L.marker([d.lat, d.lng], { icon: pin(L, 'bm-dest', '<span>🏠</span>'), keyboard: false, title: 'Endereço de entrega' }).addTo(map); else dest.setLatLng([d.lat, d.lng]); }
      const seen = new Set();
      couriers.filter(ok).forEach((c) => {
        const id = String(c.id ?? 'c'); seen.add(id);
        const label = `<span>🛵</span>${c.name ? `<b>${esc(c.name)}</b>` : ''}`;
        let m = bikes.get(id);
        if (!m) { m = L.marker([c.lat, c.lng], { icon: pin(L, 'bm-bike' + (c.stale ? ' stale' : ''), label), zIndexOffset: 1000, keyboard: false, title: c.name || 'Motoboy' }).addTo(map); bikes.set(id, m); }
        else { glide(m, c.lat, c.lng); m.setIcon(pin(L, 'bm-bike' + (c.stale ? ' stale' : ''), label)); }
      });
      [...bikes.keys()].forEach((id) => { if (!seen.has(id)) { map.removeLayer(bikes.get(id)); bikes.delete(id); } });
      if (!userMoved || !fitted) fit();
    }
    function glide(m, lat, lng) {
      const from = m.getLatLng(), t0 = performance.now(), dur = 1200;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { m.setLatLng([lat, lng]); return; }
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); m.setLatLng([from.lat + (lat - from.lat) * k, from.lng + (lng - from.lng) * k]); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    function fit() {
      const pts = [...bikes.values()].map((m) => m.getLatLng());
      if (dest) pts.push(dest.getLatLng());
      if (!pts.length && store) pts.push(store.getLatLng());
      if (!pts.length) return;
      if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
      fitted = true;
    }
    return { map, set, fit: () => { userMoved = false; fit(); }, resize: () => map.invalidateSize() };
  }
  return { load, create, parse };
})();
