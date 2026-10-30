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
let MESA = null;          // pedido na mesa pelo QR Code {token,label}
let CP = null;            // cupom aplicado {code,kind,value,label}
let LOY = { enabled: false }; // fidelidade da loja e do cliente
let CB = { enabled: false, balance: 0, use: false }; // cashback
let RATING = null;
const MESA_TOKEN = new URLSearchParams(location.search).get('mesa');
const plano = (f) => !!(R && window.BoraPlanos && window.BoraPlanos.has(R.plan, f));
const isOpen = () => H.openNow(R);
const canSchedule = () => !!R.schedule_enabled && !MESA;
const mesaTxt = () => { const k = MESA && MESA.kind === 'comanda' ? 'Comanda' : 'Mesa'; const l = String(MESA ? MESA.label : '').trim(); return new RegExp(`^${k}\\b`, 'i').test(l) ? l : `${k} ${l}`; };

const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200); }
const GAME = { on: true, id: null, rule: null, top: [] }; // joguinho da tela do pedido
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
  sellable = (r.status === 'ativo' && (!r.paid_until || new Date(r.paid_until) > new Date(Date.now() - 3 * 864e5))) || (r.status === 'teste' && new Date(r.trial_ends_at) > new Date());
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categories').select('*').eq('restaurant_id', r.id).order('position').order('id'),
    sb.from('products').select('*').eq('restaurant_id', r.id).order('position').order('id'),
  ]);
  const dow = H.spNow().d;
  (prods || []).forEach((p) => {
    if (p.promo_price != null && Number(p.promo_price) < Number(p.price)) { p.old_price = Number(p.price); p.price = Number(p.promo_price); }
    if (p.available && Array.isArray(p.days) && p.days.length && !p.days.includes(dow)) { p.available = false; p.offday = p.days.slice().sort().map((d) => H.CURTO[d]).join(', '); }
  });
  P = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  CATS = (cats || []).map((c) => ({ ...c, items: (prods || []).filter((p) => p.category_id === c.id) }));
  const loose = (prods || []).filter((p) => !p.category_id || !(cats || []).some((c) => c.id === p.category_id));
  if (loose.length) CATS.push({ id: 0, name: 'Outros', items: loose });
  CATS = CATS.filter((c) => c.items.length);
  try { cart = (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter((l) => P[l.pid] && P[l.pid].available).map((l) => ({ ...l, opts: (l.opts || []).filter((id) => optById(l.pid, id)) })); } catch (_) { cart = []; }

  document.title = `${r.name} · Cardápio digital`;
  if (!sellable) return state(`${r.name}`, 'Este cardápio está temporariamente indisponível. Fale direto com a loja.');
  if (MESA_TOKEN) {
    const { data: t } = await sb.rpc('table_info', { p_slug: slug, p_token: MESA_TOKEN });
    if (t) { MESA = { token: MESA_TOKEN, label: t.label, kind: t.kind || 'mesa' }; KEY = 'bora-cart-' + slug + '-mesa'; LAST = 'bora-last-' + slug + '-mesa'; try { cart = (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter((l) => P[l.pid] && P[l.pid].available); } catch (_) { cart = []; } }
    else toast('Este QR Code de mesa não está ativo. Você pode pedir normalmente.');
  }
  if (plano('cupons') && !MESA) { try { const s0 = JSON.parse(localStorage.getItem('bora-cliente') || '{}'); const { data } = await sb.rpc('loyalty_status', { p_slug: slug, p_phone: s0.tel || '' }); if (data) LOY = data; } catch (_) {} }
  if (plano('cupons') && !MESA) { try { const s0 = JSON.parse(localStorage.getItem('bora-cliente') || '{}'); const { data } = await sb.rpc('cashback_status', { p_slug: slug, p_phone: s0.tel || '' }); if (data) CB = { ...data, use: false }; } catch (_) {} }
  try { const { data } = await sb.rpc('store_rating', { p_slug: slug }); RATING = data || null; } catch (_) {}
  if (plano('inbox')) initChat();
  renderHeader();
  renderMenu();
  renderCart();
  if (!MESA) track('visit');
  $('#v-state').hidden = true; $('#v-menu').hidden = false;
  setInterval(() => { renderHeader(); renderCart(); }, 60000);

  const last = localStorage.getItem(LAST);
  if (last && location.hash === '#pedido') showTrack(last); else { renderResume(); if (MESA && window.BoraMesa) window.BoraMesa.start(); }
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
  if (LOY.enabled && Number(LOY.reward) > 0) tags.push(`<span class="chip loyal-chip">🎁 A cada ${LOY.goal} pedidos, ganhe ${brl(LOY.reward)}</span>`);
  if (CB.enabled) tags.push(`<span class="chip loyal-chip">💰 ${String(CB.pct).replace('.', ',')}% de volta em cashback</span>`);
  if (RATING && RATING.count) tags.unshift(`<span class="chip rate-chip">★ ${String(RATING.avg).replace('.', ',')} <small>(${RATING.count} avaliações)</small></span>`);
  const mb = $('#s-mesa'); mb.hidden = !MESA; if (MESA) mb.innerHTML = `Você está na <b>${esc(mesaTxt())}</b>. Escolha os itens e envie: o pedido vai direto para a cozinha e você paga no final.${window.BoraMesa && window.BoraMesa.on ? ' <button class="mesa-call" type="button" data-mesa-hub>Chamar garçom ou pedir a conta</button>' : ''}`;
  $('#s-tags').innerHTML = tags.join('');
  const n = $('#s-notice');
  n.hidden = st.open;
  if (!st.open) n.textContent = `${st.text.replace(/^Fechado ·\s*/, 'A loja está fechada e ')}. ${canSchedule() ? 'Você já pode agendar o seu pedido' : `Você já pode olhar o cardápio${/abre/.test(st.text) ? '' : ', mas os pedidos voltam quando ela abrir'}`}.`.replace('fechada e abre', 'fechada agora e abre');

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

function prodBtn(i) {
  return `<button class="prod" type="button" data-prod="${i.id}" ${i.available ? '' : 'disabled style="opacity:.55"'}>
          <div class="prod-info"><b>${esc(i.name)}</b>${i.description ? `<p>${esc(i.description)}</p>` : ''}
            <div class="prod-foot"><span class="price">${i.old_price ? `<s class="old">${brl(i.old_price)}</s> ` : ''}${brl(i.price)}</span>${i.old_price && i.available ? '<span class="badge promo">Promoção</span>' : ''}${(i.options || []).length && i.available ? '<span class="badge soft">Personalizável</span>' : ''}${i.available ? '' : `<span class="badge">${i.offday ? `Só ${esc(i.offday)}` : 'Esgotado'}</span>`}</div></div>
          ${thumb(i)}
        </button>`;
}
function againHTML() {
  if (MESA) return '';
  let last = null;
  try { const id = localStorage.getItem(LAST); last = id && JSON.parse(localStorage.getItem('bora-order-' + id) || 'null'); } catch (_) {}
  const lines = (last && last.cart || []).filter((l) => P[l.pid] && P[l.pid].available);
  if (!lines.length) return '';
  const names = lines.map((l) => `${l.qty}× ${P[l.pid].name}`).join(', ');
  return `<section class="again" aria-label="Peça de novo"><div><b>Peça de novo</b><small>${esc(names)}</small></div><button class="btn btn-outline" type="button" data-again>Colocar na sacola</button></section>`;
}
function renderMenu(filter = '') {
  const q = filter.trim().toLowerCase();
  const feat = q ? [] : Object.values(P).filter((p) => p.featured && p.available);
  const top = (q ? '' : againHTML()) + (feat.length ? `<section class="section featured" id="sec-dest"><h2>Destaques</h2><div class="feat-row">${feat.map(prodBtn).join('')}</div></section>` : '');
  const html = top + CATS.map((c) => {
    const items = c.items.filter((i) => !q || (i.name + ' ' + (i.description || '')).toLowerCase().includes(q));
    if (!items.length) return '';
    return `<section class="section" id="sec-${c.id}" data-cat="${c.id}">
      <h2>${esc(c.name)} <small>${items.length} ${items.length === 1 ? 'item' : 'itens'}</small></h2>
      <div class="grid">${items.map(prodBtn).join('')}</div></section>`;
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
$('#menu').addEventListener('click', (e) => {
  if (e.target.closest('[data-again]')) {
    let last = null; try { const id = localStorage.getItem(LAST); last = id && JSON.parse(localStorage.getItem('bora-order-' + id) || 'null'); } catch (_) {}
    (last && last.cart || []).filter((l) => P[l.pid] && P[l.pid].available).forEach((l) => {
      const opts = (l.opts || []).filter((id) => optById(l.pid, id));
      const k = opts.slice().sort().join(); const same = cart.find((x) => x.pid === l.pid && (x.opts || []).slice().sort().join() === k && (x.note || '') === (l.note || ''));
      if (same) same.qty = Math.min(50, same.qty + l.qty); else cart.push({ pid: l.pid, qty: l.qty, note: l.note || '', opts });
    });
    persist(); renderCart(); track('cart'); toast('Itens do último pedido colocados na sacola.'); return;
  }
  const b = e.target.closest('[data-prod]'); if (b && !b.disabled) openProduct(+b.dataset.prod);
});
/* ---------- funil (contagem anônima por sessão) ---------- */
function track(kind) {
  try { const k = 'bora-ev-' + slug + '-' + kind; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (_) {}
  if (sb && slug) sb.rpc('track_event', { p_slug: slug, p_kind: kind }).then(() => {}, () => {});
}

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
  cur = { id, qty: 1, opts: [] }; track('view');
  $('#pd-form').innerHTML = `
    <div class="pd-hero ${p.image_url ? 'has-photo' : ''}" style="background:var(--red-soft)">
      ${p.image_url ? `<img class="pd-blur" src="${esc(p.image_url)}" alt=""><img class="pd-photo" src="${esc(p.image_url)}" alt="">` : `<span class="thumb ph" style="width:120px;height:120px;font-size:56px;border-radius:28px">${esc(p.name.charAt(0))}</span>`}
      <button class="x" type="button" data-close aria-label="Fechar"><svg width="20" height="20"><use href="#i-x"/></svg></button>
    </div>
    <div class="pd-body">
      <div><h2 id="pd-title">${esc(p.name)}</h2>${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ''}<p class="pd-base price">${p.old_price ? `<s class="old">${brl(p.old_price)}</s> ` : ''}${brl(p.price)}</p></div>
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
    track('cart');
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
  if (modo === 'entrega' && !MESA && sub > 0 && R.accepts_delivery) fee = zones().length ? (!$('#v-checkout').hidden ? deliveryQuote().fee : null) : Number(R.delivery_fee);
  return { sub, fee, total: sub + (fee || 0), count: cart.reduce((s, l) => s + l.qty, 0) };
}
function cartHTML() {
  const t = totals();
  if (!cart.length) return `<div class="cart-head"><h2>Sua sacola</h2></div><div class="cart-body"><div class="cart-empty"><svg width="34" height="34"><use href="#i-bag"/></svg><b>Sacola vazia</b><span>Escolha algo no cardápio para começar.</span></div></div>`;
  const min = MESA ? 0 : Number(R.min_order); const open = isOpen();
  return `<div class="cart-head"><h2>Sua sacola</h2><button class="link" type="button" data-clear>Limpar</button></div>
    <div class="cart-body">${cart.map((l, i) => { const ol = optLabels(l.pid, l.opts); return `<div class="line"><div class="line-info"><b>${esc(P[l.pid].name)}</b>${ol.length ? `<small class="opts">${ol.map(esc).join(' · ')}</small>` : ''}${l.note ? `<small>Obs.: ${esc(l.note)}</small>` : ''}
      <div class="qty"><button type="button" data-l="${i}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button type="button" data-l="${i}" data-d="1" aria-label="Mais">+</button></div></div>
      <span class="line-price">${brl(lineTotal(l))}</span></div>`; }).join('')}</div>
    <div class="cart-foot">
      ${min > 0 && t.sub < min ? `<div class="progress">Faltam ${brl(min - t.sub)} para o pedido mínimo<i style="--p:${Math.min(100, t.sub / min * 100)}%"></i></div>` : ''}
      <div class="sum"><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>
      ${R.accepts_delivery && !MESA ? `<div class="sum"><span>Taxa de entrega</span><span class="price">${t.fee == null ? `<small>${esc(feeSummary())}</small>` : t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : ''}
      <div class="sum total"><span>Total${t.fee == null ? ' sem entrega' : ''}</span><span class="price">${brl(t.total)}</span></div>
      <button class="btn btn-primary btn-block" type="button" data-checkout ${(!open && !canSchedule()) || (min > 0 && t.sub < min) ? 'disabled' : ''}>${open ? 'Continuar' : canSchedule() ? 'Agendar pedido' : 'Loja fechada agora'}</button>
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
  ['menu', 'checkout', 'pay', 'track', 'mesa'].forEach((v) => { const el = $('#v-' + v); if (el) el.hidden = v !== view; });
  document.body.classList.toggle('on-mesa', view === 'mesa');
  $('#bagbar').style.display = view === 'menu' ? '' : 'none';
  if (view === 'checkout') prepareCheckout();
  if (view === 'menu') { renderCart(); if (CATS.length) renderMenu($('#q').value || ''); }
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

/* ---------- agendamento ---------- */
// horários de São Paulo em que a loja está aberta, de agora até schedule_days dias
function slots() {
  const step = Number(R.schedule_step) || 30, lead = Math.max(step, 15) + 5, days = Number(R.schedule_days) || 0;
  const now = H.spNow(); const nowAbs = Date.now();
  const sp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out = [];
  for (let k = 0; k <= days; k++) {
    const date = sp.format(new Date(nowAbs + k * 86400000)); // AAAA-MM-DD em Brasília
    const d = (now.d + k) % 7;
    const times = [];
    for (let m = 0; m < 1440; m += step) {
      if (k === 0 && m < now.m + lead) continue;
      if (!H.openNow({ is_open: true, opening_hours: R.opening_hours }, { d, m })) continue;
      times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    if (times.length) out.push({ date, label: k === 0 ? 'Hoje' : k === 1 ? 'Amanhã' : `${H.DIAS[d].split('-')[0]} ${date.slice(8, 10)}/${date.slice(5, 7)}`, times });
  }
  return out;
}
let SLOTS = [];
function prepareWhen() {
  const box = $('#box-when');
  if (!canSchedule()) { box.hidden = true; co.quando.value = 'agora'; return; }
  SLOTS = slots();
  box.hidden = false;
  const open = isOpen();
  $('#opt-now').hidden = !open;
  if (!open) co.quando.value = 'agendar';
  $('#c-dia').innerHTML = SLOTS.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('') || '<option value="">Sem horários disponíveis</option>';
  fillHours(); syncWhen();
}
function fillHours() { const s = SLOTS[+co.dia.value || 0]; $('#c-hora').innerHTML = s ? s.times.map((t) => `<option value="${t}">${t}</option>`).join('') : ''; }
function syncWhen() { $('#when-pick').hidden = co.quando.value !== 'agendar'; }
$('#checkout').addEventListener('change', (e) => { if (e.target.name === 'quando') syncWhen(); if (e.target.name === 'dia') fillHours(); });
function scheduledFor() {
  if (!canSchedule() || co.quando.value !== 'agendar') return null;
  const s = SLOTS[+co.dia.value || 0]; const t = co.hora.value;
  return s && t ? `${s.date}T${t}:00-03:00` : '';
}

/* ---------- checkout ---------- */
const co = $('#checkout');
const modo = () => (MESA ? 'mesa' : co.modo.value || (R.accepts_delivery ? 'entrega' : 'retirada'));
function prepareCheckout() {
  if (!MESA) track('checkout');
  co.obs.closest('.field').hidden = R.allow_notes === false && !MESA;
  $('#f-cutlery').hidden = !R.ask_cutlery || !!MESA;
  // mesa: só nome; sem entrega e sem pagamento agora
  $('#box-mesa').hidden = !MESA; $('#box-pag').hidden = !!MESA;
  if (MESA) { $('#h-mesa').textContent = mesaTxt(); $('#box-modo').hidden = true; $('#box-end').hidden = true; $('#box-ret').hidden = true; }
  co.tel.required = !MESA; co.tel.closest('.field').querySelector('label').textContent = MESA ? 'WhatsApp (opcional)' : 'WhatsApp';
  $('#box-promo').hidden = !(plano('cupons') && !MESA);
  $('#ly-box').hidden = true; renderCoupon(); checkLoyalty();
  if (MESA) { try { const s = JSON.parse(localStorage.getItem('bora-cliente') || '{}'); if (s.nome && !co.nome.value) co.nome.value = s.nome; if (s.tel && !co.tel.value) co.tel.value = s.tel; } catch (_) {} syncCheckout(); return; }
  prepareWhen();
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
  $('#pag-pix').textContent = R.pix_key ? 'QR Code ou copia e cola na hora' : 'A loja envia a chave Pix pelo WhatsApp';
  try {
    const s = JSON.parse(localStorage.getItem('bora-cliente') || '{}');
    ['nome', 'tel', 'rua', 'num', 'bairro', 'comp'].forEach((k) => { if (s[k] && !co[k].value) co[k].value = s[k]; });
    if (byZone && s.zone && zones().some((z) => z.name === s.zone)) co.zone.value = s.zone;
  } catch (_) {}
  syncCheckout();
}
function discountOf(t) {
  let d = 0;
  if (CP) d = CP.kind === 'percent' ? Math.round(t.sub * CP.value) / 100 : CP.kind === 'fixed' ? Math.min(CP.value, t.sub) : (t.fee || 0);
  if (LOY.useReward && LOY.rewards > 0) d += Math.min(Number(LOY.reward), t.sub + (t.fee || 0) - d);
  if (CB.use && !CP && Number(CB.balance) > 0) d += Math.min(Number(CB.balance), t.sub + (t.fee || 0) - d);
  return Math.max(0, Math.min(d, t.sub + (t.fee || 0)));
}
function syncCheckout() {
  if (MESA) {
    const t = totals('mesa');
    $('#resumo').innerHTML = cart.map((l) => { const ol = optLabels(l.pid, l.opts); return `<div><span>${l.qty}× ${esc(P[l.pid].name)}${ol.length ? `<small>${ol.map(esc).join(' · ')}</small>` : ''}</span><span class="price">${brl(lineTotal(l))}</span></div>`; }).join('')
      + `<div style="font-weight:800;font-size:16px"><span style="color:var(--ink)">Total deste pedido</span><span class="price">${brl(t.sub)}</span></div>`;
    $('#confirm-total').textContent = brl(t.sub); $('#confirm span').textContent = 'Enviar para a cozinha'; $('#confirm').disabled = false;
    return;
  }
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
  const disc = discountOf(t); const total = t.total - disc;
  $('#resumo').innerHTML = cart.map((l) => { const ol = optLabels(l.pid, l.opts); return `<div><span>${l.qty}× ${esc(P[l.pid].name)}${ol.length ? `<small>${ol.map(esc).join(' · ')}</small>` : ''}</span><span class="price">${brl(lineTotal(l))}</span></div>`; }).join('')
    + `<div><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>`
    + (ent ? `<div><span>Taxa de entrega</span><span class="price">${q.out || (q.pending && R.delivery_mode === 'bairro') ? '—' : t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : '')
    + (disc > 0 ? `<div class="disc"><span>Desconto${CP ? ` (${esc(CP.code)})` : ''}${LOY.useReward ? ' · prêmio fidelidade' : ''}${CB.use && !CP && CB.balance > 0 ? ' · cashback' : ''}</span><span class="price">− ${brl(disc)}</span></div>` : '')
    + `<div style="font-weight:800;font-size:16px"><span style="color:var(--ink)">Total</span><span class="price">${brl(total)}</span></div>`;
  $('#confirm-total').textContent = brl(total);
  $('#confirm span').textContent = co.pag.value === 'pix' && R.pix_key && total > 0 ? 'Ir para o pagamento' : 'Confirmar pedido';
  $('#confirm').disabled = ent && !!q.out;
}
co.addEventListener('change', syncCheckout);
co.tel.addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 11);
  e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  if (d.length >= 10) checkLoyalty();
});

/* ---------- cupom e fidelidade (planos Profissional e Completo) ---------- */
function renderCoupon() {
  $('#cp-ok').hidden = !CP; $('#cp-err').textContent = '';
  if (CP) $('#cp-ok').innerHTML = `🎟️ Cupom <b>${esc(CP.code)}</b> aplicado: ${esc(CP.label)} <button class="link" type="button" id="cp-rm">remover</button>`;
  $('#cp-apply').textContent = CP ? 'Trocar' : 'Aplicar';
  if (CB.enabled && !MESA && !$('#cb-box').hidden) { if (CP) CB.use = false; renderCashback(co.tel.value.replace(/\D/g, '').length >= 10); }
}
$('#cp-apply').addEventListener('click', async () => {
  const code = $('#c-cupom').value.trim().toUpperCase(); $('#cp-err').textContent = '';
  if (!code) { $('#cp-err').textContent = 'Digite o código do cupom.'; return; }
  const t = totals(modo()); const b = $('#cp-apply'); b.disabled = true;
  const { data, error } = await sb.rpc('check_coupon', { p_slug: slug, p_code: code, p_subtotal: t.sub, p_fee: t.fee || 0, p_phone: co.tel.value });
  b.disabled = false;
  if (error || !data) { $('#cp-err').textContent = 'Não foi possível conferir o cupom agora.'; return; }
  if (!data.ok) { CP = null; renderCoupon(); $('#cp-err').textContent = data.error; syncCheckout(); return; }
  CP = { code: data.code, kind: data.kind, value: Number(data.value), label: data.label };
  renderCoupon(); syncCheckout(); toast('Cupom aplicado!');
});
$('#c-cupom').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#cp-apply').click(); } });
$('#cp-ok').addEventListener('click', (e) => { if (e.target.id === 'cp-rm') { CP = null; $('#c-cupom').value = ''; renderCoupon(); syncCheckout(); } });
let lyTimer = null;
function checkLoyalty() {
  checkCashback();
  if (!LOY.enabled || MESA) { $('#ly-box').hidden = true; return; }
  clearTimeout(lyTimer);
  lyTimer = setTimeout(async () => {
    const tel = co.tel.value.replace(/\D/g, '');
    if (tel.length >= 10) { const { data } = await sb.rpc('loyalty_status', { p_slug: slug, p_phone: tel }); if (data && data.enabled) { const use = LOY.useReward; LOY = { ...data, useReward: use && data.rewards > 0 }; } }
    renderLoyalty(tel.length >= 10);
  }, 350);
}
function renderLoyalty(known) {
  const box = $('#ly-box'); box.hidden = false;
  const goal = LOY.goal || 10, st = Math.min(LOY.stamps || 0, goal);
  const dots = Array.from({ length: goal }, (_, i) => `<i class="${i < st ? 'on' : ''}"></i>`).join('');
  box.innerHTML = `<div class="loyal-head"><b>🎁 Cartão fidelidade</b><small>${known ? `${st} de ${goal} pedidos` : 'Informe seu WhatsApp para ver seus selos'}</small></div>
    <div class="loyal-dots" aria-hidden="true">${dots}</div>
    <small class="loyal-txt">A cada ${goal} pedidos entregues${Number(LOY.min) > 0 ? ` (a partir de ${brl(LOY.min)})` : ''}, você ganha ${brl(LOY.reward)} de desconto.</small>
    ${LOY.rewards > 0 ? `<label class="loyal-use"><input type="checkbox" id="ly-use" ${LOY.useReward ? 'checked' : ''}> <span>Usar meu prêmio de <b>${brl(LOY.reward)}</b> neste pedido${LOY.rewards > 1 ? ` (você tem ${LOY.rewards})` : ''}</span></label>` : ''}`;
  const u = $('#ly-use'); if (u) u.onchange = () => { LOY.useReward = u.checked; syncCheckout(); };
  syncCheckout();
}

/* cashback do cliente */
let cbTimer = null;
function checkCashback() {
  const box = $('#cb-box');
  if (!CB.enabled || MESA) { box.hidden = true; return; }
  clearTimeout(cbTimer);
  cbTimer = setTimeout(async () => {
    const tel = co.tel.value.replace(/\D/g, '');
    if (tel.length >= 10) { const { data } = await sb.rpc('cashback_status', { p_slug: slug, p_phone: tel }); if (data && data.enabled) CB = { ...data, use: CB.use && Number(data.balance) > 0 }; }
    renderCashback(tel.length >= 10);
  }, 350);
}
function renderCashback(known) {
  const box = $('#cb-box'); box.hidden = false;
  const bal = Number(CB.balance) || 0;
  const exp = CB.expires_at ? new Date(CB.expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  box.innerHTML = `<div class="loyal-head"><b>💰 Cashback</b><small>${known ? (bal > 0 ? `Saldo: ${brl(bal)}${exp ? ` · vale até ${exp}` : ''}` : 'Você ainda não tem saldo') : 'Informe seu WhatsApp para ver seu saldo'}</small></div>
    <small class="loyal-txt">Cada pedido entregue devolve ${String(CB.pct).replace('.', ',')}% em saldo para o próximo pedido (vale ${CB.days} dias). Não dá para usar junto com cupom.</small>
    ${bal > 0 ? `<label class="loyal-use"><input type="checkbox" id="cb-use" ${CB.use ? 'checked' : ''} ${CP ? 'disabled' : ''}> <span>Usar meu saldo de <b>${brl(bal)}</b> neste pedido${CP ? ' (tire o cupom para usar)' : ''}</span></label>` : ''}`;
  const u = $('#cb-use'); if (u) u.onchange = () => { CB.use = u.checked; syncCheckout(); };
  syncCheckout();
}

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
    if (MESA && i.name === 'tel' && !v) { i.parentElement.querySelector('.err').textContent = ''; return; }
    const msg = !v ? (i.name === 'zone' ? 'Escolha o bairro.' : 'Campo obrigatório.') : (i.name === 'tel' && v.replace(/\D/g, '').length < 10 ? 'Informe um WhatsApp com DDD.' : '');
    i.parentElement.querySelector('.err').textContent = msg;
    if (msg && !bad) bad = i;
  });
  if (bad) { bad.focus(); return; }
  if (!cart.length) { go('menu'); return; }
  const when = scheduledFor();
  if (when === '') { $('#co-err').textContent = 'Escolha o dia e o horário do agendamento.'; return; }
  if (when === null && !MESA && !isOpen()) { $('#co-err').textContent = 'A loja está fechada agora. Escolha "Agendar".'; return; }
  const ent = modo() === 'entrega';
  const byZone = R.delivery_mode === 'bairro' && zones().length;
  const bairro = byZone ? co.zone.value : co.bairro.value.trim();
  const addr = ent ? `${co.rua.value.trim()}, ${co.num.value.trim()} — ${bairro}${co.comp.value.trim() ? ' (' + co.comp.value.trim() + ')' : ''}` : null;
  const troco = co.pag.value === 'dinheiro' ? parseFloat(co.troco.value.replace(',', '.')) : NaN;
  const btn = $('#confirm'); btn.disabled = true;
  try { localStorage.setItem('bora-cliente', JSON.stringify({ nome: co.nome.value.trim(), tel: co.tel.value, rua: co.rua.value, num: co.num.value, bairro: byZone ? '' : co.bairro.value, zone: byZone ? co.zone.value : '', comp: co.comp.value })); } catch (_) {}
  const obs = [R.allow_notes === false && !MESA ? '' : co.obs.value.trim(), !MESA && R.ask_cutlery ? (co.cutlery.checked ? 'Mandar talheres e guardanapos' : 'Sem talheres') : ''].filter(Boolean).join(' · ').slice(0, 300);
  const customer = MESA ? { table: MESA.token, name: co.nome.value.trim(), phone: co.tel.value, notes: obs }
    : { name: co.nome.value.trim(), phone: co.tel.value, mode: modo(), address: addr, payment: co.pag.value, change_for: Number.isFinite(troco) ? String(troco) : '', notes: obs };
  if (!MESA && CP) customer.coupon = CP.code;
  if (when) customer.scheduled_for = when;
  if (!MESA && LOY.useReward && LOY.rewards > 0) customer.use_reward = 'true';
  if (!MESA && CB.use && !CP && Number(CB.balance) > 0) customer.use_cashback = 'true';
  if (ent && byZone) customer.zone = co.zone.value;
  if (ent && GEO) { customer.lat = GEO.lat.toFixed(6); customer.lng = GEO.lng.toFixed(6); }
  const { data, error } = await sb.rpc('place_order', {
    p_slug: slug, p_customer: customer,
    p_items: cart.map((l) => ({ product_id: l.pid, qty: l.qty, note: l.note, options: l.opts || [] })),
  });
  btn.disabled = false;
  if (error) { $('#co-err').textContent = (error.message || 'Não foi possível enviar o pedido.').replace(/^.*?:\s*/, ''); return; }
  const order = { ...data, cart: cart.map((l) => ({ pid: l.pid, qty: l.qty, note: l.note || '', opts: l.opts || [] })), scheduled_for: data.scheduled_for || when || null, ts: Date.now(), customer: co.nome.value.trim(), phone: co.tel.value, mode: MESA ? 'mesa' : modo(), mesa: MESA ? mesaTxt() : null, address: addr, payment: MESA ? 'mesa' : co.pag.value, change_for: troco, notes: co.obs.value.trim() };
  CP = null; LOY.useReward = false; CB.use = false; CB.balance = 0; $('#c-cupom').value = '';
  try { localStorage.setItem(LAST, data.public_id); localStorage.setItem('bora-order-' + data.public_id, JSON.stringify(order)); } catch (_) {}
  location.hash = 'pedido';
  if (data.status === 'pagamento') { showPay(data.public_id, order); return; }
  cart = []; persist(); renderCart();
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
  if (order.status === 'pagamento') { showPay(publicId, order); return; }
  go('track');
  $('#t-num').textContent = `Pedido #${order.number}`;
  $('#t-items').innerHTML = (order.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}${i.note ? ` <small style="color:var(--muted-2)">(${esc(i.note)})</small>` : ''}</span><span class="price">${brl(i.price * i.qty)}</span></div>`).join('')
    + (order.mode === 'entrega' ? `<div><span>Entrega${order.delivery_info ? ` <small>${esc(order.delivery_info)}</small>` : ''}</span><span class="price">${Number(order.fee) > 0 ? brl(order.fee) : 'Grátis'}</span></div>` : '')
    + (Number(order.discount) > 0 ? `<div class="disc"><span>Desconto</span><span class="price">− ${brl(order.discount)}</span></div>` : '')
    + `<div style="font-weight:800"><span style="color:var(--ink)">${order.mode === 'mesa' ? 'Total deste pedido (pague na conta da mesa)' : 'Total'}</span><span class="price">${brl(order.total)}</span></div>`;
  renderPix(order, publicId);
  const wa = (R.whatsapp || '').replace(/\D/g, '');
  const waBtn = $('#t-wa');
  waBtn.hidden = !wa || order.mode === 'mesa';
  if (wa) waBtn.href = `https://wa.me/${waNum(wa)}?text=${encodeURIComponent(waText(order))}`;
  const ent = order.mode === 'entrega', mesa = order.mode === 'mesa';
  const STEPS = [['novo', 'Pedido enviado', mesa ? `A cozinha já recebeu o pedido${order.mesa ? ` (${/^(Mesa|Comanda) /.test(order.mesa) ? order.mesa : 'Mesa ' + order.mesa})` : ''}.` : 'A loja já recebeu seu pedido.'], ['preparo', 'Em preparo', 'Seu pedido está sendo feito.'],
    ent ? ['saiu', 'Saiu para entrega', 'O entregador está a caminho.'] : mesa ? ['pronto', 'Pronto', 'Já já chega na sua mesa.'] : ['pronto', 'Pronto para retirar', 'Pode vir buscar no balcão.'],
    ['entregue', ent ? 'Entregue' : mesa ? 'Servido' : 'Retirado', 'Bom apetite!']];
  $('#again').textContent = mesa ? 'Pedir mais alguma coisa' : 'Fazer outro pedido';
  const ORDER = { novo: 0, preparo: 1, pronto: 2, saiu: 2, entregue: 3 };
  let lastSt = null;
  const render = (st) => {
    $('#t-game').hidden = !GAME.on || st === 'entregue' || st === 'cancelado';
    if (lastSt && st !== lastSt && window.BoraJogo && window.BoraJogo.isOpen()) {
      const k2 = st === 'cancelado' ? -1 : ent && st === 'pronto' ? 1 : ORDER[st] ?? 0;
      window.BoraJogo.notify(st === 'cancelado' ? '⚠️ Seu pedido foi cancelado' : st === 'entregue' ? '😋 Pedido entregue! Bom apetite' : st === 'saiu' ? '🛵 Seu pedido saiu para entrega!' : `🔔 ${STEPS[k2][1]}`);
    }
    lastSt = st;
    if (st === 'cancelado') {
      $('#t-title').textContent = 'Pedido cancelado'; $('#t-sub').textContent = 'Fale com a loja pelo WhatsApp se tiver dúvidas.';
      $('#steps').innerHTML = ''; return true;
    }
    const k = ent && st === 'pronto' ? 1 : ORDER[st] ?? 0;
    $('#t-title').textContent = STEPS[k][1] + (k === 0 ? '!' : '');
    $('#t-sub').textContent = ent && st === 'pronto' ? 'Pronto! Esperando o entregador sair.' : STEPS[k][2];
    if (order.scheduled_for && k === 0) {
      const d = new Date(order.scheduled_for);
      $('#t-title').textContent = 'Pedido agendado!';
      $('#t-sub').textContent = `Para ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}. A loja já recebeu.`;
    }
    $('#steps').innerHTML = STEPS.map((s, i) => `<li class="${i < k ? 'done' : i === k ? 'now done' : ''}"><span class="dot">${i <= k ? '<svg width="16" height="16"><use href="#i-check"/></svg>' : ''}</span><div><b>${s[1]}</b><small>${s[2]}</small></div></li>`).join('');
    if (st === 'entregue') showRate(publicId);
    return st === 'entregue';
  };
  GAME.id = publicId; gameInfo();
  render('novo');
  clearInterval(poll); clearTimeout(poll); live(null);
  const tick = async () => {
    let data = null;
    try { ({ data } = await sb.rpc('order_status', { p_public_id: publicId })); } catch (_) {}
    if (data && order.payment === 'pix' && R.pix_key) { const el = $('#t-pix'); el.hidden = false; el.className = 'pix-state ok'; el.textContent = 'Pagamento Pix confirmado ✓'; }
    if (data) { order.status = data.status; saveOrder(publicId, order); }
    live(data && data.status === 'saiu' ? data : null);
    if (data && render(data.status)) return;
    if ($('#v-track').hidden) return;
    // em rota: atualiza mais rápido para o motoboy andar no mapa
    poll = setTimeout(tick, data && data.status === 'saiu' ? (document.hidden ? 20000 : 5000) : 15000);
  };
  tick();
}
/* ---------- avaliação do pedido ---------- */
async function showRate(publicId) {
  const box = $('#t-rate'); if (!box || box.dataset.id === publicId) return;
  box.dataset.id = publicId; box.hidden = true;
  let done = null; try { done = JSON.parse(localStorage.getItem('bora-rated-' + publicId) || 'null'); } catch (_) {}
  if (!done) { try { const { data } = await sb.rpc('order_rated', { p_public_id: publicId }); done = data; } catch (_) {} }
  box.hidden = false;
  if (done) { box.innerHTML = `<h2>Obrigado pela avaliação!</h2><p class="rate-stars done" aria-label="${done.stars} de 5 estrelas">${'★'.repeat(done.stars)}${'☆'.repeat(5 - done.stars)}</p>`; return; }
  let stars = 0;
  box.innerHTML = `<h2>Como foi o seu pedido?</h2><p class="rate-hint">Sua opinião ajuda a ${esc(R.name)} a melhorar.</p>
    <div class="rate-stars" role="radiogroup" aria-label="Nota de 1 a 5">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" data-star="${n}" aria-label="${n} estrela${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
    <textarea id="rate-txt" rows="2" maxlength="500" placeholder="Quer contar algo? (opcional)" hidden></textarea>
    <p class="err" id="rate-err"></p>
    <button class="btn btn-primary btn-block" type="button" id="rate-send" hidden>Enviar avaliação</button>`;
  box.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => {
    stars = +b.dataset.star;
    box.querySelectorAll('[data-star]').forEach((x) => { const on = +x.dataset.star <= stars; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(+x.dataset.star === stars)); });
    $('#rate-txt').hidden = false; $('#rate-send').hidden = false;
    $('#rate-txt').placeholder = stars <= 3 ? 'O que podemos melhorar?' : 'Quer deixar um elogio? (opcional)';
  }));
  $('#rate-send').onclick = async () => {
    const b = $('#rate-send'); b.disabled = true;
    const { error } = await sb.rpc('rate_order', { p_public_id: publicId, p_stars: stars, p_comment: $('#rate-txt').value.trim() || null });
    b.disabled = false;
    if (error && !/já foi avaliado/.test(error.message || '')) { $('#rate-err').textContent = (error.message || 'Não foi possível enviar.').replace(/^.*?:\s*/, ''); return; }
    try { localStorage.setItem('bora-rated-' + publicId, JSON.stringify({ stars })); } catch (_) {}
    box.dataset.id = ''; showRate(publicId); toast('Obrigado! Sua avaliação foi enviada.');
  };
}

