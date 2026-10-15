/* ============================================================
   BoraLanchar! — cardápio público de cada restaurante
   Endereço: /l/<link-da-loja>  ou  /loja.html?r=<link-da-loja>
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.BORA_CONFIG || {};
const H = window.BoraHoras;
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

let slug = (new URLSearchParams(location.search).get('r') || (location.pathname.match(/\/l\/([a-z0-9-]+)/) || [])[1] || '').toLowerCase();
let KEY = 'bora-cart-' + slug;
let LAST = 'bora-last-' + slug;

let R = null;             // restaurante
let CATS = [];            // categorias com produtos
let P = {};               // produtos por id
let cart = [];            // [{pid, qty, note, opts:[ids]}]
let sellable = false;
let GEO = null;           // localização do cliente {lat,lng}
const isOpen = () => H.openNow(R);

const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200); }
function state(title, text) { $('#st-title').textContent = title; $('#st-text').textContent = text || ''; $('#v-state').hidden = false; $('#v-menu').hidden = true; }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (_) {} }

async function load() {
  if (!slug) return state('Cardápio não encontrado', 'Confira o link que a loja enviou para você.');
  if (!sb) return state('Cardápio indisponível', 'Tente novamente em instantes.');
  let { data: r, error } = await sb.from('restaurants').select('*').eq('slug', slug).maybeSingle();
  if (!error && !r) { // link antigo (a loja mudou de nome)
    const old = await sb.from('restaurants').select('*').contains('old_slugs', [slug]).limit(1);
    r = old.data && old.data[0];
    if (r) {
      slug = r.slug; KEY = 'bora-cart-' + slug; LAST = 'bora-last-' + slug;
      if (/\/l\//.test(location.pathname)) history.replaceState(null, '', `/l/${slug}${location.hash}`);
    }
  }
  if (error || !r) return state('Cardápio não encontrado', 'Confira o link que a loja enviou para você.');
  R = r;
  sellable = r.status === 'ativo' || (r.status === 'teste' && new Date(r.trial_ends_at) > new Date());
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categories').select('*').eq('restaurant_id', r.id).order('position').order('id'),
    sb.from('products').select('*').eq('restaurant_id', r.id).order('position').order('id'),
  ]);
  P = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  CATS = (cats || []).map((c) => ({ ...c, items: (prods || []).filter((p) => p.category_id === c.id) }));
  const loose = (prods || []).filter((p) => !p.category_id || !(cats || []).some((c) => c.id === p.category_id));
  if (loose.length) CATS.push({ id: 0, name: 'Outros', items: loose });
  CATS = CATS.filter((c) => c.items.length);
  try { cart = (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter((l) => P[l.pid] && P[l.pid].available).map((l) => ({ ...l, opts: (l.opts || []).filter((id) => optById(l.pid, id)) })); } catch (_) { cart = []; }

  document.title = `${r.name} · Cardápio digital`;
  if (!sellable) return state(`${r.name}`, 'Este cardápio está temporariamente indisponível. Fale direto com a loja.');
  renderHeader();
  renderMenu();
  renderCart();
  $('#v-state').hidden = true; $('#v-menu').hidden = false;
  setInterval(() => { renderHeader(); renderCart(); }, 60000);

  const last = localStorage.getItem(LAST);
  if (last && location.hash === '#pedido') showTrack(last);
}

/* ---------- cabeçalho no estilo Google Meu Negócio ---------- */
const zones = () => (R.delivery_mode !== 'fixa' ? R.delivery_zones || [] : []);
function feeSummary() {
  const z = zones();
  if (!z.length) return Number(R.delivery_fee) > 0 ? brl(R.delivery_fee) : 'grátis';
  const fees = z.map((x) => Number(x.fee || 0)); const lo = Math.min(...fees), hi = Math.max(...fees);
  const base = R.delivery_mode === 'bairro' ? 'por bairro' : 'por distância';
  return lo === hi ? `${lo > 0 ? brl(lo) : 'grátis'}` : `${base}, ${lo > 0 ? 'de ' + brl(lo) : 'grátis'} a ${brl(hi)}`;
}
function timeSummary() {
  const z = zones().map((x) => x.time).filter(Boolean);
  if (!z.length) return R.delivery_time;
  return z.length === 1 || new Set(z).size === 1 ? z[0] : `${z[0]} a ${z[z.length - 1]}`;
}
function renderHeader() {
  $('#s-name').textContent = R.name;
  const logo = $('#s-logo'); logo.hidden = !R.logo_url; if (R.logo_url) { logo.src = R.logo_url; logo.alt = `Logo ${R.name}`; }
  $('#s-ini').hidden = !!R.logo_url; $('#s-ini').textContent = R.name.trim().charAt(0).toUpperCase();
  if (R.cover_url) { const c = $('#s-cover'); c.style.backgroundImage = `linear-gradient(rgba(26,17,18,.15),rgba(26,17,18,.35)), url("${R.cover_url.replace(/"/g, '%22')}")`; c.classList.add('has-photo'); }
  const st = H.status(R);
  const meta = [`<span class="${st.open ? 'open' : 'closed'}">${esc(st.text)}</span>`];
  if (R.accepts_delivery) meta.push(`<span>Entrega ${esc(timeSummary())}</span>`, `<span>Taxa ${esc(feeSummary())}</span>`);
  $('#s-meta').innerHTML = meta.join('');
  const tags = [];
  if (R.segment) tags.push(`<span class="chip hot">${esc(R.segment)}</span>`);
  if (Number(R.min_order) > 0) tags.push(`<span class="chip">Pedido mínimo ${brl(R.min_order)}</span>`);
  if (R.accepts_pickup) tags.push('<span class="chip">Retirada no balcão</span>');
  $('#s-tags').innerHTML = tags.join('');
  const n = $('#s-notice');
  n.hidden = st.open;
  if (!st.open) n.textContent = `${st.text.replace(/^Fechado ·\s*/, 'A loja está fechada e ')}. Você já pode olhar o cardápio${/abre/.test(st.text) ? '' : ', mas os pedidos voltam quando ela abrir'}.`.replace('fechada e abre', 'fechada agora e abre');

  // sobre / horários / contato
  $('#s-desc').hidden = !R.description; $('#s-desc').textContent = R.description || '';
  const today = H.spNow().d;
  $('#s-hours').innerHTML = R.opening_hours
    ? [1, 2, 3, 4, 5, 6, 0].map((d) => `<tr class="${d === today ? 'today' : ''}"><th>${H.DIAS[d]}</th><td>${esc(H.fmtDay(R.opening_hours, d))}</td></tr>`).join('')
    : `<tr><td>${esc(R.hours || 'A loja abre e fecha pelo painel. Confira o status no topo.')}</td></tr>`;
  const c = [];
  if (R.address) c.push(`<li><b>Endereço</b><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(R.lat != null ? `${R.lat},${R.lng}` : R.address)}" target="_blank" rel="noopener">${esc(R.address)}</a></li>`);
  if (R.whatsapp) c.push(`<li><b>WhatsApp</b><a href="https://wa.me/${waNum(R.whatsapp)}" target="_blank" rel="noopener">${esc(fmtPhone(R.whatsapp))}</a></li>`);
  if (R.phone) c.push(`<li><b>Telefone</b><a href="tel:${esc(R.phone.replace(/[^0-9+]/g, ''))}">${esc(R.phone)}</a></li>`);
  if (R.instagram) c.push(`<li><b>Instagram</b><a href="https://instagram.com/${encodeURIComponent(R.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">${esc(R.instagram)}</a></li>`);
  if (R.website) c.push(`<li><b>Site</b><a href="${esc(/^https?:/i.test(R.website) ? R.website : 'https://' + R.website)}" target="_blank" rel="noopener">${esc(R.website.replace(/^https?:\/\//, ''))}</a></li>`);
  const pm = (R.payment_methods || ['pix', 'cartao', 'dinheiro']).map((k) => PAG[k]).join(', ');
  c.push(`<li><b>Pagamento</b><span>${esc(pm)}</span></li>`);
  $('#s-contact').innerHTML = c.join('');
}
const waNum = (w) => { const d = String(w || '').replace(/\D/g, ''); return d.length <= 11 ? '55' + d : d; };
const fmtPhone = (w) => { const d = String(w || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : w; };

function thumb(p) {
  if (p.image_url) return `<img class="thumb photo" src="${esc(p.image_url)}" alt="" loading="lazy">`;
  return `<span class="thumb ph" aria-hidden="true">${esc(p.name.charAt(0).toUpperCase())}</span>`;
}

function renderMenu(filter = '') {
  const q = filter.trim().toLowerCase();
  const html = CATS.map((c) => {
    const items = c.items.filter((i) => !q || (i.name + ' ' + (i.description || '')).toLowerCase().includes(q));
    if (!items.length) return '';
    return `<section class="section" id="sec-${c.id}" data-cat="${c.id}">
      <h2>${esc(c.name)} <small>${items.length} ${items.length === 1 ? 'item' : 'itens'}</small></h2>
      <div class="grid">${items.map((i) => `
        <button class="prod" type="button" data-prod="${i.id}" ${i.available ? '' : 'disabled style="opacity:.55"'}>
          <div class="prod-info"><b>${esc(i.name)}</b>${i.description ? `<p>${esc(i.description)}</p>` : ''}
            <div class="prod-foot"><span class="price">${brl(i.price)}</span>${(i.options || []).length && i.available ? '<span class="badge soft">Personalizável</span>' : ''}${i.available ? '' : '<span class="badge">Esgotado</span>'}</div></div>
          ${thumb(i)}
        </button>`).join('')}</div></section>`;
  }).join('');
  $('#menu').innerHTML = html || `<p class="empty-search">${q ? 'Nada encontrado com esse nome.' : 'Esta loja ainda está montando o cardápio. Volte daqui a pouco!'}</p>`;
  $('#cats').innerHTML = CATS.map((c, i) => `<button type="button" data-cat="${c.id}" class="${i === 0 ? 'on' : ''}">${esc(c.name)}</button>`).join('');
}
$('#q').addEventListener('input', (e) => renderMenu(e.target.value));
$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  $$('#cats button').forEach((x) => x.classList.toggle('on', x === b));
  const sec = document.getElementById('sec-' + b.dataset.cat);
  if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + scrollY - 80, behavior: 'smooth' });
});
$('#menu').addEventListener('click', (e) => { const b = e.target.closest('[data-prod]'); if (b && !b.disabled) openProduct(+b.dataset.prod); });

