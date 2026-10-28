/* ============================================================
   BoraLanchar! — app do motoboy (planos Profissional e Completo)
   Endereço: /motoboy.html?loja=<link-da-loja>
   O motoboy entra com o PIN, pega a entrega, toca em "Saí para entrega"
   e o celular manda a localização para o cliente acompanhar no mapa.
   Banco: funções courier_* em supabase/motoboys.sql
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
const slug = (new URLSearchParams(location.search).get('loja') || '').toLowerCase();
const SKEY = 'bora-motoboy-' + slug;

let S = null;                 // sessão {token, name, restaurant}
let DATA = { mine: [], free: [], done_today: 0 };
let tick = null;
const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3500); }
function view(id) { ['v-login', 'v-list', 'v-state'].forEach((v) => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); }
const msg = (e) => String((e && e.message) || 'Não foi possível agora. Tente de novo.').replace(/^.*?:\s*/, '');
function expired(e) { if (/sess[aã]o expirada/i.test((e && e.message) || '')) { logout(true); toast('Sua sessão expirou. Entre de novo com o PIN.'); return true; } return false; }

/* ---------- entrar ---------- */
let pin = '';
function drawPin() { document.querySelectorAll('#pin i').forEach((d, i) => d.classList.toggle('on', i < pin.length)); }
$('#keys').addEventListener('click', (e) => {
  const k = e.target.closest('[data-k]'); if (!k) return; $('#lg-err').textContent = '';
  if (k.dataset.k === 'del') pin = pin.slice(0, -1);
  else if (k.dataset.k === 'ok') return login();
  else if (pin.length < 6) pin += k.dataset.k;
  drawPin();
});
document.addEventListener('keydown', (e) => { if ($('#v-login').hidden) return; if (/^\d$/.test(e.key) && pin.length < 6) { pin += e.key; drawPin(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); drawPin(); } else if (e.key === 'Enter') login(); });
async function login() {
  if (pin.length < 4) { $('#lg-err').textContent = 'O PIN tem de 4 a 6 números.'; return; }
  const b = $('[data-k="ok"]'); b.disabled = true;
  const { data, error } = await sb.rpc('courier_login', { p_slug: slug, p_pin: pin });
  b.disabled = false; pin = ''; drawPin();
  if (error) { $('#lg-err').textContent = msg(error); return; }
  if (data && data.error) { $('#lg-err').textContent = data.error; return; }
  S = data; try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (_) {}
  start();
}
async function logout(silent) {
  const onRoute = DATA.mine.some((o) => o.status === 'saiu');
  if (!silent && onRoute && !confirm('Você tem entrega em rota. Se sair, o cliente para de ver você no mapa. Sair mesmo assim?')) return;
  const tok = S && S.token;
  S = null; clearInterval(tick); gpsStop(); DATA = { mine: [], free: [], done_today: 0 };
  try { localStorage.removeItem(SKEY); } catch (_) {}
  if (tok && !silent) sb.rpc('courier_logout', { p_token: tok });
  view('v-login');
}
$('#logout').addEventListener('click', () => logout(false));

