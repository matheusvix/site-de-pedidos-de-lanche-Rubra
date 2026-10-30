/* ============================================================
   BoraLanchar! — app do garçom (plano Completo)
   Endereço: /garcom.html?loja=<link-da-loja>
   O garçom entra com o PIN, vê as mesas, lança pedidos e fecha a conta.
   Banco: funções waiter_* em supabase/recursos-planos.sql
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
const slug = (new URLSearchParams(location.search).get('loja') || '').toLowerCase();
const SKEY = 'bora-garcom-' + slug;

let S = null;            // sessão {token, name, restaurant}
let TABLES = [], TABLE = null, CATS = [], P = {}, cart = [], tick = null, KIND = 'mesa', RS = { service_pct: 10, couvert: 0 };
const tName = (t) => { const k = t.kind === 'comanda' ? 'Comanda' : 'Mesa'; const l = String(t.label || '').trim(); return new RegExp(`^${k}\\b`, 'i').test(l) ? l : `${k} ${l}`; };
const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200); }
function view(id) { ['v-login', 'v-tables', 'v-table', 'v-state'].forEach((v) => { $('#' + v).hidden = v !== id; }); window.scrollTo(0, 0); }
const msg = (e) => String((e && e.message) || 'Não foi possível agora. Tente de novo.').replace(/^.*?:\s*/, '');
function expired(e) { if (/sess[aã]o expirada/i.test((e && e.message) || '')) { logout(); toast('Sua sessão expirou. Entre de novo com o PIN.'); return true; } return false; }

/* ---------- entrar ---------- */
let pin = '';
function drawPin() { $$('#pin i').forEach((d, i) => d.classList.toggle('on', i < pin.length)); }
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
  const { data, error } = await sb.rpc('waiter_login', { p_slug: slug, p_pin: pin });
  b.disabled = false; pin = ''; drawPin();
  if (error) { $('#lg-err').textContent = msg(error); return; }
  if (data && data.error) { $('#lg-err').textContent = data.error; return; }
  S = data; try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (_) {}
  start();
}
function logout() { S = null; clearInterval(tick); clearInterval(callTick); callTick = null; CALLS = []; renderCalls(); try { localStorage.removeItem(SKEY); } catch (_) {} view('v-login'); }
$('#logout').addEventListener('click', logout);

