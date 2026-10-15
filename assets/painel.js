/* ============================================================
   BoraLanchar! — painel do restaurante
   Pedidos em tempo real, cardápio e dados da loja.
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');
const num = (s) => { let t = String(s || '').trim().replace(/[^0-9.,]/g, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const v = parseFloat(t); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0; };
const money = (v) => Number(v || 0).toFixed(2).replace('.', ',');
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
const SUPORTE = CFG.whatsapp || '';

let user = null, R = null, CATS = [], PRODS = [], ORDERS = [], filter = 'ativos', channel = null;

const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3200); }
function show(id) { ['v-login', 'v-pass', 'v-msg', 'v-app'].forEach((v) => { $('#' + v).hidden = v !== id; }); }
function message(title, text, actions = []) {
  $('#msg-title').textContent = title; $('#msg-text').textContent = text;
  $('#msg-actions').replaceChildren(...actions.map(([label, fn, cls]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-block ' + (cls || 'btn-primary'); b.textContent = label; b.onclick = fn; return b; }));
  show('v-msg');
}
const waSupport = (txt) => `https://wa.me/${SUPORTE}?text=${encodeURIComponent(txt)}`;

/* ---------- som de pedido novo ---------- */
let audio = null;
function unlockSound() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } if (audio && audio.state === 'suspended') audio.resume(); $('#sound-hint').hidden = true; }
document.addEventListener('pointerdown', unlockSound, { once: false });
function ding() {
  if (!audio) return;
  const now = audio.currentTime;
  [[1318.5, 0], [1975.5, 0.12], [1318.5, 0.5], [1975.5, 0.62]].forEach(([f, t]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, now + t); g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.45);
    o.start(now + t); o.stop(now + t + 0.5);
  });
}
let flash = null;
function titleAlert(n) {
  clearInterval(flash); const base = 'Painel da loja — BoraLanchar!';
  if (!n) { document.title = base; return; }
  let on = false; flash = setInterval(() => { document.title = (on = !on) ? `(${n}) Pedido novo!` : base; }, 1000);
}

/* ---------- autenticação ---------- */
async function boot() {
  if (!sb) return message('Sistema indisponível', 'O banco de dados ainda não foi configurado.');
  sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') show('v-pass'); });
  const { data: { session } } = await sb.auth.getSession();
  if (/type=recovery/.test(location.hash)) { show('v-pass'); return; }
  if (!session) { show('v-login'); return; }
  user = session.user;
  await loadRestaurant();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim(), password = $('#l-senha').value;
  if (!email || !password) { $('#login-err').textContent = 'Preencha e-mail e senha.'; return; }
  const btn = $('#login-form button[type=submit]'); btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) { $('#login-err').textContent = /confirm/i.test(error.message) ? 'Confirme seu e-mail pelo link que enviamos antes de entrar.' : 'E-mail ou senha incorretos.'; return; }
  user = data.user; await loadRestaurant();
});
$('#forgot').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim();
  if (!email) { $('#login-err').textContent = 'Digite seu e-mail acima para receber o link.'; return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('painel.html', location.href).href });
  toast('Se este e-mail tiver conta, enviamos o link para criar nova senha.');
});
$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = $('#p1').value;
  if (p.length < 8) { $('#pass-err').textContent = 'Use pelo menos 8 caracteres.'; return; }
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) { $('#pass-err').textContent = error.message; return; }
  history.replaceState(null, '', location.pathname);
  const { data: { session } } = await sb.auth.getSession(); user = session && session.user; await loadRestaurant();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function loadRestaurant() {
  let { data, error } = await sb.from('restaurants').select('*').eq('owner_id', user.id).maybeSingle();
  if (error) return message('Não foi possível carregar', 'Tente novamente em instantes. Se continuar, fale com o suporte.', [['Tentar de novo', () => location.reload()]]);
  if (!data) {
    const m = user.user_metadata || {};
    const { data: isAdm } = await sb.rpc('is_admin');
    if (isAdm && !m.loja) { location.href = 'admin.html'; return; }
    const name = m.loja || (user.email || 'minha-loja').split('@')[0];
    const res = await sb.rpc('create_my_restaurant', { p_name: name, p_whatsapp: m.telefone || '', p_segment: m.segmento || '', p_plan: m.plano || 'Profissional' });
    if (res.error) return message('Falta pouco', 'Não conseguimos criar sua loja agora. Fale com o suporte que a gente resolve.', [['Falar no WhatsApp', () => open(waSupport(`Olá! Não consegui criar minha loja no BoraLanchar!. Meu e-mail: ${user.email}`), '_blank')]]);
    data = res.data;
  }
  R = data;
  startApp();
}