/* ---------- opções do produto ---------- */
function optById(pid, id) {
  for (const g of P[pid].options || []) for (const o of g.items || []) if (o.id === id) return { g, o };
  return null;
}
function unitPrice(pid, opts) {
  return Number(P[pid].price) + (opts || []).reduce((s, id) => { const x = optById(pid, id); return s + (x && x.g.kind !== 'remove' ? Number(x.o.price || 0) : 0); }, 0);
}
function optLabels(pid, opts) {
  return (opts || []).map((id) => optById(pid, id)).filter(Boolean)
    .map(({ g, o }) => (g.kind === 'remove' ? `Sem ${o.name}` : g.kind === 'add' ? `+ ${o.name}` : `${g.title}: ${o.name}`));
}

/* ---------- produto ---------- */
const dProd = $('#d-prod');
let cur = null;
function groupHTML(g) {
  const head = g.kind === 'remove' ? 'Toque no que você quer tirar'
    : g.kind === 'choose' ? 'Escolha 1 opção' : g.max ? `Escolha até ${g.max}` : 'Escolha quantos quiser';
  return `<fieldset class="og og-${g.kind}" data-gid="${esc(g.id)}">
    <legend><span><b>${esc(g.title)}</b><small>${head}</small></span>${g.kind === 'choose' ? '<em class="req">Obrigatório</em>' : ''}</legend>
    <div class="og-items">${(g.items || []).map((o) => g.kind === 'remove'
      ? `<label class="og-chip"><input type="checkbox" value="${esc(o.id)}"><span>${esc(o.name)}</span></label>`
      : `<label class="og-row"><span class="og-name">${esc(o.name)}${Number(o.price) > 0 ? `<small>+ ${brl(o.price)}</small>` : ''}</span><input type="${g.kind === 'choose' ? 'radio' : 'checkbox'}" name="g-${esc(g.id)}" value="${esc(o.id)}"></label>`).join('')}
    </div></fieldset>`;
}
function openProduct(id) {
  const p = P[id]; if (!p) return;
  cur = { id, qty: 1, opts: [] };
  $('#pd-form').innerHTML = `
    <div class="pd-hero ${p.image_url ? 'has-photo' : ''}" style="background:var(--red-soft)">
      ${p.image_url ? `<img class="pd-blur" src="${esc(p.image_url)}" alt=""><img class="pd-photo" src="${esc(p.image_url)}" alt="">` : `<span class="thumb ph" style="width:120px;height:120px;font-size:56px;border-radius:28px">${esc(p.name.charAt(0))}</span>`}
      <button class="x" type="button" data-close aria-label="Fechar"><svg width="20" height="20"><use href="#i-x"/></svg></button>
    </div>
    <div class="pd-body">
      <div><h2 id="pd-title">${esc(p.name)}</h2>${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ''}<p class="pd-base price">${brl(p.price)}</p></div>
      ${(p.options || []).map(groupHTML).join('')}
      <div class="field"><label for="pd-obs" style="font-weight:700">Alguma observação?</label><textarea id="pd-obs" maxlength="140" placeholder="Ex.: caprichar no molho, cortar ao meio…"></textarea></div>
    </div>
    <div class="pd-foot">
      <div class="qty"><button type="button" data-q="-1" aria-label="Diminuir">−</button><span id="pd-qty">1</span><button type="button" data-q="1" aria-label="Aumentar">+</button></div>
      <button class="btn btn-primary" type="button" id="pd-add"><span id="pd-add-txt">Adicionar</span><span class="price" id="pd-total">${brl(p.price)}</span></button>
    </div>`;
  syncProduct();
  dProd.showModal();
}
function syncProduct() {
  const p = P[cur.id];
  cur.opts = $$('#pd-form .og input:checked').map((i) => i.value);
  let missing = null;
  for (const g of p.options || []) {
    const box = $(`#pd-form [data-gid="${CSS.escape(g.id)}"]`); if (!box) continue;
    const n = $$('input:checked', box).length;
    if (g.kind === 'add' && g.max) $$('input', box).forEach((i) => { i.disabled = !i.checked && n >= g.max; i.closest('label').classList.toggle('off', i.disabled); });
    if (g.kind === 'choose') { box.classList.toggle('done', n === 1); if (n !== 1 && !missing) missing = g; }
  }
  $('#pd-total').textContent = brl(unitPrice(cur.id, cur.opts) * cur.qty);
  const add = $('#pd-add'); add.classList.toggle('wait', !!missing);
  $('#pd-add-txt').textContent = missing ? `Escolha: ${missing.title}` : 'Adicionar';
  cur.missing = missing;
}
dProd.addEventListener('change', (e) => { if (e.target.closest('.og')) syncProduct(); });
dProd.addEventListener('click', (e) => {
  if (e.target === dProd || e.target.closest('[data-close]')) { dProd.close(); return; }
  const q = e.target.closest('[data-q]');
  if (q) { cur.qty = Math.max(1, Math.min(50, cur.qty + +q.dataset.q)); $('#pd-qty').textContent = cur.qty; syncProduct(); return; }
  if (e.target.closest('#pd-add')) {
    if (cur.missing) { const box = $(`#pd-form [data-gid="${CSS.escape(cur.missing.id)}"]`); box.classList.add('shake'); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => box.classList.remove('shake'), 600); return; }
    const note = $('#pd-obs').value.trim();
    const key = (l) => l.pid === cur.id && l.note === note && [...(l.opts || [])].sort().join() === [...cur.opts].sort().join();
    const same = cart.find(key);
    if (same) same.qty = Math.min(50, same.qty + cur.qty); else cart.push({ pid: cur.id, qty: cur.qty, note, opts: cur.opts });
    persist(); renderCart(); dProd.close(); toast(`${P[cur.id].name} na sacola`);
  }
});