/* ---------- mesas ---------- */
async function loadTables() {
  const { data, error } = await sb.rpc('waiter_tables', { p_token: S.token });
  if (error) { if (!expired(error)) toast(msg(error)); return; }
  TABLES = data || []; renderTables();
  if (TABLE) { const t = TABLES.find((x) => x.id === TABLE.id); if (t) { TABLE = t; $('#tb-total').textContent = t.bill ? brl(t.bill.total) : ''; } }
}
function renderTables() {
  const hasC = TABLES.some((t) => t.kind === 'comanda');
  $('#g-kind').hidden = !hasC; if (!hasC) KIND = 'mesa';
  $$('#g-kind [data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === KIND)));
  $('#tp-title').textContent = KIND === 'comanda' ? 'Comandas' : 'Mesas';
  $('#t-grid').innerHTML = TABLES.filter((t) => (t.kind || 'mesa') === KIND).map((t) => {
    const b = t.bill;
    const call = CALLS.find((c) => c.table_id === t.id);
    return `<button type="button" class="t-card ${b ? 'busy' : ''} ${b && b.ready ? 'ready' : ''} ${call ? 'calling' : ''}" data-t="${t.id}">${call ? `<em class="t-call">${call.kind === 'conta' ? 'Pediu a conta' : 'Chamou'}</em>` : ''}
      <b>${esc(t.label)}</b>${b && (b.name || b.mesa) ? `<small class="t-who">${esc(b.name || '')}${b.name && b.mesa ? ' · ' : ''}${b.mesa ? 'Mesa ' + esc(b.mesa) : ''}</small>` : ''}${b ? `<span>${brl(b.total)}</span>${b.ready ? `<em>${b.ready} pronto(s)</em>` : `<small>${b.orders} pedido(s)</small>`}` : '<small>Livre</small>'}</button>`;
  }).join('') || `<p class="g-muted">${KIND === 'comanda' ? 'Nenhuma comanda cadastrada.' : 'Nenhuma mesa cadastrada. Peça para o dono criar as mesas no painel.'}</p>`;
}
$('#g-kind').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; KIND = b.dataset.kind; renderTables(); });
$('#t-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return; const t = TABLES.find((x) => x.id === +b.dataset.t);
  if (t.kind === 'comanda' && !t.bill) return openSheet(t);
  openTable(t);
});
/* ---------- abrir comanda ---------- */
function openSheet(t) {
  const d = $('#d-open'); const mesas = TABLES.filter((x) => x.kind !== 'comanda');
  $('#open-form').innerHTML = `<h2>Abrir ${esc(tName(t))}</h2>
    <label class="g-field">Nome do cliente (opcional)<input name="name" maxlength="80" placeholder="Ex.: João"></label>
    <label class="g-field">CPF (opcional)<input name="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"></label>
    <label class="g-field">Pessoas<input name="people" inputmode="numeric" value="1"></label>
    ${mesas.length ? `<label class="g-field">Está na mesa (opcional)<select name="mesa"><option value="">Nenhuma</option>${mesas.map((m) => `<option value="${m.id}">${esc(tName(m))}</option>`).join('')}</select></label>` : ''}
    <p class="g-err" id="open-err"></p>
    <div class="g-acts"><button class="g-btn ghost" type="button" data-x>Voltar</button><button class="g-btn primary" type="submit">Abrir e lançar pedido</button></div>`;
  $('#open-form [data-x]').onclick = () => d.close();
  d.showModal();
  $('#open-form').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const btn = $('[type=submit]', f); btn.disabled = true;
    const { error } = await sb.rpc('waiter_open_bill', { p_token: S.token, p_table: t.id, p_name: f.name.value.trim() || null, p_cpf: f.cpf.value.trim() || null, p_people: parseInt(f.people.value, 10) || 1, p_mesa: f.mesa && f.mesa.value ? +f.mesa.value : null });
    btn.disabled = false;
    if (error) { if (expired(error)) return; $('#open-err').textContent = msg(error); return; }
    d.close(); await loadTables(); openTable(TABLES.find((x) => x.id === t.id) || t);
  };
}
$('#refresh').addEventListener('click', () => { loadTables(); toast('Mesas atualizadas.'); });