/* ---------- entregas ---------- */
async function load() {
  if (!S) return;
  const { data, error } = await sb.rpc('courier_orders', { p_token: S.token });
  if (error) { if (!expired(error)) toast(msg(error)); return; }
  DATA = data || DATA; render();
  if (DATA.mine.some((o) => o.status === 'saiu')) gpsStart(); else gpsStop();
}
const PAG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
function payLine(o) {
  if (o.paid) return `<div class="d-pay ok">Já está pago (${PAG[o.payment] || esc(o.payment)}). Não cobrar.</div>`;
  if (o.payment === 'dinheiro') return `<div class="d-pay">Cobrar ${brl(o.total)} em dinheiro${o.change_for ? ` · levar troco para ${brl(o.change_for)} (${brl(o.change_for - o.total)})` : ''}</div>`;
  if (o.payment === 'cartao') return `<div class="d-pay">Cobrar ${brl(o.total)} no cartão (levar a maquininha)</div>`;
  if (o.payment === 'pix') return `<div class="d-pay">Pix ainda não confirmado: ${brl(o.total)}. Confira com a loja.</div>`;
  return `<div class="d-pay">Total: ${brl(o.total)}</div>`;
}
function mapsUrl(o) { return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(o.geo || o.address || '')}`; }
function wazeUrl(o) { return o.geo ? `https://waze.com/ul?ll=${encodeURIComponent(o.geo)}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(o.address || '')}&navigate=yes`; }
function waUrl(o) { let d = digits(o.customer_phone); if (d.length <= 11) d = '55' + d; const first = (o.customer_name || '').split(' ')[0]; return `https://wa.me/${d}?text=${encodeURIComponent(`Olá, ${first}! Sou o motoboy da ${S.restaurant.name} com o seu pedido #${o.number}.`)}`; }
const STL = { novo: 'Aguardando a loja', preparo: 'Em preparo', pronto: 'Pronto para buscar', saiu: 'Em rota' };
function card(o, free) {
  const t = new Date(o.out_at || o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const tel = digits(o.customer_phone).length >= 10;
  const acts = free
    ? `<button class="g-btn primary" type="button" data-a="pegar">Pegar esta entrega</button>`
    : o.status === 'saiu'
      ? `<button class="g-btn primary" type="button" data-a="entregue">Entreguei ✓</button>`
      : `<button class="g-btn ghost" type="button" data-a="largar">Largar</button><button class="g-btn dark" type="button" data-a="sair" ${o.status === 'novo' ? 'disabled title="A loja ainda não aceitou este pedido"' : ''}>Saí para entrega</button>`;
  return `<article class="d-card ${o.status === 'saiu' ? 'rota' : ''}" data-id="${o.id}">
    <div class="d-h"><div><b>#${o.number} · ${esc(o.customer_name)}</b><small>${o.status === 'saiu' ? `Saiu às ${t}` : `Pedido às ${t}`} · ${o.items} ${o.items === 1 ? 'item' : 'itens'}</small></div><span class="st st-${o.status}">${STL[o.status] || esc(o.status)}</span></div>
    <p class="d-addr">${esc(o.address || 'Endereço não informado')}</p>
    <div class="d-meta">${o.delivery_info ? `<span><b>Entrega:</b> ${esc(o.delivery_info)}</span>` : ''}${o.notes ? `<span><b>Obs.:</b> ${esc(o.notes)}</span>` : ''}</div>
    ${payLine(o)}
    ${free ? '' : `<div class="d-links"><a href="${mapsUrl(o)}" target="_blank" rel="noopener">Google Maps</a><a href="${wazeUrl(o)}" target="_blank" rel="noopener">Waze</a>${tel ? `<a href="tel:+55${digits(o.customer_phone).replace(/^55(?=\d{10,11}$)/, '')}">Ligar</a><a href="${waUrl(o)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`}
    <div class="d-acts">${acts}</div></article>`;
}
function render() {
  $('#mine').innerHTML = DATA.mine.map((o) => card(o, false)).join('')
    || '<div class="empty-box">Nenhuma entrega com você agora. Pegue uma na lista abaixo ou espere a loja mandar.</div>';
  $('#free').innerHTML = DATA.free.map((o) => card(o, true)).join('')
    || '<div class="empty-box">Nenhum pedido esperando motoboy.</div>';
  $('#done-today').textContent = DATA.done_today ? `Hoje você entregou ${DATA.done_today}` : '';
  drawGps();
}
async function act(id, a, b) {
  if (a === 'entregue' && !confirm('Confirmar que o pedido foi entregue ao cliente?')) return;
  if (a === 'largar' && !confirm('Largar esta entrega? Ela volta para a lista de espera.')) return;
  if (a === 'sair') gpsStart(); // pede a permissão de localização no toque do motoboy
  b.disabled = true;
  const { error } = await sb.rpc('courier_action', { p_token: S.token, p_order: id, p_action: a });
  b.disabled = false;
  if (error) { if (!expired(error)) toast(msg(error)); load(); return; }
  toast({ pegar: 'Entrega é sua! Toque em "Saí para entrega" quando sair.', largar: 'Entrega devolvida para a lista.', sair: 'Boa entrega! O cliente já pode ver você no mapa.', entregue: 'Entrega concluída. Valeu!' }[a]);
  await load();
  if (a === 'sair' && lastPos) sendPos(lastPos, true);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b || !S) return;
  const c = b.closest('[data-id]'); act(+c.dataset.id, b.dataset.a, b);
});
$('#refresh').addEventListener('click', () => { load(); toast('Lista atualizada.'); });

/* ---------- localização ---------- */
let watchId = null, lastPos = null, lastSent = null, gpsErr = '', wake = null, beat = null;
function dist(a, b) { const R = 6371e3, r = Math.PI / 180; const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
async function sendPos(p, force) {
  if (!S) return;
  const now = Date.now();
  if (!force && lastSent && now - lastSent.t < 5000 && dist(lastSent, p) < 15) return;
  lastSent = { ...p, t: now };
  const { data, error } = await sb.rpc('courier_ping', { p_token: S.token, p_lat: p.lat, p_lng: p.lng, p_accuracy: p.acc, p_heading: p.heading, p_speed: p.speed });
  if (error) { if (!expired(error)) { gpsErr = 'Sem internet: tentando enviar de novo…'; drawGps(); } return; }
  if (data && data.ok === false) { load(); return; }
  gpsErr = ''; drawGps();
}
function gpsStart() {
  if (watchId !== null) return;
  if (!navigator.geolocation) { gpsErr = 'Este celular não informa a localização.'; drawGps(); return; }
  watchId = navigator.geolocation.watchPosition((pos) => {
    const c = pos.coords;
    lastPos = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy || 0), heading: Number.isFinite(c.heading) ? c.heading : null, speed: Number.isFinite(c.speed) ? c.speed : null, at: Date.now() };
    if (gpsErr && !/internet/.test(gpsErr)) gpsErr = '';
    sendPos(lastPos);
    drawGps();
  }, (err) => {
    gpsErr = err.code === 1 ? 'Localização bloqueada. Libere a localização para este site nas configurações do navegador.' : 'Procurando sinal do GPS…';
    drawGps();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  clearInterval(beat); beat = setInterval(() => { if (lastPos) sendPos(lastPos, Date.now() - (lastSent ? lastSent.t : 0) > 20000); drawGps(); }, 10000);
  keepAwake();
}
function gpsStop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; lastPos = null; lastSent = null; gpsErr = ''; clearInterval(beat);
  if (wake) { wake.release().catch(() => {}); wake = null; }
  drawGps();
}
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake && !document.hidden) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (watchId !== null) { keepAwake(); if (lastPos) sendPos(lastPos, true); }
  load();
});
function drawGps() {
  const el = $('#gps'); const on = watchId !== null;
  el.hidden = !on;
  if (!on) return;
  if (gpsErr) { el.className = 'gps off'; el.innerHTML = `<div>${esc(gpsErr)}</div>`; return; }
  if (!lastSent) { el.className = 'gps off'; el.innerHTML = '<div>Pegando sua localização…<small>Aceite o pedido de localização do navegador.</small></div>'; return; }
  const s = Math.max(0, Math.round((Date.now() - lastSent.t) / 1000));
  el.className = 'gps';
  el.innerHTML = `<div>O cliente está vendo você no mapa · enviado há ${s < 5 ? 'poucos segundos' : `${s} s`}<small>Deixe esta tela aberta durante a entrega.</small></div>`;
}

async function start() {
  view('v-list');
  $('#tp-store').textContent = S.restaurant.name; $('#tp-who').textContent = `Motoboy: ${S.name}`;
  document.title = `Motoboy · ${S.restaurant.name}`;
  await load();
  clearInterval(tick); tick = setInterval(() => { if (!document.hidden && S) load(); }, 12000);
}
async function boot() {
  if (!sb) { $('#st-text').textContent = 'Sistema indisponível.'; return; }
  if (!slug) { $('#st-text').textContent = 'Link do app incompleto. Peça o link certo para o dono da loja.'; return; }
  try { S = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (_) { S = null; }
  if (S && S.token) return start();
  const { data: r } = await sb.from('restaurants').select('name, logo_url').eq('slug', slug).maybeSingle();
  if (!r) { $('#st-text').textContent = 'Loja não encontrada. Confira o link.'; return; }
  $('#lg-store').textContent = r.name; document.title = `Motoboy · ${r.name}`;
  $('#lg-ini').textContent = r.name.charAt(0).toUpperCase(); if (r.logo_url) { $('#lg-logo').src = r.logo_url; $('#lg-logo').hidden = false; $('#lg-ini').hidden = true; }
  view('v-login');
}
boot();