/* ---------- app ---------- */
function canSell() { return R.status === 'ativo' || (R.status === 'teste' && new Date(R.trial_ends_at) > new Date()); }
function daysLeft() { return Math.max(0, Math.ceil((new Date(R.trial_ends_at) - Date.now()) / 86400000)); }

function renderTrial() {
  const bar = $('#trial-bar');
  const ask = waSupport(`Olá! Quero ativar o plano ${R.plan} do BoraLanchar! para a loja ${R.name} (${R.slug}).`);
  if (R.status === 'ativo') { bar.hidden = true; return; }
  bar.hidden = false;
  if (R.status === 'suspenso') { bar.className = 'trial-bar warn'; bar.innerHTML = `Sua loja está pausada e não recebe pedidos. <a href="${ask}" target="_blank" rel="noopener">Fale com a gente para reativar</a>.`; return; }
  if (canSell()) { const d = daysLeft(); bar.className = 'trial-bar'; bar.innerHTML = `Teste grátis do plano ${esc(R.plan)}: ${d === 1 ? 'falta 1 dia' : `faltam ${d} dias`}. <a href="${ask}" target="_blank" rel="noopener">Ativar meu plano</a>`; }
  else { bar.className = 'trial-bar warn'; bar.innerHTML = `Seu teste grátis terminou e o cardápio está pausado. <a href="${ask}" target="_blank" rel="noopener">Ative seu plano para voltar a vender</a>.`; }
}

function startApp() {
  show('v-app');
  $('#store-name-tag').textContent = R.name;
  $('#open-toggle').checked = R.is_open; $('#open-label').textContent = R.is_open ? 'Aberta' : 'Fechada';
  renderTrial();
  fillStore();
  loadMenu();
  loadOrders();
  subscribe();
  if (new URLSearchParams(location.search).has('bemvindo')) {
    toast('Sua loja foi criada! Comece cadastrando os produtos do cardápio.');
    selectTab('cardapio');
    history.replaceState(null, '', location.pathname);
  }
}

$('#open-toggle').addEventListener('change', async (e) => {
  const v = e.target.checked;
  const { error } = await sb.from('restaurants').update({ is_open: v }).eq('id', R.id);
  if (error) { e.target.checked = !v; toast('Não foi possível mudar agora.'); return; }
  R.is_open = v; $('#open-label').textContent = v ? 'Aberta' : 'Fechada';
  toast(v ? 'Loja aberta: os pedidos estão liberados.' : 'Loja fechada: o cardápio fica visível, mas sem pedidos.');
});