/* ---------- cardápio ---------- */
async function loadMenu() {
  const { data: r } = await sb.from('restaurants').select('id, service_pct, couvert').eq('slug', slug).maybeSingle();
  if (!r) return;
  RS = { service_pct: Number(r.service_pct ?? 10), couvert: Number(r.couvert || 0) };
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categories').select('*').eq('restaurant_id', r.id).order('position').order('id'),
    sb.from('products').select('*').eq('restaurant_id', r.id).eq('available', true).order('position').order('id'),
  ]);
  P = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  CATS = (cats || []).map((c) => ({ ...c, items: (prods || []).filter((p) => p.category_id === c.id) }));
  const loose = (prods || []).filter((p) => !p.category_id || !(cats || []).some((c) => c.id === p.category_id));
  if (loose.length) CATS.push({ id: 0, name: 'Outros', items: loose });
  CATS = CATS.filter((c) => c.items.length);
}
const optById = (pid, id) => { for (const g of P[pid].options || []) for (const o of g.items || []) if (o.id === id) return { g, o }; return null; };
const unit = (l) => Number(P[l.pid].price) + (l.opts || []).reduce((s, id) => { const x = optById(l.pid, id); return s + (x && x.g.kind !== 'remove' ? Number(x.o.price || 0) : 0); }, 0);
const labels = (l) => (l.opts || []).map((id) => optById(l.pid, id)).filter(Boolean).map(({ g, o }) => (g.kind === 'remove' ? `Sem ${o.name}` : g.kind === 'add' ? `+ ${o.name}` : o.name));
function renderMenu() {
  const q = ($('#q').value || '').trim().toLowerCase();
  const qty = (pid) => cart.filter((l) => l.pid === pid).reduce((s, l) => s + l.qty, 0);
  $('#menu').innerHTML = CATS.map((c) => {
    const items = c.items.filter((i) => !q || i.name.toLowerCase().includes(q)); if (!items.length) return '';
    return `<h2 class="m-cat">${esc(c.name)}</h2>${items.map((i) => `<div class="m-row" data-p="${i.id}"><div><b>${esc(i.name)}</b><span>${brl(i.price)}${(i.options || []).length ? ' · com opções' : ''}</span></div>
      <div class="m-qty">${qty(i.id) ? `<button type="button" data-minus aria-label="Tirar um">−</button><b>${qty(i.id)}</b>` : ''}<button type="button" data-plus aria-label="Adicionar">+</button></div></div>`).join('')}`;
  }).join('') || '<p class="g-muted">Nada encontrado.</p>';
  const n = cart.reduce((s, l) => s + l.qty, 0);
  $('#bar').hidden = !n; $('#send-total').textContent = brl(cart.reduce((s, l) => s + unit(l) * l.qty, 0)); $('#send-txt').textContent = `Enviar ${n} ${n > 1 ? 'itens' : 'item'} para a cozinha`;
}
$('#q').addEventListener('input', renderMenu);
$('#menu').addEventListener('click', (e) => {
  const row = e.target.closest('[data-p]'); if (!row) return; const pid = +row.dataset.p;
  if (e.target.closest('[data-minus]')) { const i = cart.map((l) => l.pid).lastIndexOf(pid); if (i >= 0) { cart[i].qty--; if (!cart[i].qty) cart.splice(i, 1); } renderMenu(); return; }
  if (e.target.closest('[data-plus]')) { if ((P[pid].options || []).length) return optionSheet(pid); addLine(pid, []); }
});
function addLine(pid, opts, note = '') { const k = [...opts].sort().join(); const same = cart.find((l) => l.pid === pid && [...l.opts].sort().join() === k && l.note === note); if (same) same.qty++; else cart.push({ pid, qty: 1, opts, note }); renderMenu(); }
function optionSheet(pid) {
  const p = P[pid]; const d = $('#d-opt');
  $('#opt-form').innerHTML = `<h2>${esc(p.name)}</h2>${(p.options || []).map((g) => `<fieldset data-g="${esc(g.id)}" data-kind="${g.kind}" data-max="${g.max || ''}"><legend>${esc(g.title)}${g.kind === 'choose' ? ' <em>obrigatório</em>' : ''}</legend>
    ${(g.items || []).map((o) => `<label><input type="${g.kind === 'choose' ? 'radio' : 'checkbox'}" name="g${esc(g.id)}" value="${esc(o.id)}"><span>${g.kind === 'remove' ? 'Sem ' : ''}${esc(o.name)}</span>${Number(o.price) > 0 ? `<small>+ ${brl(o.price)}</small>` : ''}</label>`).join('')}</fieldset>`).join('')}
    <label class="g-field">Observação<input name="note" maxlength="140" placeholder="Ex.: bem passado"></label>
    <p class="g-err" id="opt-err"></p>
    <div class="g-acts"><button class="g-btn ghost" value="cancel" formnovalidate>Cancelar</button><button class="g-btn primary" type="button" id="opt-ok">Adicionar</button></div>`;
  d.showModal();
  $('#opt-ok').onclick = () => {
    const opts = []; let bad = null;
    $$('#opt-form fieldset').forEach((f) => { const sel = $$('input:checked', f).map((i) => i.value); if (f.dataset.kind === 'choose' && sel.length !== 1 && !bad) bad = `Escolha uma opção em "${$('legend', f).textContent.replace(' obrigatório', '')}".`; if (f.dataset.max && sel.length > +f.dataset.max && !bad) bad = `Escolha no máximo ${f.dataset.max} em "${$('legend', f).textContent}".`; opts.push(...sel); });
    if (bad) { $('#opt-err').textContent = bad; return; }
    addLine(pid, opts, $('#opt-form [name=note]').value.trim()); d.close();
  };
}
$('#send').addEventListener('click', () => {
  const d = $('#d-send');
  $('#send-form').innerHTML = `<h2>${esc(tName(TABLE))}</h2>
    <div class="g-lines">${cart.map((l) => { const lb = labels(l); return `<div><span>${l.qty}× ${esc(P[l.pid].name)}${lb.length ? `<small>${lb.map(esc).join(' · ')}</small>` : ''}${l.note ? `<small>Obs.: ${esc(l.note)}</small>` : ''}</span><b>${brl(unit(l) * l.qty)}</b></div>`; }).join('')}</div>
    <label class="g-field">Nome do cliente (opcional)<input name="name" maxlength="80" placeholder="Para saber de quem é"></label>
    <label class="g-field">Observação para a cozinha (opcional)<input name="notes" maxlength="300"></label>
    <p class="g-err" id="send-err"></p>
    <div class="g-acts"><button class="g-btn ghost" type="button" data-x>Voltar</button><button class="g-btn primary" type="submit">Enviar agora</button></div>`;
  $('#send-form [data-x]').onclick = () => d.close();
  d.showModal();
});
$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target; const b = $('[type=submit]', f); b.disabled = true;
  const { error } = await sb.rpc('waiter_order', { p_token: S.token, p_table: TABLE.id, p_items: cart.map((l) => ({ product_id: l.pid, qty: l.qty, note: l.note, options: l.opts })), p_name: f.name.value.trim() || null, p_notes: f.notes.value.trim() || null });
  b.disabled = false;
  if (error) { if (expired(error)) return; $('#send-err').textContent = msg(error); return; }
  $('#d-send').close(); cart = []; renderMenu(); toast(`Pedido da ${tName(TABLE).toLowerCase()} enviado para a cozinha!`); loadTables();
});

