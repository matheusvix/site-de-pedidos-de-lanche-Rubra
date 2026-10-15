/* ============================================================
   BoraLanchar! — cardápio público de cada restaurante
   Endereço: /l/<link-da-loja>  ou  /loja.html?r=<link-da-loja>
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const slug = (new URLSearchParams(location.search).get('r') || (location.pathname.match(/\/l\/([a-z0-9-]+)/) || [])[1] || '').toLowerCase();
const KEY = 'bora-cart-' + slug;
const LAST = 'bora-last-' + slug;

let R = null;             // restaurante
let CATS = [];            // categorias com produtos
let P = {};               // produtos por id
let cart = [];            // [{pid, qty, note}]
let sellable = false;

const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200); }
function state(title, text) { $('#st-title').textContent = title; $('#st-text').textContent = text || ''; $('#v-state').hidden = false; $('#v-menu').hidden = true; }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (_) {} }

async function load() {
  if (!slug) return state('Cardápio não encontrado', 'Confira o link que a loja enviou para você.');
  if (!sb) return state('Cardápio indisponível', 'Tente novamente em instantes.');
  const { data: r, error } = await sb.from('restaurants').select('*').eq('slug', slug).maybeSingle();
  if (error || !r) return state('Cardápio não encontrado', 'Confira o link que a loja enviou para você.');
  R = r;
  sellable = r.status === 'ativo' || (r.status === 'teste' && new Date(r.trial_ends_at) > new Date());
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categories').select('*').eq('restaurant_id', r.id).order('position').order('id'),
    sb.from('products').select('*').eq('restaurant_id', r.id).order('position').order('id'),
  ]);
  P = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  CATS = (cats || []).map((c) => ({ ...c, items: (prods || []).filter((p) => p.category_id === c.id) }));
  const loose = (prods || []).filter((p) => !p.category_id || !cats.some((c) => c.id === p.category_id));
  if (loose.length) CATS.push({ id: 0, name: 'Outros', items: loose });
  CATS = CATS.filter((c) => c.items.length);
  try { cart = (JSON.parse(localStorage.getItem(KEY) || '[]') || []).filter((l) => P[l.pid] && P[l.pid].available); } catch (_) { cart = []; }

  document.title = `${r.name} · Cardápio digital`;
  if (!sellable) return state(`${r.name}`, 'Este cardápio está temporariamente indisponível. Fale direto com a loja.');
  renderHeader();
  renderMenu();
  renderCart();
  $('#v-state').hidden = true; $('#v-menu').hidden = false;

  // pedido anterior em andamento?
  const last = localStorage.getItem(LAST);
  if (last && location.hash === '#pedido') showTrack(last);
}

function renderHeader() {
  $('#s-ini').textContent = R.name.trim().charAt(0).toUpperCase();
  $('#s-name').textContent = R.name;
  const meta = [];
  meta.push(R.is_open ? '<span class="open">Aberto agora</span>' : '<span class="closed">Fechado agora</span>');
  if (R.accepts_delivery) meta.push(`<span>Entrega ${esc(R.delivery_time)}</span>`);
  if (R.accepts_delivery) meta.push(`<span>Taxa ${Number(R.delivery_fee) > 0 ? brl(R.delivery_fee) : 'grátis'}</span>`);
  if (R.hours) meta.push(`<span>${esc(R.hours)}</span>`);
  $('#s-meta').innerHTML = meta.join('');
  const tags = [];
  if (Number(R.min_order) > 0) tags.push(`<span class="chip">Pedido mínimo ${brl(R.min_order)}</span>`);
  if (R.accepts_pickup) tags.push('<span class="chip">Retirada no balcão</span>');
  if (R.segment) tags.push(`<span class="chip">${esc(R.segment)}</span>`);
  $('#s-tags').innerHTML = tags.join('');
  const n = $('#s-notice');
  if (!R.is_open) { n.hidden = false; n.textContent = 'A loja está fechada agora. Você pode olhar o cardápio, mas os pedidos voltam quando ela abrir.'; }
}

function thumb(p, big) {
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
            <div class="prod-foot"><span class="price">${brl(i.price)}</span>${i.available ? '' : '<span class="badge">Esgotado</span>'}</div></div>
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

/* ---------- produto ---------- */
const dProd = $('#d-prod');
let cur = null;
function openProduct(id) {
  const p = P[id]; if (!p) return;
  cur = { id, qty: 1 };
  $('#pd-form').innerHTML = `
    <div class="pd-hero ${p.image_url ? 'has-photo' : ''}" style="background:var(--red-soft)">
      ${p.image_url ? `<img class="pd-blur" src="${esc(p.image_url)}" alt=""><img class="pd-photo" src="${esc(p.image_url)}" alt="">` : `<span class="thumb ph" style="width:120px;height:120px;font-size:56px;border-radius:28px">${esc(p.name.charAt(0))}</span>`}
      <button class="x" type="button" data-close aria-label="Fechar"><svg width="20" height="20"><use href="#i-x"/></svg></button>
    </div>
    <div class="pd-body">
      <div><h2 id="pd-title">${esc(p.name)}</h2>${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ''}</div>
      <div class="field"><label for="pd-obs" style="font-weight:700">Alguma observação?</label><textarea id="pd-obs" maxlength="140" placeholder="Ex.: sem cebola, ponto da carne…"></textarea></div>
    </div>
    <div class="pd-foot">
      <div class="qty"><button type="button" data-q="-1" aria-label="Diminuir">−</button><span id="pd-qty">1</span><button type="button" data-q="1" aria-label="Aumentar">+</button></div>
      <button class="btn btn-primary" type="button" id="pd-add"><span>Adicionar</span><span class="price" id="pd-total">${brl(p.price)}</span></button>
    </div>`;
  dProd.showModal();
}
dProd.addEventListener('click', (e) => {
  if (e.target === dProd || e.target.closest('[data-close]')) { dProd.close(); return; }
  const q = e.target.closest('[data-q]');
  if (q) { cur.qty = Math.max(1, Math.min(50, cur.qty + +q.dataset.q)); $('#pd-qty').textContent = cur.qty; $('#pd-total').textContent = brl(P[cur.id].price * cur.qty); return; }
  if (e.target.closest('#pd-add')) {
    const note = $('#pd-obs').value.trim();
    const same = cart.find((l) => l.pid === cur.id && l.note === note);
    if (same) same.qty = Math.min(50, same.qty + cur.qty); else cart.push({ pid: cur.id, qty: cur.qty, note });
    persist(); renderCart(); dProd.close(); toast(`${P[cur.id].name} na sacola`);
  }
});