function selectTab(t) {
  $$('.p-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
}
$$('.p-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

/* ---------- pedidos ---------- */
const ST = { novo: 'Novo', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
async function loadOrders() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await sb.from('orders').select('*').eq('restaurant_id', R.id).gte('created_at', since).order('created_at', { ascending: false }).limit(200);
  ORDERS = data || [];
  renderOrders();
}
function renderOrders(freshId) {
  const act = ['novo', 'preparo', 'pronto', 'saiu'];
  const list = ORDERS.filter((o) => (filter === 'ativos' ? act.includes(o.status) : !act.includes(o.status)));
  const news = ORDERS.filter((o) => o.status === 'novo').length;
  $('#new-count').hidden = !news; $('#new-count').textContent = news;
  titleAlert(news);
  $('#orders').innerHTML = list.map((o) => orderCard(o, o.id === freshId)).join('');
  const empty = $('#orders-empty');
  empty.hidden = list.length > 0;
  empty.textContent = filter === 'ativos'
    ? (canSell() ? 'Nenhum pedido em andamento. Divulgue seu link na aba "Minha loja"!' : 'Seu cardápio está pausado. Ative o plano para voltar a receber pedidos.')
    : 'Nenhum pedido finalizado nos últimos 3 dias.';
}
function orderCard(o, fresh) {
  const t = new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ent = o.mode === 'entrega';
  const next = {
    novo: [['preparo', 'Aceitar e preparar', 'btn-primary'], ['cancelado', 'Recusar', 'btn-ghost']],
    preparo: [ent ? ['saiu', 'Saiu para entrega', 'btn-primary'] : ['pronto', 'Pronto para retirar', 'btn-primary']],
    pronto: [['entregue', 'Retirado', 'btn-primary']],
    saiu: [['entregue', 'Entregue', 'btn-primary']],
  }[o.status] || [];
  return `<article class="ord st-${o.status} ${fresh ? 'fresh' : ''}" data-id="${o.id}">
    <div class="ord-head"><div><h3>#${o.number} · ${esc(o.customer_name)}</h3><small>${t} · ${ent ? 'Entrega' : 'Retirada'}</small></div><span class="ord-st ${o.status}">${ST[o.status]}</span></div>
    <ul class="ord-items">${(o.items || []).map((i) => `<li><span>${i.qty}× ${esc(i.name)}${i.note ? `<small>Obs.: ${esc(i.note)}</small>` : ''}</span><span>${brl(i.price * i.qty)}</span></li>`).join('')}</ul>
    <div class="ord-info">
      ${ent ? `<span><b>Endereço:</b> ${esc(o.address)}</span>` : ''}
      <span><b>Pagamento:</b> ${PAG[o.payment] || esc(o.payment)}${o.payment === 'dinheiro' && o.change_for ? ` (troco para ${brl(o.change_for)})` : ''}</span>
      <span><b>WhatsApp:</b> ${esc(o.customer_phone)}</span>
      ${o.notes ? `<span><b>Obs.:</b> ${esc(o.notes)}</span>` : ''}
    </div>
    <div class="ord-total"><span>Total${Number(o.fee) > 0 ? ` (com entrega ${brl(o.fee)})` : ''}</span><span>${brl(o.total)}</span></div>
    <div class="ord-acts">
      ${next.map(([s, l, c]) => `<button class="btn ${c}" type="button" data-st="${s}">${l}</button>`).join('')}
      <a class="btn wa" href="${waCustomer(o)}" target="_blank" rel="noopener"><svg width="18" height="18"><use href="#i-wa"/></svg>Cliente</a>
      <button class="btn btn-ghost" type="button" data-print>Imprimir</button>
    </div></article>`;
}
function waCustomer(o) {
  let d = digits(o.customer_phone); if (d.length <= 11) d = '55' + d;
  const first = (o.customer_name || '').split(' ')[0];
  const txt = {
    novo: `Olá, ${first}! Recebemos seu pedido #${o.number} na ${R.name}. Total: ${brl(o.total)}.${o.payment === 'pix' ? ' Já te mando a chave Pix.' : ''}`,
    preparo: `Olá, ${first}! Seu pedido #${o.number} já está em preparo na ${R.name}. 🍔`,
    saiu: `Olá, ${first}! Seu pedido #${o.number} saiu para entrega. Já já chega aí!`,
    pronto: `Olá, ${first}! Seu pedido #${o.number} está pronto para retirada na ${R.name}.`,
    entregue: `Obrigado pelo pedido, ${first}! Volte sempre na ${R.name}. 😋`,
    cancelado: `Olá, ${first}. Infelizmente não conseguimos atender o pedido #${o.number} agora.`,
  }[o.status];
  return `https://wa.me/${d}?text=${encodeURIComponent(txt)}`;
}
$('#orders').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]'); if (!card) return;
  const o = ORDERS.find((x) => x.id === +card.dataset.id);
  const b = e.target.closest('[data-st]');
  if (b) {
    if (b.dataset.st === 'cancelado' && !confirm(`Recusar o pedido #${o.number}?`)) return;
    b.disabled = true;
    const { error } = await sb.from('orders').update({ status: b.dataset.st }).eq('id', o.id);
    if (error) { b.disabled = false; toast('Não foi possível atualizar.'); return; }
    o.status = b.dataset.st; renderOrders();
    return;
  }
  if (e.target.closest('[data-print]')) printOrder(o);
});
$$('[data-of]').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.of; $$('[data-of]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderOrders();
}));
function printOrder(o) {
  const w = window.open('', '_blank', 'width=380,height=600'); if (!w) return;
  w.document.write(`<html><head><title>Pedido #${o.number}</title><style>body{font:14px monospace;padding:12px;width:300px}h1{font-size:18px;margin:0 0 6px}hr{border:0;border-top:1px dashed #000}td{vertical-align:top}</style></head><body>
    <h1>${esc(R.name)}</h1><b>Pedido #${o.number}</b><br>${new Date(o.created_at).toLocaleString('pt-BR')}<hr>
    <table style="width:100%">${(o.items || []).map((i) => `<tr><td>${i.qty}x ${esc(i.name)}${i.note ? `<br><i>${esc(i.note)}</i>` : ''}</td><td style="text-align:right">${brl(i.price * i.qty)}</td></tr>`).join('')}</table><hr>
    ${Number(o.fee) > 0 ? `Entrega: ${brl(o.fee)}<br>` : ''}<b>TOTAL: ${brl(o.total)}</b><br>Pagamento: ${PAG[o.payment]}${o.change_for ? ` (troco p/ ${brl(o.change_for)})` : ''}<hr>
    ${esc(o.customer_name)} · ${esc(o.customer_phone)}<br>${o.mode === 'entrega' ? esc(o.address) : 'RETIRADA NO BALCÃO'}${o.notes ? `<br>Obs.: ${esc(o.notes)}` : ''}
    <script>print();<\/script></body></html>`);
  w.document.close();
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('pedidos-' + R.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${R.id}` }, (p) => {
      if (p.eventType === 'INSERT') {
        ORDERS.unshift(p.new); ding(); toast(`Pedido novo #${p.new.number} de ${p.new.customer_name}!`);
        if (filter !== 'ativos') { filter = 'ativos'; $$('[data-of]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.of === 'ativos'))); }
        selectTab('pedidos'); renderOrders(p.new.id);
        if ('Notification' in window && Notification.permission === 'granted') new Notification(`Pedido novo #${p.new.number}`, { body: `${p.new.customer_name} · ${brl(p.new.total)}` });
      } else if (p.eventType === 'UPDATE') {
        const i = ORDERS.findIndex((o) => o.id === p.new.id); if (i >= 0) ORDERS[i] = p.new; renderOrders();
      }
    })
    .subscribe();
  // reserva: confere novos pedidos a cada 30 s caso a conexão em tempo real caia
  setInterval(async () => {
    const since = ORDERS[0] ? ORDERS[0].created_at : new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await sb.from('orders').select('*').eq('restaurant_id', R.id).gt('created_at', since).order('created_at', { ascending: false });
    if (data && data.length) { const fresh = data.filter((d) => !ORDERS.some((o) => o.id === d.id)); if (fresh.length) { ORDERS.unshift(...fresh); ding(); renderOrders(fresh[0].id); } }
  }, 30000);
  if ('Notification' in window && Notification.permission === 'default') document.addEventListener('pointerdown', () => Notification.requestPermission(), { once: true });
}