/* ---------- motoboy ao vivo no mapa ---------- */
let LIVE = null;
async function live(d) {
  const box = $('#t-live');
  if (!d || (!d.courier && !d.dest)) { box.hidden = true; return; }
  const c = d.courier || {};
  const has = Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const dest = window.BoraMapa ? window.BoraMapa.parse(d.dest) : null;
  if (!has && !dest) { box.hidden = true; return; }
  box.hidden = false;
  const ago = has && c.at ? Math.max(0, Math.round((Date.now() - new Date(c.at)) / 1000)) : null;
  const stale = ago !== null && ago > 120;
  const st = $('#t-live-st');
  st.textContent = has && !stale ? 'Ao vivo' : 'Sem sinal agora';
  st.classList.toggle('off', !has || stale);
  const who = c.name ? `<b>${esc(c.name)}</b>` : 'O motoboy';
  $('#t-live-txt').innerHTML = has
    ? `${who} está a caminho${dest ? ` · cerca de <b>${km(c, dest)}</b> do seu endereço` : ''}. ${stale ? `Última posição há ${Math.round(ago / 60)} min.` : 'Atualiza sozinho.'}`
    : `${who} já saiu com o seu pedido. A posição aparece aqui assim que o GPS dele conectar.`;
  try {
    if (!LIVE) LIVE = await window.BoraMapa.create($('#t-map'));
    LIVE.resize();
    LIVE.set({ store: d.store, dest, couriers: has ? [{ id: 'c', lat: c.lat, lng: c.lng, name: c.name, stale }] : [] });
  } catch (_) { $('#t-map').hidden = true; }
}
function km(a, b) {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  const m = 2 * 6371e3 * Math.asin(Math.sqrt(h));
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}
/* ---------- Pix: pagar primeiro; quando o pagamento é confirmado, a tela muda sozinha ---------- */
function renderPix() { $('#t-pix').hidden = true; }
let PAYING = null, payPoll = null;
const saveOrder = (id, o) => { try { localStorage.setItem('bora-order-' + id, JSON.stringify(o)); } catch (_) {} };
function staticPix(publicId, order) {
  return window.BoraPix.payload({
    key: R.pix_key, name: R.pix_name, city: R.pix_city || 'BRASIL', amount: Number(order.total),
    txid: `BL${String(publicId).replace(/[^a-z0-9]/gi, '').slice(0, 16)}`, info: `Pedido ${R.name}`,
  });
}
async function showPay(publicId, order) {
  clearInterval(poll); clearInterval(payPoll);
  PAYING = { publicId, order, mode: 'manual' };
  go('pay');
  $('#pay-err').textContent = '';
  $('#p-amount').textContent = brl(order.total);
  $('#p-items').innerHTML = (order.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}</span><span class="price">${brl(i.price * i.qty)}</span></div>`).join('')
    + (order.mode === 'entrega' ? `<div><span>Entrega</span><span class="price">${Number(order.fee) > 0 ? brl(order.fee) : 'Grátis'}</span></div>` : '')
    + (Number(order.discount) > 0 ? `<div class="disc"><span>Desconto</span><span class="price">− ${brl(order.discount)}</span></div>` : '')
    + `<div style="font-weight:800"><span style="color:var(--ink)">Total</span><span class="price">${brl(order.total)}</span></div>`;
  $('#p-qr').innerHTML = '<span class="spin" aria-label="Gerando o Pix"></span>'; $('#p-copy').disabled = true; $('#p-code').textContent = '';
  // loja com Mercado Pago conectado: Pix gerado por lá (confirmação automática)
  let code = null, mode = 'manual';
  if (R.pix_auto && sb.functions) {
    try {
      const { data } = await sb.functions.invoke('pix', { body: { action: 'create', public_id: publicId } });
      if (data && data.status && data.status !== 'pagamento') { paidDone(publicId, order, data.status); return; }
      if (data && data.mode === 'auto' && data.qr_code) { mode = 'auto'; code = data.qr_code; }
    } catch (_) {}
  }
  if (!PAYING || PAYING.publicId !== publicId) return;
  if (!code) code = staticPix(publicId, order);
  PAYING.mode = mode;
  $('#p-qr').innerHTML = window.BoraQR.svg(code, { label: 'QR Code Pix do pedido', color: '#1A1112' });
  $('#p-code').textContent = code; $('#p-copy').disabled = false;
  $('#p-to').innerHTML = `Você vai pagar para <b>${esc(R.pix_name || R.name)}</b>${R.pix_bank && mode === 'manual' ? ` · ${esc(R.pix_bank)}` : ''}.`;
  $('#p-wait-text').textContent = mode === 'auto'
    ? 'Assim que o Pix for aprovado, esta tela muda sozinha e o pedido vai direto para a loja.'
    : 'Assim que a loja confirmar o recebimento do Pix, esta tela muda sozinha.';
  const tick = async () => {
    if (!PAYING || PAYING.publicId !== publicId) { clearInterval(payPoll); return; }
    let st = null;
    try {
      if (PAYING.mode === 'auto') { const { data } = await sb.functions.invoke('pix', { body: { action: 'status', public_id: publicId } }); st = data && data.status; }
      else { const { data } = await sb.rpc('order_status', { p_public_id: publicId }); st = data && data.status; }
    } catch (_) {}
    if (st && st !== 'pagamento' && PAYING && PAYING.publicId === publicId) paidDone(publicId, PAYING.order, st);
  };
  payPoll = setInterval(tick, 4000);
}
async function paidDone(publicId, order, st) {
  clearInterval(payPoll); PAYING = null;
  if (st === 'cancelado') {
    try { localStorage.removeItem(LAST); localStorage.removeItem('bora-order-' + publicId); } catch (_) {}
    toast('A loja cancelou este pedido. Fale com ela pelo WhatsApp se tiver dúvidas.');
    go('menu'); renderResume(); return;
  }
  const { data } = await sb.rpc('order_status', { p_public_id: publicId });
  const done = { ...order, status: (data && data.status) || st, number: (data && data.number) || order.number, paid: true };
  saveOrder(publicId, done);
  cart = []; persist(); renderCart();
  toast('Pagamento confirmado! Seu pedido foi enviado para a loja.');
  showTrack(publicId, done);
}
$('#p-copy').addEventListener('click', async () => {
  const code = $('#p-code').textContent;
  try { await navigator.clipboard.writeText(code); toast('Código Pix copiado! Cole no app do banco em Pix › Copia e cola.'); $('#p-copy').textContent = 'Código copiado ✓'; setTimeout(() => { $('#p-copy').textContent = 'Copiar código Pix'; }, 3000); }
  catch (_) { $('#v-pay .pix-code').open = true; toast('Toque e segure o código abaixo para copiar.'); }
});
$('#pay-back').addEventListener('click', async () => {
  if (PAYING) {
    const id = PAYING.publicId; clearInterval(payPoll); PAYING = null;
    await sb.rpc('cancel_pending_order', { p_public_id: id });
    try { localStorage.removeItem(LAST); localStorage.removeItem('bora-order-' + id); } catch (_) {}
  }
  history.replaceState(null, '', location.pathname + location.search);
  go('checkout');
});

/* ---------- botão Início e aviso de pedido em andamento ---------- */
function renderResume() {
  const b = $('#resume'); b.hidden = true;
  let id = null, o = null;
  try { id = localStorage.getItem(LAST); o = id && JSON.parse(localStorage.getItem('bora-order-' + id) || 'null'); } catch (_) {}
  if (!o || ['entregue', 'cancelado'].includes(o.status) || Date.now() - (o.ts || Date.now()) > 12 * 3600e3) return;
  $('#resume-txt').textContent = o.status === 'pagamento' ? `Seu pedido de ${brl(o.total)} está esperando o pagamento.` : `Pedido #${o.number} em andamento.`;
  b.hidden = false; b.onclick = () => { location.hash = 'pedido'; showTrack(id); };
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-home]')) return;
  clearInterval(payPoll); clearInterval(poll); PAYING = null;
  history.replaceState(null, '', location.pathname + location.search);
  go('menu'); renderResume();
});
$('#again').addEventListener('click', () => { clearInterval(poll); history.replaceState(null, '', location.pathname + location.search); go('menu'); renderResume(); });