/* ---------- sacola ---------- */
function totals(modo = 'entrega') {
  const sub = cart.reduce((s, l) => s + Number(P[l.pid].price) * l.qty, 0);
  const fee = modo === 'entrega' && sub > 0 && R.accepts_delivery ? Number(R.delivery_fee) : 0;
  return { sub, fee, total: sub + fee, count: cart.reduce((s, l) => s + l.qty, 0) };
}
function cartHTML() {
  const t = totals();
  if (!cart.length) return `<div class="cart-head"><h2>Sua sacola</h2></div><div class="cart-body"><div class="cart-empty"><svg width="34" height="34"><use href="#i-bag"/></svg><b>Sacola vazia</b><span>Escolha algo no cardápio para começar.</span></div></div>`;
  const min = Number(R.min_order);
  return `<div class="cart-head"><h2>Sua sacola</h2><button class="link" type="button" data-clear>Limpar</button></div>
    <div class="cart-body">${cart.map((l, i) => `<div class="line"><div class="line-info"><b>${esc(P[l.pid].name)}</b>${l.note ? `<small>Obs.: ${esc(l.note)}</small>` : ''}
      <div class="qty"><button type="button" data-l="${i}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button type="button" data-l="${i}" data-d="1" aria-label="Mais">+</button></div></div>
      <span class="line-price">${brl(P[l.pid].price * l.qty)}</span></div>`).join('')}</div>
    <div class="cart-foot">
      ${min > 0 && t.sub < min ? `<div class="progress">Faltam ${brl(min - t.sub)} para o pedido mínimo<i style="--p:${Math.min(100, t.sub / min * 100)}%"></i></div>` : ''}
      <div class="sum"><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>
      ${R.accepts_delivery ? `<div class="sum"><span>Taxa de entrega</span><span class="price">${Number(R.delivery_fee) > 0 ? brl(R.delivery_fee) : 'Grátis'}</span></div>` : ''}
      <div class="sum total"><span>Total</span><span class="price">${brl(t.total)}</span></div>
      <button class="btn btn-primary btn-block" type="button" data-checkout ${!R.is_open || (min > 0 && t.sub < min) ? 'disabled' : ''}>${R.is_open ? 'Continuar' : 'Loja fechada agora'}</button>
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
  $('#m-ent').textContent = `${R.delivery_time} · ${Number(R.delivery_fee) > 0 ? brl(R.delivery_fee) : 'grátis'}`;
  $('#ret-end').textContent = R.address ? `Retire em: ${R.address}` : 'A loja combina o local de retirada pelo WhatsApp.';
  try { const s = JSON.parse(localStorage.getItem('bora-cliente') || '{}'); ['nome', 'tel', 'rua', 'num', 'bairro', 'comp'].forEach((k) => { if (s[k] && !co[k].value) co[k].value = s[k]; }); } catch (_) {}
  syncCheckout();
}
function syncCheckout() {
  const ent = modo() === 'entrega';
  $('#box-end').hidden = !ent; $('#box-ret').hidden = ent;
  $$('#box-end input[required]').forEach((i) => { i.disabled = !ent; });
  $('#pag-cartao').textContent = ent ? 'Na entrega, na maquininha' : 'Na retirada, na maquininha';
  $('#pag-din').textContent = ent ? 'Na entrega' : 'Na retirada';
  $('#box-troco').hidden = co.pag.value !== 'dinheiro';
  const t = totals(modo());
  $('#resumo').innerHTML = cart.map((l) => `<div><span>${l.qty}× ${esc(P[l.pid].name)}</span><span class="price">${brl(P[l.pid].price * l.qty)}</span></div>`).join('')
    + `<div><span>Subtotal</span><span class="price">${brl(t.sub)}</span></div>`
    + (ent ? `<div><span>Taxa de entrega</span><span class="price">${t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : '')
    + `<div style="font-weight:800;font-size:16px"><span style="color:var(--ink)">Total</span><span class="price">${brl(t.total)}</span></div>`;
  $('#confirm-total').textContent = brl(t.total);
}
co.addEventListener('change', syncCheckout);
co.tel.addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 11);
  e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
});
co.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#co-err').textContent = '';
  let bad = null;
  $$('input[required]', co).forEach((i) => {
    if (i.disabled) return;
    const v = i.value.trim();
    const msg = !v ? 'Campo obrigatório.' : (i.name === 'tel' && v.replace(/\D/g, '').length < 10 ? 'Informe um WhatsApp com DDD.' : '');
    i.parentElement.querySelector('.err').textContent = msg;
    if (msg && !bad) bad = i;
  });
  if (bad) { bad.focus(); return; }
  if (!cart.length) { go('menu'); return; }
  const ent = modo() === 'entrega';
  const addr = ent ? `${co.rua.value.trim()}, ${co.num.value.trim()} — ${co.bairro.value.trim()}${co.comp.value.trim() ? ' (' + co.comp.value.trim() + ')' : ''}` : null;
  const troco = co.pag.value === 'dinheiro' ? parseFloat(co.troco.value.replace(',', '.')) : NaN;
  const btn = $('#confirm'); btn.disabled = true;
  try { localStorage.setItem('bora-cliente', JSON.stringify({ nome: co.nome.value.trim(), tel: co.tel.value, rua: co.rua.value, num: co.num.value, bairro: co.bairro.value, comp: co.comp.value })); } catch (_) {}
  const { data, error } = await sb.rpc('place_order', {
    p_slug: slug,
    p_customer: { name: co.nome.value.trim(), phone: co.tel.value, mode: modo(), address: addr, payment: co.pag.value, change_for: Number.isFinite(troco) ? String(troco) : '', notes: co.obs.value.trim() },
    p_items: cart.map((l) => ({ product_id: l.pid, qty: l.qty, note: l.note })),
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
const PAG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
let poll = null;
function waText(o) {
  const lines = (o.items || []).map((i) => `• ${i.qty}× ${i.name} — ${brl(i.price * i.qty)}${i.note ? `\n   Obs.: ${i.note}` : ''}`).join('\n');
  return `*Pedido #${o.number}* — ${R.name}\n\n${lines}\n\nSubtotal: ${brl(o.subtotal)}${o.mode === 'entrega' ? `\nEntrega: ${Number(o.fee) > 0 ? brl(o.fee) : 'grátis'}` : ''}\n*Total: ${brl(o.total)}*\n\n`
    + `Cliente: ${o.customer} · ${o.phone}\n${o.mode === 'entrega' ? `Entregar em: ${o.address}` : 'Vou retirar no balcão'}\nPagamento: ${PAG[o.payment] || o.payment}${o.payment === 'dinheiro' && Number.isFinite(o.change_for) ? ` (troco para ${brl(o.change_for)})` : ''}${o.notes ? `\nObs.: ${o.notes}` : ''}`;
}
async function showTrack(publicId, order) {
  if (!order) { try { order = JSON.parse(localStorage.getItem('bora-order-' + publicId) || 'null'); } catch (_) {} }
  if (!order) return;
  go('track');
  $('#t-num').textContent = `Pedido #${order.number}`;
  $('#t-items').innerHTML = (order.items || []).map((i) => `<div><span>${i.qty}× ${esc(i.name)}${i.note ? ` <small style="color:var(--muted-2)">(${esc(i.note)})</small>` : ''}</span><span class="price">${brl(i.price * i.qty)}</span></div>`).join('')
    + `<div style="font-weight:800"><span style="color:var(--ink)">Total</span><span class="price">${brl(order.total)}</span></div>`;
  const wa = (R.whatsapp || '').replace(/\D/g, '');
  const waBtn = $('#t-wa');
  waBtn.hidden = !wa;
  if (wa) waBtn.href = `https://wa.me/${wa.length <= 11 ? '55' + wa : wa}?text=${encodeURIComponent(waText(order))}`;
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
$('#again').addEventListener('click', () => { clearInterval(poll); history.replaceState(null, '', location.pathname + location.search); go('menu'); });

load();