/* ---------- taxa de entrega ---------- */
const PAG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
function distKm(a, b) {
  const k = Math.PI / 180;
  return 1.3 * 2 * 6371 * Math.asin(Math.sqrt(Math.sin((a.lat - b.lat) * k / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin((a.lng - b.lng) * k / 2) ** 2));
}
// devolve {fee, time, label, ok, pending}
function deliveryQuote() {
  const z = zones();
  if (!z.length) return { ok: true, fee: Number(R.delivery_fee), time: R.delivery_time, label: '' };
  if (R.delivery_mode === 'bairro') {
    const name = co.zone ? co.zone.value : '';
    const hit = z.find((x) => x.name === name);
    if (!hit) return { ok: false, pending: true, fee: 0, time: '', label: 'Escolha o seu bairro para ver a taxa.' };
    return { ok: true, fee: Number(hit.fee), time: hit.time, label: `Bairro ${hit.name}` };
  }
  const sorted = [...z].sort((a, b) => a.km - b.km);
  if (GEO && R.lat != null) {
    const d = distKm(GEO, { lat: R.lat, lng: R.lng });
    const hit = sorted.find((x) => x.km >= d);
    if (!hit) return { ok: false, fee: 0, time: '', label: `Seu endereço fica a cerca de ${d.toFixed(1).replace('.', ',')} km. A loja entrega até ${String(sorted[sorted.length - 1].km).replace('.', ',')} km.`, out: true };
    return { ok: true, fee: Number(hit.fee), time: hit.time, label: `Cerca de ${d.toFixed(1).replace('.', ',')} km da loja` };
  }
  const max = [...z].sort((a, b) => b.fee - a.fee)[0];
  return { ok: true, fee: Number(max.fee), time: max.time, label: 'Sem a sua localização, cobramos a taxa máxima. Use sua localização para calcular o valor certo.', pending: true };
}

/* ---------- sacola ---------- */
function lineTotal(l) { return unitPrice(l.pid, l.opts) * l.qty; }
function totals(modo = 'entrega') {
  const sub = cart.reduce((s, l) => s + lineTotal(l), 0);
  let fee = 0;
  if (modo === 'entrega' && sub > 0 && R.accepts_delivery) fee = zones().length ? (!$('#v-checkout').hidden ? deliveryQuote().fee : null) : Number(R.delivery_fee);
  return { sub, fee, total: sub + (fee || 0), count: cart.reduce((s, l) => s + l.qty, 0) };
}
function cartHTML() {
  const t = totals();
  if (!cart.length) return `<div class="cart-head"><h2>Sua sacola</h2></div><div class="cart-body"><div class="cart-empty"><svg width="34" height="34"><use href="#i-bag"/></svg><b>Sacola vazia</b><span>Escolha algo no cardápio para começar.</span></div></div>`;
  const min = Number(R.min_order); const open = isOpen();
  return `<div class="cart-head"><h2>Sua sacola</h2><button class="link" type="button" data-clear>Limpar</button></div>
    <div class="cart-body">${cart.map((l, i) => { const ol = optLabels(l.pid, l.opts); return `<div class="line"><div class="line-info"><b>${esc(P[l.pid].name)}</b>${ol.length ? `<small class="opts">${ol.map(esc).join(' · ')}</small>` : ''}${l.note ? `<small>Obs.: ${esc(l.note)}</small>` : ''}
      <div class="qty"><button type="button" data-l="${i}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button type="button" data-l="${i}" data-d="1" aria-label="Mais">+</button></div></div>
      <span class="line-price">${brl(lineTotal(l))}</span></div>`; }).join('')}</div>
    <div class="cart-foot">
      ${min > 0 && t.sub < min ? `<div class="progress">Faltam ${brl(min - t.sub)} para o pedido mínimo<i style="--p:${Math.min(100, t.sub / min * 100)}%"></i></div>` : ''}
      <div class="sum"><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>
      ${R.accepts_delivery ? `<div class="sum"><span>Taxa de entrega</span><span class="price">${t.fee == null ? `<small>${esc(feeSummary())}</small>` : t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : ''}
      <div class="sum total"><span>Total${t.fee == null ? ' sem entrega' : ''}</span><span class="price">${brl(t.total)}</span></div>
      <button class="btn btn-primary btn-block" type="button" data-checkout ${!open || (min > 0 && t.sub < min) ? 'disabled' : ''}>${open ? 'Continuar' : 'Loja fechada agora'}</button>
    </div>`;
}
function renderCart() {
  const h = cartHTML();
  $('#cart-panel').innerHTML = h; $('#cart-modal').innerHTML = h;
  const t = totals();
  $('#bagbar').classList.toggle('has', cart.length > 0);
  $('#bb-count').textContent = t.count; $('#bb-total').textContent = brl(t.total);
}
function cartClick(e) {
  const b = e.target.closest('[data-l]');
  if (b) { const l = cart[+b.dataset.l]; l.qty += +b.dataset.d; if (l.qty <= 0) cart.splice(+b.dataset.l, 1); persist(); renderCart(); return; }
  if (e.target.closest('[data-clear]')) { cart = []; persist(); renderCart(); return; }
  if (e.target.closest('[data-checkout]')) { $('#d-bag').open && $('#d-bag').close(); go('checkout'); }
}
$('#cart-panel').addEventListener('click', cartClick);
$('#cart-modal').addEventListener('click', cartClick);
$('#open-bag').addEventListener('click', () => $('#d-bag').showModal());
$('#d-bag').addEventListener('click', (e) => { if (e.target.id === 'd-bag') e.target.close(); });

/* ---------- navegação ---------- */
function go(view) {
  ['menu', 'checkout', 'track'].forEach((v) => { $('#v-' + v).hidden = v !== view; });
  $('#bagbar').style.display = view === 'menu' ? '' : 'none';
  if (view === 'checkout') prepareCheckout();
  if (view === 'menu') renderCart();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

/* ---------- checkout ---------- */
const co = $('#checkout');
const modo = () => (co.modo.value || (R.accepts_delivery ? 'entrega' : 'retirada'));
function prepareCheckout() {
  $('#opt-ent').hidden = !R.accepts_delivery; $('#opt-ret').hidden = !R.accepts_pickup;
  if (!R.accepts_delivery) co.modo.value = 'retirada';
  if (!R.accepts_pickup) co.modo.value = 'entrega';
  $('#box-modo').hidden = !(R.accepts_delivery && R.accepts_pickup);
  $('#m-ent').textContent = `${timeSummary()} · ${feeSummary()}`;
  $('#ret-end').textContent = R.address ? `Retire em: ${R.address}` : 'A loja combina o local de retirada pelo WhatsApp.';
  // bairro: lista fechada da loja
  const byZone = R.delivery_mode === 'bairro' && zones().length;
  $('#f-bairro-txt').hidden = byZone; $('#f-bairro-sel').hidden = !byZone;
  co.bairro.required = !byZone;
  if (byZone) co.zone.innerHTML = '<option value="">Selecione o seu bairro</option>' + zones().map((z) => `<option value="${esc(z.name)}">${esc(z.name)} — ${Number(z.fee) > 0 ? brl(z.fee) : 'grátis'}${z.time ? ' · ' + esc(z.time) : ''}</option>`).join('');
  $('#box-geo').hidden = !(R.delivery_mode === 'distancia' && zones().length && R.lat != null);
  // pagamento
  const pm = R.payment_methods || ['pix', 'cartao', 'dinheiro'];
  ['pix', 'cartao', 'dinheiro'].forEach((k) => { $('#pay-' + k).hidden = !pm.includes(k); });
  if (!pm.includes(co.pag.value)) co.pag.value = pm[0];
  try {
    const s = JSON.parse(localStorage.getItem('bora-cliente') || '{}');
    ['nome', 'tel', 'rua', 'num', 'bairro', 'comp'].forEach((k) => { if (s[k] && !co[k].value) co[k].value = s[k]; });
    if (byZone && s.zone && zones().some((z) => z.name === s.zone)) co.zone.value = s.zone;
  } catch (_) {}
  syncCheckout();
}
function syncCheckout() {
  const ent = modo() === 'entrega';
  $('#box-end').hidden = !ent; $('#box-ret').hidden = ent;
  $$('#box-end input[required], #box-end select').forEach((i) => { i.disabled = !ent; });
  $('#pag-cartao').textContent = ent ? 'Na entrega, na maquininha' : 'Na retirada, na maquininha';
  $('#pag-din').textContent = ent ? 'Na entrega' : 'Na retirada';
  $('#box-troco').hidden = co.pag.value !== 'dinheiro';
  const q = ent && R.accepts_delivery ? deliveryQuote() : { ok: true, fee: 0 };
  const fl = $('#fee-line');
  fl.hidden = !ent || !zones().length;
  if (ent && zones().length) {
    fl.className = 'fee-line' + (q.out ? ' bad' : q.pending ? ' warn' : ' good');
    fl.innerHTML = q.out ? esc(q.label) : `${q.label ? esc(q.label) + ' · ' : ''}${q.pending && R.delivery_mode === 'bairro' ? '' : `Taxa <b>${q.fee > 0 ? brl(q.fee) : 'grátis'}</b>${q.time ? ` · chega em ${esc(q.time)}` : ''}`}`;
  }
  const t = totals(modo());
  $('#resumo').innerHTML = cart.map((l) => { const ol = optLabels(l.pid, l.opts); return `<div><span>${l.qty}× ${esc(P[l.pid].name)}${ol.length ? `<small>${ol.map(esc).join(' · ')}</small>` : ''}</span><span class="price">${brl(lineTotal(l))}</span></div>`; }).join('')
    + `<div><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>`
    + (ent ? `<div><span>Taxa de entrega</span><span class="price">${q.out || (q.pending && R.delivery_mode === 'bairro') ? '—' : t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : '')
    + `<div style="font-weight:800;font-size:16px"><span style="color:var(--ink)">Total</span><span class="price">${brl(t.total)}</span></div>`;
  $('#confirm-total').textContent = brl(t.total);
  $('#confirm').disabled = ent && !!q.out;
}
co.addEventListener('change', syncCheckout);
co.tel.addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 11);
  e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
});