/* ---------- conta da mesa ---------- */
const ST = { novo: 'Na cozinha', preparo: 'Em preparo', pronto: 'Pronto p/ servir', entregue: 'Servido' };
async function loadBill() {
  const { data, error } = await sb.rpc('waiter_bill', { p_token: S.token, p_table: TABLE.id });
  if (error) { if (!expired(error)) toast(msg(error)); return; }
  const os = (data && data.orders) || []; const total = os.reduce((s, o) => s + Number(o.total), 0);
  $('#tb-total').textContent = os.length ? brl(total) : '';
  const ready = os.filter((o) => o.status === 'pronto').length;
  $('#bill').innerHTML = !data || !data.bill ? '<div class="g-empty"><b>Sem conta aberta</b><span class="g-muted">Lance o primeiro pedido na aba "Lançar pedido".</span></div>'
    : `${ready ? `<button class="g-btn primary block" type="button" id="serve">Marcar ${ready} pedido(s) pronto(s) como servido(s)</button>` : ''}
      ${os.map((o) => `<div class="b-ord"><div class="b-h"><b>#${o.number}${o.waiter ? ` · ${esc(o.waiter)}` : ' · pelo QR Code'}</b><span class="st st-${o.status}">${ST[o.status] || o.status}</span></div>
        ${(o.items || []).map((i) => `<div class="b-l"><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}</span><span>${brl(i.price * i.qty)}</span></div>`).join('')}</div>`).join('')}
      <div class="b-tot"><span>Consumo</span><b>${brl(total)}</b></div>
      <button class="g-btn dark block" type="button" id="close">Fechar conta</button>`;
  const sv = $('#serve'); if (sv) sv.onclick = async () => { sv.disabled = true; const { error: e2 } = await sb.rpc('waiter_serve', { p_token: S.token, p_table: TABLE.id }); if (e2) { sv.disabled = false; return toast(msg(e2)); } toast('Pedidos marcados como servidos.'); loadBill(); loadTables(); };
  const cl = $('#close'); if (cl) cl.onclick = () => closeSheet(total);
}
function closeSheet(total) {
  const d = $('#d-close'); const sp = RS.service_pct, cv = RS.couvert; const people0 = (TABLE.bill && TABLE.bill.people) ?? 1;
  const calc = (on, ppl) => { const s = on ? Math.round(total * sp) / 100 : 0; const c = cv * ppl; return { s, c, t: total + s + c }; };
  const c0 = calc(sp > 0, people0);
  $('#close-form').innerHTML = `<h2>Fechar conta · ${esc(tName(TABLE))}</h2>
    <div class="b-tot"><span>Consumo</span><b>${brl(total)}</b></div>
    ${sp > 0 ? `<label class="g-check"><input type="checkbox" name="svc" checked> <span>Taxa de serviço ${String(sp).replace('.', ',')}% (<span id="cl-svc">${brl(c0.s)}</span>)</span></label>` : ''}
    ${cv > 0 ? `<label class="g-field">Couvert de ${brl(cv)} por pessoa · quantas pessoas?<input name="people" inputmode="numeric" value="${people0}"></label>` : ''}
    <div class="b-tot big"><span>Total</span><b id="cl-tot">${brl(c0.t)}</b></div>
    <div class="g-pay">${[['pix', 'Pix'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro']].map(([k, l], i) => `<label><input type="radio" name="pay" value="${k}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <p class="g-err" id="cl-err"></p>
    <div class="g-acts"><button class="g-btn ghost" type="button" data-x>Voltar</button><button class="g-btn primary" type="submit">Confirmar pagamento</button></div>`;
  const f = $('#close-form');
  const upd = () => { const c = calc(f.svc ? f.svc.checked : false, f.people ? Math.max(0, parseInt(f.people.value, 10) || 0) : 0); if ($('#cl-svc')) $('#cl-svc').textContent = brl(c.s); $('#cl-tot').textContent = brl(c.t); };
  if (f.svc) f.svc.onchange = upd; if (f.people) f.people.oninput = upd;
  $('#close-form [data-x]').onclick = () => d.close();
  d.showModal();
}
$('#close-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target; const b = $('[type=submit]', f); b.disabled = true;
  const { data, error } = await sb.rpc('waiter_close2', { p_token: S.token, p_table: TABLE.id, p_payment: f.pay.value, p_service_pct: f.svc && f.svc.checked ? RS.service_pct : 0, p_people: f.people ? parseInt(f.people.value, 10) || 0 : null });
  b.disabled = false;
  if (error) { if (expired(error)) return; $('#cl-err').textContent = msg(error); return; }
  $('#d-close').close(); toast(`Conta · ${tName(TABLE)} fechada: ${brl(data.total)}.`); TABLE = null; view('v-tables'); loadTables();
});

/* ---------- chamados das mesas (QR Code: chamar garçom / pedir a conta) ---------- */
let CALLS = [], callTick = null, audio = null; const seenCalls = new Set();
const PAYN = { pix: 'Pix', cartao: 'cartão', dinheiro: 'dinheiro' };
function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) {} }
document.addEventListener('pointerdown', unlockAudio);
const agoMin = (t) => { const m = Math.max(0, Math.floor((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'agora' : `há ${m} min`; };
async function loadCalls() {
  if (!S) return;
  const { data, error } = await sb.rpc('waiter_calls', { p_token: S.token });
  if (error) { expired(error); return; }
  CALLS = Array.isArray(data) ? data : [];
  const fresh = CALLS.filter((c) => !seenCalls.has(c.id));
  fresh.forEach((c) => seenCalls.add(c.id));
  if (fresh.length && callTick) {
    if (audio && window.BoraCampainha) window.BoraCampainha(audio);
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (_) {}
  }
  renderCalls(); renderTables();
}
function renderCalls() {
  const box = $('#calls');
  box.innerHTML = CALLS.map((c) => `<div class="call ${c.kind}"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v1.5"/><path d="M4.5 17a7.5 7.5 0 0 1 15 0z"/><path d="M3 19.5h18"/></g></svg>
    <p><b>${esc(tName({ kind: c.tkind, label: c.label }))}</b> ${c.kind === 'conta' ? `pediu a conta${c.pay ? ` · ${PAYN[c.pay]}` : ''}` : 'chamou o garçom'}<small>${agoMin(c.created_at)}</small></p>
    <button type="button" class="g-btn" data-call="${c.id}">Atender</button></div>`).join('');
  box.hidden = !CALLS.length; document.body.classList.toggle('has-calls', !!CALLS.length);
}
$('#calls').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-call]'); if (!b) return; b.disabled = true;
  const id = +b.dataset.call; const c = CALLS.find((x) => x.id === id);
  const { error } = await sb.rpc('waiter_call_done', { p_token: S.token, p_id: id });
  if (error) { b.disabled = false; if (!expired(error)) toast(msg(error)); return; }
  CALLS = CALLS.filter((x) => x.id !== id); renderCalls(); renderTables();
  if (c && c.kind === 'conta') { const t = TABLES.find((x) => x.id === c.table_id); if (t && t.bill) { openTable(t); gtab('conta'); } }
});

/* ---------- navegação ---------- */
function gtab(t) { $$('.g-tabs [data-gt]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.gt === t))); $('#p-pedir').hidden = t !== 'pedir'; $('#p-conta').hidden = t !== 'conta'; $('#bar').hidden = t !== 'pedir' || !cart.length; if (t === 'conta') loadBill(); }
$$('.g-tabs [data-gt]').forEach((b) => b.addEventListener('click', () => gtab(b.dataset.gt)));
function openTable(t) {
  if (TABLE && TABLE.id !== t.id) cart = [];
  TABLE = t; $('#tb-title').textContent = tName(t); $('#tb-total').textContent = t.bill ? brl(t.bill.total) : ''; $('#q').value = '';
  view('v-table'); renderMenu(); gtab(t.bill && t.bill.ready ? 'conta' : 'pedir');
}
$('#back').addEventListener('click', () => { if (cart.length && !confirm('Sair da mesa sem enviar os itens escolhidos?')) return; cart = []; TABLE = null; view('v-tables'); loadTables(); });

async function start() {
  view('v-tables');
  $('#tp-store').textContent = S.restaurant.name; $('#tp-who').textContent = `Garçom: ${S.name}`;
  await Promise.all([loadTables(), loadMenu()]);
  clearInterval(tick); tick = setInterval(() => { if (document.hidden || !S) return; loadTables(); if (TABLE && !$('#p-conta').hidden) loadBill(); }, 15000);
  seenCalls.clear(); clearInterval(callTick); callTick = null; await loadCalls(); callTick = setInterval(() => { if (S) loadCalls(); }, 6000);
}
async function boot() {
  if (!sb) { $('#st-text').textContent = 'Sistema indisponível.'; return; }
  if (!slug) { $('#st-text').textContent = 'Link do app incompleto. Peça o link certo para o dono da loja.'; return; }
  try { S = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (_) { S = null; }
  if (S && S.token) return start();
  const { data: r } = await sb.from('restaurants').select('name, logo_url').eq('slug', slug).maybeSingle();
  if (!r) { $('#st-text').textContent = 'Loja não encontrada. Confira o link.'; return; }
  $('#lg-store').textContent = r.name; document.title = `Garçom · ${r.name}`;
  $('#lg-ini').textContent = r.name.charAt(0).toUpperCase(); if (r.logo_url) { $('#lg-logo').src = r.logo_url; $('#lg-logo').hidden = false; $('#lg-ini').hidden = true; }
  view('v-login');
}
boot();