/* ---------- chat com a loja (caixa de entrada única, planos Profissional e Completo) ---------- */
let CHAT = null, chatPoll = null, chatSeen = 0;
const dChat = $('#d-chat');
function initChat() {
  CHAT = { token: localStorage.getItem('bora-chat-' + slug), msgs: [] };
  try { chatSeen = +localStorage.getItem('bora-chat-seen-' + slug) || 0; } catch (_) {}
  $('#chat-btn').hidden = false; $('#ch-title').textContent = `Fale com ${R.name}`;
  if (CHAT.token) { fetchChat(); setInterval(() => { if (!dChat.open && !document.hidden) fetchChat(); }, 45000); }
}
async function fetchChat() {
  if (!CHAT || !CHAT.token) return;
  const { data } = await sb.rpc('site_chat_fetch', { p_token: CHAT.token });
  CHAT.msgs = data || []; renderChat();
}
function renderChat() {
  const box = $('#ch-msgs');
  box.innerHTML = CHAT.msgs.length ? CHAT.msgs.map((m) => `<div class="cm ${m.sender === 'loja' ? 'in' : 'out'}">${esc(m.body).replace(/\n/g, '<br>')}<small>${new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
    : `<p class="chat-hello">Olá! 👋 Mande sua dúvida sobre o cardápio, entrega ou um pedido. A ${esc(R.name)} responde por aqui.</p>`;
  box.scrollTop = box.scrollHeight;
  $('#ch-who').hidden = !!CHAT.token;
  const fromStore = CHAT.msgs.filter((m) => m.sender === 'loja').length;
  if (dChat.open) { chatSeen = fromStore; try { localStorage.setItem('bora-chat-seen-' + slug, chatSeen); } catch (_) {} }
  $('#chat-dot').hidden = fromStore <= chatSeen;
}
$('#chat-btn').addEventListener('click', () => {
  try { const s = JSON.parse(localStorage.getItem('bora-cliente') || '{}'); if (s.nome && !$('#ch-name').value) $('#ch-name').value = s.nome; if (s.tel && !$('#ch-tel').value) $('#ch-tel').value = s.tel; } catch (_) {}
  renderChat(); dChat.showModal(); fetchChat();
  clearInterval(chatPoll); chatPoll = setInterval(() => { if (dChat.open) fetchChat(); else clearInterval(chatPoll); }, 5000);
});
dChat.addEventListener('click', (e) => { if (e.target === dChat || e.target.closest('[data-chclose]')) dChat.close(); });
$('#ch-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#ch-err').textContent = '';
  const body = $('#ch-text').value.trim(); if (!body) return;
  if (!CHAT.token && !$('#ch-name').value.trim()) { $('#ch-err').textContent = 'Escreva seu nome para a loja saber quem é.'; $('#ch-name').focus(); return; }
  const token = CHAT.token || (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const b = $('#ch-form [type=submit]'); b.disabled = true;
  const { data, error } = await sb.rpc('site_chat_send', { p_slug: slug, p_token: token, p_name: $('#ch-name').value.trim(), p_phone: $('#ch-tel').value.trim(), p_body: body });
  b.disabled = false;
  if (error) { $('#ch-err').textContent = (error.message || 'Não foi possível enviar.').replace(/^.*?:\s*/, ''); return; }
  if (!CHAT.token) { CHAT.token = token; try { localStorage.setItem('bora-chat-' + slug, token); } catch (_) {} }
  $('#ch-text').value = ''; CHAT.msgs = data || []; renderChat();
});
$('#ch-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ch-form').requestSubmit(); } });

load();

/* ---------- joguinho enquanto espera (assets/jogo.js, carrega só quando o cliente toca em Jogar) ---------- */
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
function gameWon(r) { // guarda o cupom ganho para mostrar no cartão
  const el = $('#t-game-won'); let w = r;
  if (!w) { try { w = JSON.parse(localStorage.getItem('bora-jogo-cupom-' + GAME.id) || 'null'); } catch (_) {} }
  else { try { localStorage.setItem('bora-jogo-cupom-' + GAME.id, JSON.stringify(w)); } catch (_) {} }
  el.hidden = !w; if (w) el.innerHTML = `🎁 Seu cupom de prêmio: <b>${esc(w.code)}</b>`;
}
async function gameInfo() {
  let d = null; try { ({ data: d } = await sb.rpc('game_ranking', { p_slug: R.slug })); } catch (_) {}
  if (d && d.enabled === false) { GAME.on = false; $('#t-game').hidden = true; return; }
  GAME.on = true; GAME.rule = d ? d.rule : null; GAME.top = (d && d.top) || [];
  const pz = $('#t-game-prize'), ld = $('#t-game-lead');
  pz.hidden = !GAME.rule; if (GAME.rule) pz.innerHTML = `🎁 Faça <b>${fmtN(GAME.rule.score)}</b> pontos e ganhe <b>${esc(GAME.rule.label)}</b> no próximo pedido`;
  ld.hidden = !GAME.top.length; if (GAME.top.length) ld.textContent = `🏆 Líder de hoje: ${GAME.top[0].name} · ${fmtN(GAME.top[0].score)} pontos`;
  gameWon(null);
}
$('#t-play').addEventListener('click', () => {
  const go2 = () => window.BoraJogo.open({
    store: R && R.name, rule: GAME.rule, top: GAME.top,
    onEnd: async (score) => {
      if (!GAME.id) return null;
      const { data, error } = await sb.rpc('game_submit', { p_public_id: GAME.id, p_score: Math.round(score) });
      if (error) return null;
      GAME.top = data.top || GAME.top; if (data.reward) gameWon(data.reward);
      gameInfo();
      return data;
    },
  });
  if (window.BoraJogo) return go2();
  const b = $('#t-play'); b.disabled = true;
  const sc = document.createElement('script'); sc.charset = 'utf-8'; sc.src = '/assets/jogo.js?v=2';
  sc.onload = () => { b.disabled = false; go2(); };
  sc.onerror = () => { b.disabled = false; toast('Não foi possível abrir o jogo agora.'); };
  document.head.appendChild(sc);
});