/* localização do cliente (entrega por distância) */
function setGeo(lat, lng, how) {
  GEO = { lat, lng, gps: how === 'gps' };
  $('#geo-msg').textContent = how === 'gps' ? 'Localização do aparelho usada para calcular a taxa.' : 'Localização encontrada pelo endereço digitado.';
  $('#box-geo').classList.add('ok');
  syncCheckout();
}
$('#geo-me').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Seu aparelho não informa a localização.');
  $('#geo-msg').textContent = 'Pegando sua localização…';
  navigator.geolocation.getCurrentPosition((p) => setGeo(p.coords.latitude, p.coords.longitude, 'gps'),
    () => { $('#geo-msg').textContent = 'Não foi possível pegar a localização. Confira o endereço digitado.'; }, { enableHighAccuracy: true, timeout: 15000 });
});
let geoTimer = null;
function geocodeTyped() {
  if (R.delivery_mode !== 'distancia' || R.lat == null || (GEO && GEO.gps)) return;
  const rua = co.rua.value.trim(), n = co.num.value.trim(), b = co.bairro.value.trim();
  if (!rua || !b) return;
  clearTimeout(geoTimer);
  geoTimer = setTimeout(async () => {
    try {
      const box = [R.lng - 0.3, R.lat + 0.3, R.lng + 0.3, R.lat - 0.3].join(',');
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&bounded=1&viewbox=${box}&q=${encodeURIComponent(`${rua} ${n}, ${b}`)}`, { headers: { 'Accept-Language': 'pt-BR' } });
      const [hit] = await r.json();
      if (hit) setGeo(+hit.lat, +hit.lon, 'addr');
      else { $('#geo-msg').textContent = 'Não achamos esse endereço no mapa. Toque em "Usar minha localização".'; }
    } catch (_) {}
  }, 700);
}
['rua', 'num', 'bairro'].forEach((k) => co[k].addEventListener('change', geocodeTyped));

co.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#co-err').textContent = '';
  let bad = null;
  $$('input[required], select[name="zone"]', co).forEach((i) => {
    if (i.disabled || i.closest('[hidden]')) return;
    const v = i.value.trim();
    const msg = !v ? (i.name === 'zone' ? 'Escolha o bairro.' : 'Campo obrigatório.') : (i.name === 'tel' && v.replace(/\D/g, '').length < 10 ? 'Informe um WhatsApp com DDD.' : '');
    i.parentElement.querySelector('.err').textContent = msg;
    if (msg && !bad) bad = i;
  });
  if (bad) { bad.focus(); return; }
  if (!cart.length) { go('menu'); return; }
  const ent = modo() === 'entrega';
  const byZone = R.delivery_mode === 'bairro' && zones().length;
  const bairro = byZone ? co.zone.value : co.bairro.value.trim();
  const addr = ent ? `${co.rua.value.trim()}, ${co.num.value.trim()} — ${bairro}${co.comp.value.trim() ? ' (' + co.comp.value.trim() + ')' : ''}` : null;
  const troco = co.pag.value === 'dinheiro' ? parseFloat(co.troco.value.replace(',', '.')) : NaN;
  const btn = $('#confirm'); btn.disabled = true;
  try { localStorage.setItem('bora-cliente', JSON.stringify({ nome: co.nome.value.trim(), tel: co.tel.value, rua: co.rua.value, num: co.num.value, bairro: byZone ? '' : co.bairro.value, zone: byZone ? co.zone.value : '', comp: co.comp.value })); } catch (_) {}
  const customer = { name: co.nome.value.trim(), phone: co.tel.value, mode: modo(), address: addr, payment: co.pag.value, change_for: Number.isFinite(troco) ? String(troco) : '', notes: co.obs.value.trim() };
  if (ent && byZone) customer.zone = co.zone.value;
  if (ent && GEO) { customer.lat = GEO.lat.toFixed(6); customer.lng = GEO.lng.toFixed(6); }
  const { data, error } = await sb.rpc('place_order', {
    p_slug: slug, p_customer: customer,
    p_items: cart.map((l) => ({ product_id: l.pid, qty: l.qty, note: l.note, options: l.opts || [] })),
  });
  btn.disabled = false;
  if (error) { $('#co-err').textContent = (error.message || 'Não foi possível enviar o pedido.').replace(/^.*?:\s*/, ''); return; }
  const order = { ...data, customer: co.nome.value.trim(), phone: co.tel.value, mode: modo(), address: addr, payment: co.pag.value, change_for: troco, notes: co.obs.value.trim() };
  try { localStorage.setItem(LAST, data.public_id); localStorage.setItem('bora-order-' + data.public_id, JSON.stringify(order)); } catch (_) {}
  cart = []; persist(); renderCart();
  location.hash = 'pedido';
  showTrack(data.public_id, order);
});

/* ---------- acompanhamento ---------- */
let poll = null;
function waText(o) {
  const lines = (o.items || []).map((i) => `• ${i.qty}× ${i.name} — ${brl(i.price * i.qty)}${(i.opts || []).map((t) => `\n   ${t}`).join('')}${i.note ? `\n   Obs.: ${i.note}` : ''}`).join('\n');
  return `*Pedido #${o.number}* — ${R.name}\n\n${lines}\n\nSubtotal: ${brl(o.subtotal)}${o.mode === 'entrega' ? `\nEntrega: ${Number(o.fee) > 0 ? brl(o.fee) : 'grátis'}${o.delivery_info ? ` (${o.delivery_info})` : ''}` : ''}\n*Total: ${brl(o.total)}*\n\n`
    + `Cliente: ${o.customer} · ${o.phone}\n${o.mode === 'entrega' ? `Entregar em: ${o.address}` : 'Vou retirar no balcão'}\nPagamento: ${PAG[o.payment] || o.payment}${o.payment === 'dinheiro' && Number.isFinite(o.change_for) ? ` (troco para ${brl(o.change_for)})` : ''}${o.notes ? `\nObs.: ${o.notes}` : ''}`;
}
async function showTrack(publicId, order) {
  if (!order) { try { order = JSON.parse(localStorage.getItem('bora-order-' + publicId) || 'null'); } catch (_) {} }
  if (!order) return;
  go('track');
  $('#t-num').textContent = `Pedido #${order.number}`;
  $('#t-items').innerHTML = (order.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}${i.note ? ` <small style="color:var(--muted-2)">(${esc(i.note)})</small>` : ''}</span><span class="price">${brl(i.price * i.qty)}</span></div>`).join('')
    + (order.mode === 'entrega' ? `<div><span>Entrega${order.delivery_info ? ` <small>${esc(order.delivery_info)}</small>` : ''}</span><span class="price">${Number(order.fee) > 0 ? brl(order.fee) : 'Grátis'}</span></div>` : '')
    + `<div style="font-weight:800"><span style="color:var(--ink)">Total</span><span class="price">${brl(order.total)}</span></div>`;
  const pix = order.payment === 'pix' && (order.pix_key || R.pix_key);
  $('#t-pix').hidden = !pix; if (pix) $('#t-pix-key').textContent = pix;
  const wa = (R.whatsapp || '').replace(/\D/g, '');
  const waBtn = $('#t-wa');
  waBtn.hidden = !wa;
  if (wa) waBtn.href = `https://wa.me/${waNum(wa)}?text=${encodeURIComponent(waText(order))}`;
  const ent = order.mode === 'entrega';
  const STEPS = [['novo', 'Pedido enviado', 'A loja já recebeu seu pedido.'], ['preparo', 'Em preparo', 'Seu pedido está sendo feito.'],
    ent ? ['saiu', 'Saiu para entrega', 'O entregador está a caminho.'] : ['pronto', 'Pronto para retirar', 'Pode vir buscar no balcão.'],
    ['entregue', ent ? 'Entregue' : 'Retirado', 'Bom apetite!']];
  const ORDER = { novo: 0, preparo: 1, pronto: 2, saiu: 2, entregue: 3 };
  const render = (st) => {
    if (st === 'cancelado') {
      $('#t-title').textContent = 'Pedido cancelado'; $('#t-sub').textContent = 'Fale com a loja pelo WhatsApp se tiver dúvidas.';
      $('#steps').innerHTML = ''; return true;
    }
    const k = ORDER[st] ?? 0;
    $('#t-title').textContent = STEPS[k][1] + (k === 0 ? '!' : '');
    $('#t-sub').textContent = STEPS[k][2];
    $('#steps').innerHTML = STEPS.map((s, i) => `<li class="${i < k ? 'done' : i === k ? 'now done' : ''}"><span class="dot">${i <= k ? '<svg width="16" height="16"><use href="#i-check"/></svg>' : ''}</span><div><b>${s[1]}</b><small>${s[2]}</small></div></li>`).join('');
    return st === 'entregue';
  };
  render('novo');
  clearInterval(poll);
  const tick = async () => {
    const { data } = await sb.rpc('order_status', { p_public_id: publicId });
    if (data && render(data.status)) clearInterval(poll);
  };
  tick(); poll = setInterval(tick, 15000);
}
$('#t-pix-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#t-pix-key').textContent); toast('Chave Pix copiada!'); } catch (_) { toast($('#t-pix-key').textContent); } });
$('#again').addEventListener('click', () => { clearInterval(poll); history.replaceState(null, '', location.pathname + location.search); go('menu'); });

load();