/* ---------- cardápio ---------- */
async function loadMenu() {
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categories').select('*').eq('restaurant_id', R.id).order('position').order('id'),
    sb.from('products').select('*').eq('restaurant_id', R.id).order('position').order('id'),
  ]);
  CATS = cats || []; PRODS = prods || [];
  renderMenu();
}
function renderMenu() {
  const blocks = CATS.map((c, i) => {
    const items = PRODS.filter((p) => p.category_id === c.id);
    return `<section class="cat-block" data-cat="${c.id}">
      <div class="cat-head"><h2>${esc(c.name)}</h2><div class="acts">
        <button class="btn btn-ghost" type="button" data-cmd="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir categoria">↑</button>
        <button class="btn btn-ghost" type="button" data-cmd="down" ${i === CATS.length - 1 ? 'disabled' : ''} aria-label="Descer categoria">↓</button>
        <button class="btn btn-ghost" type="button" data-cmd="rename">Renomear</button>
        <button class="btn btn-ghost adm-danger" type="button" data-cmd="del">Excluir</button>
        <button class="btn btn-outline" type="button" data-cmd="add">+ Produto</button></div></div>
      ${items.length ? items.map(prodRow).join('') : '<p class="empty-cat">Nenhum produto nesta categoria ainda.</p>'}
    </section>`;
  }).join('');
  const loose = PRODS.filter((p) => !p.category_id || !CATS.some((c) => c.id === p.category_id));
  $('#menu-editor').innerHTML = (blocks || '<p class="adm-empty">Crie uma categoria (ex.: Lanches) e depois adicione seus produtos.</p>')
    + (loose.length ? `<section class="cat-block"><div class="cat-head"><h2>Sem categoria</h2></div>${loose.map(prodRow).join('')}</section>` : '');
}
function prodRow(p) {
  return `<div class="p-row ${p.available ? '' : 'off'}" data-prod="${p.id}">
    ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : `<span class="ph">${esc(p.name.charAt(0))}</span>`}
    <div class="info"><b>${esc(p.name)}</b><small>${esc(p.description || '')}</small></div>
    <span class="price">${brl(p.price)}</span>
    <label class="mini-switch"><input type="checkbox" data-avail ${p.available ? 'checked' : ''}> À venda</label>
    <button class="btn btn-outline row-btn" type="button" data-edit>Editar</button>
  </div>`;
}
$('#menu-editor').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-prod]');
  if (row && e.target.closest('[data-edit]')) { openProduct(PRODS.find((p) => p.id === +row.dataset.prod)); return; }
  const cmd = e.target.closest('[data-cmd]'); if (!cmd) return;
  const cid = +cmd.closest('[data-cat]').dataset.cat; const c = CATS.find((x) => x.id === cid);
  if (cmd.dataset.cmd === 'add') return openProduct(null, cid);
  if (cmd.dataset.cmd === 'rename') {
    const n = (prompt('Novo nome da categoria:', c.name) || '').trim(); if (!n || n === c.name) return;
    const { error } = await sb.from('categories').update({ name: n.slice(0, 60) }).eq('id', cid);
    if (error) return toast('Não foi possível renomear.'); c.name = n; renderMenu(); return;
  }
  if (cmd.dataset.cmd === 'del') {
    if (!confirm(`Excluir a categoria "${c.name}"? Os produtos dela ficam em "Sem categoria".`)) return;
    const { error } = await sb.from('categories').delete().eq('id', cid);
    if (error) return toast('Não foi possível excluir.'); await loadMenu(); return;
  }
  if (cmd.dataset.cmd === 'up' || cmd.dataset.cmd === 'down') {
    const i = CATS.indexOf(c), j = cmd.dataset.cmd === 'up' ? i - 1 : i + 1; if (j < 0 || j >= CATS.length) return;
    [CATS[i], CATS[j]] = [CATS[j], CATS[i]];
    await Promise.all(CATS.map((x, k) => sb.from('categories').update({ position: k + 1 }).eq('id', x.id)));
    CATS.forEach((x, k) => { x.position = k + 1; }); renderMenu();
  }
});
$('#menu-editor').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-avail]')) return;
  const id = +e.target.closest('[data-prod]').dataset.prod; const v = e.target.checked;
  const { error } = await sb.from('products').update({ available: v }).eq('id', id);
  if (error) { e.target.checked = !v; toast('Não foi possível atualizar.'); return; }
  PRODS.find((p) => p.id === id).available = v; renderMenu(); toast(v ? 'Produto à venda.' : 'Produto marcado como esgotado.');
});
$('#add-cat').addEventListener('click', async () => {
  const n = (prompt('Nome da nova categoria (ex.: Lanches, Porções, Bebidas):') || '').trim(); if (!n) return;
  const { error } = await sb.from('categories').insert({ restaurant_id: R.id, name: n.slice(0, 60), position: CATS.length + 1 });
  if (error) return toast('Não foi possível criar.'); await loadMenu();
});
$('#add-prod').addEventListener('click', () => openProduct(null, CATS[0] && CATS[0].id));

