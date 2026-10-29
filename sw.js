/* BoraLanchar! — service worker do app (painel instalável)
   Sempre busca a versão nova na internet; só usa o que está guardado quando estiver sem conexão. */
const CACHE = 'bora-app-v5';
const SHELL = ['/painel.html', '/baixar.html', '/assets/app/campainha-icone-192.png', '/assets/brand/campainha-logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase, fontes e CDN seguem direto
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || url.pathname.startsWith('/assets/'))) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match('/painel.html') : Response.error())))
  );
});