/* ---------- produto (formulário) ---------- */
const dlg = $('#prod-dialog'); const pf = $('#prod-form');
let editing = null, photo = { url: null, blob: null, removed: false };
function setPhoto(url) { $('#pd-photo').innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span>Sem foto</span>'; $('#pd-rmphoto').hidden = !url; }
function openProduct(p, catId) {
  editing = p || null; photo = { url: p ? p.image_url : null, blob: null, removed: false };
  $('#pd-title').textContent = p ? 'Editar produto' : 'Novo produto';
  pf.name.value = p ? p.name : ''; pf.description.value = p ? p.description || '' : '';
  pf.price.value = p ? money(p.price) : ''; pf.available.checked = p ? p.available : true;
  pf.category_id.innerHTML = CATS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="">Sem categoria</option>';
  pf.category_id.value = p ? (p.category_id || '') : (catId || '');
  $('#pd-delete').hidden = !p; $('#pd-err').textContent = '';
  setPhoto(photo.url); $('#pd-file').value = '';
  dlg.showModal();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
$('#pd-rmphoto').addEventListener('click', () => { photo = { url: null, blob: null, removed: true }; setPhoto(null); });
$('#pd-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { photo.blob = await resize(f, 900); photo.removed = false; setPhoto(URL.createObjectURL(photo.blob)); }
  catch (_) { toast('Não foi possível ler esta imagem.'); }
});
function resize(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(); img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.85);
    }; img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = pf.name.value.trim(), price = num(pf.price.value);
  if (!name) { $('#pd-err').textContent = 'Dê um nome ao produto.'; return; }
  if (!(price >= 0) || !pf.price.value.trim()) { $('#pd-err').textContent = 'Informe o preço.'; return; }
  const btn = $('#pd-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  let image_url = photo.removed ? null : photo.url;
  if (photo.blob) {
    const path = `${R.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await sb.storage.from('produtos').upload(path, photo.blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) { btn.disabled = false; btn.textContent = 'Salvar produto'; $('#pd-err').textContent = 'Não foi possível enviar a foto.'; return; }
    image_url = sb.storage.from('produtos').getPublicUrl(path).data.publicUrl;
  }
  const row = { name: name.slice(0, 80), description: pf.description.value.trim().slice(0, 300) || null, price, available: pf.available.checked,
    category_id: pf.category_id.value ? +pf.category_id.value : null, image_url };
  const q = editing ? sb.from('products').update(row).eq('id', editing.id)
    : sb.from('products').insert({ ...row, restaurant_id: R.id, position: PRODS.length + 1 });
  const { error } = await q;
  btn.disabled = false; btn.textContent = 'Salvar produto';
  if (error) { $('#pd-err').textContent = 'Não foi possível salvar. Confira os dados.'; return; }
  dlg.close(); toast(editing ? 'Produto atualizado.' : 'Produto adicionado ao cardápio.'); await loadMenu();
});
$('#pd-delete').addEventListener('click', async () => {
  if (!editing || !confirm(`Excluir "${editing.name}" do cardápio?`)) return;
  const { error } = await sb.from('products').delete().eq('id', editing.id);
  if (error) return toast('Não foi possível excluir.'); dlg.close(); await loadMenu();
});

/* ---------- minha loja ---------- */
function storeLink() { return `${location.origin}/l/${R.slug}`; }
function fillStore() {
  const f = $('#store-form');
  f.name.value = R.name; f.whatsapp.value = R.whatsapp || ''; f.segment.value = R.segment || ''; f.address.value = R.address || '';
  f.hours.value = R.hours || ''; f.delivery_time.value = R.delivery_time || ''; f.delivery_fee.value = money(R.delivery_fee); f.min_order.value = money(R.min_order);
  f.accepts_delivery.checked = R.accepts_delivery; f.accepts_pickup.checked = R.accepts_pickup;
  const link = storeLink();
  $('#store-link').textContent = link; $('#open-link').href = link;
  $('#share-link').href = `https://wa.me/?text=${encodeURIComponent(`Bateu a fome? Peça na ${R.name} pelo nosso cardápio digital: ${link}`)}`;
  const q = $('#qr'); q.innerHTML = '';
  if (window.QRCode) new QRCode(q, { text: link, width: 360, height: 360, colorDark: '#1A1112', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  const plan = $('#plan-box');
  const st = R.status === 'ativo' ? 'Plano ativo' : R.status === 'suspenso' ? 'Loja pausada' : canSell() ? `Teste grátis · ${daysLeft()} dia(s) restante(s)` : 'Teste encerrado';
  plan.innerHTML = `<b>Plano ${esc(R.plan)}</b><span>${st}</span><a href="${waSupport(`Olá! Quero falar sobre o plano da loja ${R.name} (${R.slug}).`)}" target="_blank" rel="noopener">Falar com o BoraLanchar!</a>`;
}
$('#copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(storeLink()); toast('Link copiado!'); } catch (_) { toast(storeLink()); } });
$('#dl-qr').addEventListener('click', () => {
  const c = $('#qr canvas'); const img = $('#qr img');
  const url = c ? c.toDataURL('image/png') : img && img.src; if (!url) return;
  const a = document.createElement('a'); a.href = url; a.download = `qrcode-${R.slug}.png`; a.click();
});
$('#store-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const wa = digits(f.whatsapp.value);
  if (!f.name.value.trim()) return toast('Informe o nome da loja.');
  if (wa && (wa.length < 10 || wa.length > 13)) return toast('WhatsApp inválido: use DDD + número.');
  if (!f.accepts_delivery.checked && !f.accepts_pickup.checked) return toast('Marque entrega, retirada ou os dois.');
  const patch = { name: f.name.value.trim().slice(0, 80), whatsapp: wa || null, segment: f.segment.value.trim() || null, address: f.address.value.trim() || null,
    hours: f.hours.value.trim() || null, delivery_time: f.delivery_time.value.trim() || '30–45 min', delivery_fee: num(f.delivery_fee.value), min_order: num(f.min_order.value),
    accepts_delivery: f.accepts_delivery.checked, accepts_pickup: f.accepts_pickup.checked };
  const { data, error } = await sb.from('restaurants').update(patch).eq('id', R.id).select().single();
  if (error) return toast('Não foi possível salvar. Confira os dados.');
  R = data; $('#store-name-tag').textContent = R.name; fillStore(); toast('Dados da loja salvos!');
});

boot();
