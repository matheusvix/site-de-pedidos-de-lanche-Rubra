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
function unlockSound() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } if (audio && audio.state === 'suspended') audio.resume(); setTimeout(() => { $('#sound-hint').hidden = true; }, 600); } // espera o clique terminar, senão a tela pula e o toque erra o botão
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
$('#logout').addEventListener('click', async () => { if (SUPPORT) { location.href = 'admin.html'; return; } await sb.auth.signOut(); location.reload(); });

// Modo suporte: o admin do BoraLanchar! abre o painel de uma loja (painel.html?suporte=<id>)
const SUPPORT_ID = new URLSearchParams(location.search).get('suporte');
let SUPPORT = false;
let ROLE = 'dono', STAFF_NAME = '';
async function loadRestaurant() {
  if (SUPPORT_ID) {
    const { data: isAdm } = await sb.rpc('is_admin');
    if (!isAdm) return message('Sem permissão', 'O modo suporte é só para a equipe do BoraLanchar!.', [['Ir para o meu painel', () => { location.href = 'painel.html'; }]]);
    const { data: st, error: e2 } = await sb.from('restaurants').select('*').eq('id', SUPPORT_ID).maybeSingle();
    if (e2 || !st) return message('Loja não encontrada', 'Volte ao admin e escolha a loja de novo.', [['Voltar ao admin', () => { location.href = 'admin.html'; }]]);
    R = st; SUPPORT = true;
    sb.rpc('admin_support_log', { p_rid: R.id }).then(() => {}, () => {});
    startApp();
    return;
  }
  // conta de administrador sempre vai para o admin (para mexer numa loja, use Suporte › Entrar no painel da loja)
  { const { data: isAdm } = await sb.rpc('is_admin'); if (isAdm) { location.replace('admin.html'); return; } }
  let { data, error } = await sb.from('restaurants').select('*').eq('owner_id', user.id).maybeSingle();
  // colaborador (gerente, atendente ou cozinha) entra na loja do dono
  if (!error && !data) {
    const { data: ms } = await sb.rpc('my_store');
    if (ms && ms.role && ms.role !== 'dono') {
      if (ms.role === 'cozinha') { location.replace('cozinha.html'); return; }
      const st = await sb.from('restaurants').select('*').eq('id', ms.id).maybeSingle();
      if (st.data) { R = st.data; ROLE = ms.role; STAFF_NAME = ms.name || ''; startApp(); return; }
    }
  }
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
const paidOk = () => !R.paid_until || new Date(R.paid_until) > new Date(Date.now() - 3 * 86400000);
function canSell() { return (R.status === 'ativo' && paidOk()) || (R.status === 'teste' && new Date(R.trial_ends_at) > new Date()); }
function daysLeft() { return Math.max(0, Math.ceil((new Date(R.trial_ends_at) - Date.now()) / 86400000)); }

function renderTrial() {
  const bar = $('#trial-bar');
  const ask = SUPPORT ? waSupport('') : `assinar.html?plano=${String(R.plan).toLowerCase()}`;
  if (R.status === 'ativo') {
    const left = R.paid_until ? Math.ceil((new Date(R.paid_until) - Date.now()) / 86400000) : null;
    if (left === null || left > 5) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.className = 'trial-bar' + (left <= 0 ? ' warn' : '');
    bar.innerHTML = left > 0 ? `Seu plano ${esc(R.plan)} vence em ${left} dia(s). <a href="${ask}">Renovar agora</a>` : (paidOk() ? `Seu plano ${esc(R.plan)} venceu. <a href="${ask}">Renove para não pausar o cardápio</a>.` : `Seu plano venceu e o cardápio está pausado. <a href="${ask}">Renovar e voltar a vender</a>.`);
    return;
  }
  bar.hidden = false;
  if (R.status === 'cancelado') { bar.hidden = false; bar.className = 'trial-bar warn'; bar.innerHTML = `Sua assinatura foi cancelada e o cardápio não recebe pedidos. <a href="${ask}">Assinar de novo</a>`; return; }
  if (R.status === 'suspenso') { bar.className = 'trial-bar warn'; bar.innerHTML = `Sua loja está pausada e não recebe pedidos. <a href="${ask}">Assinar um plano para reativar</a>.`; return; }
  if (canSell()) { const d = daysLeft(); bar.className = 'trial-bar'; bar.innerHTML = `Teste grátis do plano ${esc(R.plan)}: ${d === 1 ? 'falta 1 dia' : `faltam ${d} dias`}. <a href="${ask}">Ativar meu plano</a>`; }
  else { bar.className = 'trial-bar warn'; bar.innerHTML = `Seu teste grátis terminou e o cardápio está pausado. <a href="${ask}">Ative seu plano para voltar a vender</a>.`; }
}

let DOM_READY = false; // DOMContentLoaded só dispara depois de todos os scripts "defer" (robo.js, equipe.js…)
document.addEventListener('DOMContentLoaded', () => { DOM_READY = true; }, { once: true });
function startApp() {
  // espera os outros módulos do painel (robo.js, equipe.js…) terminarem de carregar
  if (!DOM_READY) { document.addEventListener('DOMContentLoaded', startApp, { once: true }); return; }
  show('v-app');
  if (SUPPORT) {
    $('#support-bar').hidden = false; $('#sup-store').textContent = R.name;
    document.body.classList.add('support-mode'); document.title = `[Suporte] ${R.name} — BoraLanchar!`;
    $('#logout').textContent = 'Sair do suporte';
  }
  $('#store-name-tag').textContent = R.name;
  $('#open-toggle').checked = R.is_open;
  renderTrial();
  fillStore();
  loadMenu();
  loadOrders();
  subscribe();
  if (window.BoraRecursos) window.BoraRecursos.start(); // recursos por plano (assets/recursos.js)
  if (window.BoraRobo && window.BoraPlanos.has(R.plan, 'robo') && ROLE !== 'atendente') window.BoraRobo.start(); // aba Robô WhatsApp (assets/robo.js)
  if (window.BoraEquipe) window.BoraEquipe.start(ROLE, STAFF_NAME);
  const aba = new URLSearchParams(location.search).get('aba');
  if (aba && document.querySelector(`.p-tabs [data-tab="${CSS.escape(aba)}"]`)) selectTab(aba);
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
  R.is_open = v; renderOpenLabel(); renderIdentity();
  toast(!v ? 'Loja fechada: o cardápio fica visível, mas sem pedidos.' : H.status(R).open ? 'Loja aberta: os pedidos estão liberados.' : 'Chave ligada. A loja abre sozinha no próximo horário de funcionamento.');
});

$('#store-form').schedule_enabled.addEventListener('change', (e) => { $('#sched-box').hidden = !e.target.checked; });
$('#auto-accept').addEventListener('change', async (e) => {
  const v = e.target.checked;
  const { error } = await sb.from('restaurants').update({ auto_accept: v }).eq('id', R.id);
  if (error) { e.target.checked = !v; toast('Não foi possível mudar agora.'); return; }
  R.auto_accept = v;
  toast(v ? 'Pronto: os pedidos novos já entram em preparo sozinhos.' : 'Agora você aceita cada pedido novo manualmente.');
});
$('#pdv-open').addEventListener('click', () => { if (window.BoraPDV) window.BoraPDV.open(); });

function selectTab(t) {
  $$('.p-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
  const tb = document.querySelector(`.p-tabs [data-tab="${t}"]`); // no celular, a aba escolhida fica visível na barra
  if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  if (window.BoraRecursos) window.BoraRecursos.onTab(t);
  if (t === 'desempenho' && window.BoraDesempenho) window.BoraDesempenho.load();
  if (t === 'relatorios' && window.BoraRelatorios) window.BoraRelatorios.load();
  if (t === 'cupons' && window.BoraMarketing) window.BoraMarketing.load();
}
$$('.p-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

/* ---------- pedidos ---------- */
// pedido em Pix só aparece depois que o cliente paga (antes disso ele não tem número)
const visibleOrder = (o) => o.status !== 'pagamento' && !(o.status === 'cancelado' && !o.number);
const isPending = (o) => o.status === 'pagamento' && Date.now() - new Date(o.created_at) < 3 * 3600e3;
let PENDING = [];
function renderPending() {
  const box = $('#pending');
  box.hidden = !PENDING.length;
  if (!PENDING.length) { box.innerHTML = ''; return; }
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'agora' : `há ${m} min`; };
  box.innerHTML = `<div class="pending-head"><b>Aguardando Pix</b><span>${R.pix_auto ? 'Entram sozinhos quando o Mercado Pago aprovar.' : 'Confira no app do banco e libere o pedido quando o dinheiro cair.'}</span></div>`
    + PENDING.map((o) => `<div class="pend" data-pid="${o.id}">
      <div class="pend-info"><b>${esc(o.customer_name)} · ${brl(o.total)}</b><small>${(o.items || []).map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')} · ${ago(o.created_at)}</small></div>
      <div class="pend-acts">${R.pix_auto ? '' : '<button class="btn btn-primary" type="button" data-release>Pix caiu, liberar pedido</button>'}<button class="btn btn-ghost" type="button" data-discard>Descartar</button></div>
    </div>`).join('');
}
$('#pending').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-pid]'); if (!el) return;
  const o = PENDING.find((x) => x.id === +el.dataset.pid); if (!o) return;
  const b = e.target.closest('button'); if (!b) return; b.disabled = true;
  if (b.matches('[data-release]')) {
    const { error } = await sb.rpc('owner_confirm_pix', { p_order_id: o.id });
    if (error) { b.disabled = false; toast('Não foi possível liberar agora.'); return; }
    PENDING = PENDING.filter((x) => x.id !== o.id); renderPending();
    const { data } = await sb.from('orders').select('*').eq('id', o.id).maybeSingle();
    if (data && !ORDERS.some((x) => x.id === data.id)) ORDERS.unshift(data);
    renderOrders(o.id); toast('Pedido liberado. O cliente já vê que o pagamento foi confirmado.');
  } else if (b.matches('[data-discard]')) {
    if (!confirm(`Descartar o pedido de ${o.customer_name}? Use só se o cliente desistiu.`)) { b.disabled = false; return; }
    const { error } = await sb.from('orders').update({ status: 'cancelado' }).eq('id', o.id);
    if (error) { b.disabled = false; toast('Não foi possível descartar.'); return; }
    PENDING = PENDING.filter((x) => x.id !== o.id); renderPending();
  }
});
setInterval(() => { if (PENDING.length) { PENDING = PENDING.filter(isPending); renderPending(); } }, 60000);
const ST = { novo: 'Novo', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro', mesa: 'Na conta da mesa' };
async function loadOrders() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await sb.from('orders').select('*').eq('restaurant_id', R.id).gte('created_at', since).order('created_at', { ascending: false }).limit(200);
  ORDERS = (data || []).filter(visibleOrder);
  PENDING = (data || []).filter(isPending);
  renderOrders(); renderPending();
}
function renderOrders(freshId) {
  const act = ['novo', 'preparo', 'pronto', 'saiu'];
  const later = (o) => o.scheduled_for && act.includes(o.status) && new Date(o.scheduled_for) - Date.now() > 3600e3;
  const list = ORDERS.filter((o) => (filter === 'agendados' ? later(o) : filter === 'ativos' ? act.includes(o.status) && !later(o) : !act.includes(o.status)))
    .sort((a, b) => (filter === 'agendados' ? new Date(a.scheduled_for) - new Date(b.scheduled_for) : 0));
  const sc = ORDERS.filter(later).length; $('#sched-count').hidden = !sc; $('#sched-count').textContent = sc;
  const news = ORDERS.filter((o) => o.status === 'novo').length;
  $('#new-count').hidden = !news; $('#new-count').textContent = news;
  titleAlert(news);
  $('#orders').innerHTML = list.map((o) => orderCard(o, o.id === freshId)).join('');
  const empty = $('#orders-empty');
  empty.hidden = list.length > 0;
  empty.textContent = filter === 'ativos'
    ? (canSell() ? 'Nenhum pedido em andamento. Divulgue seu link na aba "Minha loja"!' : 'Seu cardápio está pausado. Ative o plano para voltar a receber pedidos.')
    : filter === 'agendados' ? 'Nenhum pedido agendado para mais tarde.' : 'Nenhum pedido finalizado nos últimos 3 dias.';
}
function orderCard(o, fresh) {
  const t = new Date(o.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ent = o.mode === 'entrega', mesa = o.mode === 'mesa';
  const next = {
    novo: [['preparo', 'Aceitar e preparar', 'btn-primary'], ['cancelado', 'Recusar', 'btn-ghost']],
    preparo: [ent ? ['saiu', 'Saiu para entrega', 'btn-primary'] : ['pronto', mesa ? 'Pronto para servir' : 'Pronto para retirar', 'btn-primary']],
    pronto: [ent ? ['saiu', 'Saiu para entrega', 'btn-primary'] : ['entregue', mesa ? 'Servido' : 'Retirado', 'btn-primary']],
    saiu: [['entregue', 'Entregue', 'btn-primary']],
  }[o.status] || [];
  const how = mesa ? `<b class="ord-mesa">${esc(o.delivery_info || 'Mesa')}</b>` : ent ? 'Entrega' : 'Retirada';
  const SRC = { balcao: 'Balcão', garcom: 'Garçom', qrcode: 'QR da mesa', whatsapp: 'WhatsApp', instagram: 'Instagram' };
  const sched = o.scheduled_for ? new Date(o.scheduled_for) : null;
  const tags = (SRC[o.source] && !mesa ? `<span class="ord-tag">${SRC[o.source]}</span>` : '')
    + (sched ? `<span class="ord-tag sched">Agendado ${sched.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>` : '');
  return `<article class="ord st-${o.status} ${mesa ? 'is-mesa' : ''} ${fresh ? 'fresh' : ''}" data-id="${o.id}">
    <div class="ord-head"><div><h3>#${o.number} · ${esc(o.customer_name)}</h3><small>${t} · ${how}${tags}</small></div><span class="ord-st ${o.status}">${mesa && o.status === 'pronto' ? 'Pronto p/ servir' : mesa && o.status === 'entregue' ? 'Servido' : ST[o.status]}</span></div>
    <ul class="ord-items">${(o.items || []).map((i) => `<li><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small class="ord-opts">${i.opts.map(esc).join(' · ')}</small>` : ''}${i.note ? `<small>Obs.: ${esc(i.note)}</small>` : ''}</span><span>${brl(i.price * i.qty)}</span></li>`).join('')}</ul>
    <div class="ord-info">
      ${ent ? `<span><b>Endereço:</b> ${esc(o.address)}${o.geo ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.geo)}" target="_blank" rel="noopener">ver no mapa</a>` : ''}</span>` : ''}
      ${ent && o.delivery_info ? `<span><b>Entrega:</b> ${esc(o.delivery_info)}</span>` : ''}
      ${ent && window.BoraRecursos ? window.BoraRecursos.courierPick(o) : ''}
      <span><b>Pagamento:</b> ${PAG[o.payment] || esc(o.payment)}${o.payment === 'dinheiro' && o.change_for ? ` (troco para ${brl(o.change_for)})` : ''}${o.payment === 'pix' ? (o.paid ? ' <em class="paid yes">Pix recebido ✓</em>' : o.pix_informed_at ? ` <em class="paid">Cliente pagou às ${new Date(o.pix_informed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}: confira no app do banco</em>` : ' <em class="paid">Aguardando Pix: confira no app do banco</em>') : ''}</span>
      ${o.customer_phone ? `<span><b>WhatsApp:</b> ${esc(o.customer_phone)}</span>` : ''}
      ${Number(o.discount) > 0 ? `<span><b>Desconto:</b> −${brl(o.discount)}${o.coupon_code ? ` (cupom ${esc(o.coupon_code)})` : ''}${o.reward_used ? ' (prêmio fidelidade)' : ''}</span>` : ''}
      ${o.notes ? `<span><b>Obs.:</b> ${esc(o.notes)}</span>` : ''}
    </div>
    <div class="ord-total"><span>Total${Number(o.fee) > 0 ? ` (com entrega ${brl(o.fee)})` : ''}</span><span>${brl(o.total)}</span></div>
    <div class="ord-acts">
      ${next.map(([s, l, c]) => `<button class="btn ${c}" type="button" data-st="${s}">${l}</button>`).join('')}
      ${o.payment === 'pix' && o.status !== 'cancelado' ? `<button class="btn ${o.paid ? 'btn-ghost' : 'btn-outline'}" type="button" data-paid="${o.paid ? 0 : 1}">${o.paid ? 'Desfazer Pix recebido' : 'Pix recebido'}</button>` : ''}
      ${digits(o.customer_phone).length >= 10 ? `<a class="btn wa" href="${waCustomer(o)}" target="_blank" rel="noopener"><svg width="18" height="18"><use href="#i-wa"/></svg>Cliente</a>` : ''}
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
  const pb = e.target.closest('[data-paid]');
  if (pb) {
    const v = pb.dataset.paid === '1'; pb.disabled = true;
    const { error } = await sb.from('orders').update({ paid: v }).eq('id', o.id);
    if (error) { pb.disabled = false; toast('Não foi possível atualizar.'); return; }
    o.paid = v; renderOrders(); toast(v ? 'Pagamento marcado como recebido.' : 'Pagamento desmarcado.'); return;
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
    <table style="width:100%">${(o.items || []).map((i) => `<tr><td>${i.qty}x ${esc(i.name)}${(i.opts || []).map((t) => `<br>&nbsp; ${esc(t)}`).join('')}${i.note ? `<br><i>${esc(i.note)}</i>` : ''}</td><td style="text-align:right">${brl(i.price * i.qty)}</td></tr>`).join('')}</table><hr>
    ${Number(o.fee) > 0 ? `Entrega: ${brl(o.fee)}<br>` : ''}${Number(o.discount) > 0 ? `Desconto: -${brl(o.discount)}<br>` : ''}<b>TOTAL: ${brl(o.total)}</b><br>Pagamento: ${PAG[o.payment] || esc(o.payment)}${o.change_for ? ` (troco p/ ${brl(o.change_for)})` : ''}<hr>
    ${esc(o.customer_name)}${o.customer_phone ? ' · ' + esc(o.customer_phone) : ''}<br>${o.mode === 'entrega' ? esc(o.address) : o.mode === 'mesa' ? esc((o.delivery_info || 'MESA').toUpperCase()) : 'RETIRADA NO BALCÃO'}${o.notes ? `<br>Obs.: ${esc(o.notes)}` : ''}
    <script>print();<\/script></body></html>`);
  w.document.close();
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('pedidos-' + R.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${R.id}` }, (p) => {
      if (window.BoraRecursos) window.BoraRecursos.onOrder(p.new);
      const known = ORDERS.some((o) => o.id === p.new.id);
      if (isPending(p.new)) { // pedido esperando o Pix
        if (!PENDING.some((o) => o.id === p.new.id)) { PENDING.unshift(p.new); renderPending(); if (!R.pix_auto) toast(`${p.new.customer_name} está pagando um pedido no Pix.`); }
        return;
      }
      if (PENDING.some((o) => o.id === p.new.id)) { PENDING = PENDING.filter((o) => o.id !== p.new.id); renderPending(); }
      if (!visibleOrder(p.new)) return;
      if (p.eventType === 'INSERT' || (p.eventType === 'UPDATE' && !known && p.new.status === 'novo')) {
        if (known) return;
        ORDERS.unshift(p.new); ding(); toast(`Pedido novo #${p.new.number} de ${p.new.customer_name}!`);
        if (filter !== 'ativos') { filter = 'ativos'; $$('[data-of]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.of === 'ativos'))); }
        selectTab('pedidos'); renderOrders(p.new.id);
        if ('Notification' in window && Notification.permission === 'granted') new Notification(`Pedido novo #${p.new.number}`, { body: `${p.new.customer_name} · ${brl(p.new.total)}` });
      } else if (p.eventType === 'UPDATE') {
        const i = ORDERS.findIndex((o) => o.id === p.new.id); if (i >= 0) ORDERS[i] = p.new; renderOrders();
        if (window.BoraDesempenho && !$('[data-panel="desempenho"]').hidden) window.BoraDesempenho.now();
      }
    })
    .subscribe();
  // reserva: confere novos pedidos a cada 30 s caso a conexão em tempo real caia
  setInterval(async () => {
    const since = ORDERS[0] ? ORDERS[0].created_at : new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await sb.from('orders').select('*').eq('restaurant_id', R.id).gt('created_at', since).order('created_at', { ascending: false });
    if (data && data.length) {
      const pend = data.filter((d) => isPending(d) && !PENDING.some((o) => o.id === d.id)); if (pend.length) { PENDING.unshift(...pend); renderPending(); }
      const fresh = data.filter((d) => visibleOrder(d) && !ORDERS.some((o) => o.id === d.id)); if (fresh.length) { PENDING = PENDING.filter((o) => !fresh.some((f) => f.id === o.id)); renderPending(); ORDERS.unshift(...fresh); ding(); renderOrders(fresh[0].id); }
    }
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
  if (window.BoraCardapio) window.BoraCardapio.score();
}
function prodRow(p) {
  return `<div class="p-row ${p.available ? '' : 'off'}" data-prod="${p.id}">
    ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : `<span class="ph">${esc(p.name.charAt(0))}</span>`}
    <div class="info"><b>${esc(p.name)}${p.featured ? ' <span class="ord-tag sched">Destaque</span>' : ''}${p.days && p.days.length ? ` <span class="ord-tag">${p.days.map((d) => H.CURTO[d]).join(', ')}</span>` : ''}</b><small>${esc(p.description || '')}</small></div>
    <span class="price">${p.promo_price != null && Number(p.promo_price) < Number(p.price) ? `<s class="old-p">${brl(p.price)}</s> ${brl(p.promo_price)}` : brl(p.price)}</span>
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

/* ---------- opções do produto (tirar / adicionar / escolher) ---------- */
let OPTS = [];
const rid = () => Math.random().toString(36).slice(2, 8);
const KIND = {
  remove: { title: 'Retirar ingredientes', label: 'Cliente toca no que quer tirar (grátis)', ph: 'Ex.: Cebola', price: false },
  add: { title: 'Adicionais', label: 'Extras pagos', ph: 'Ex.: Bacon', price: true },
  choose: { title: 'Ponto da carne', label: 'Cliente escolhe 1 (obrigatório)', ph: 'Ex.: Ao ponto', price: true },
};
function renderOpts() {
  $('#opt-groups').innerHTML = OPTS.map((g, gi) => {
    const k = KIND[g.kind] || KIND.add;
    return `<div class="opt-group k-${g.kind}" data-g="${gi}">
      <div class="opt-group-head">
        <input class="opt-title" data-f="title" value="${esc(g.title)}" maxlength="40" aria-label="Nome do grupo">
        <button class="opt-x" type="button" data-delgroup aria-label="Excluir grupo" title="Excluir grupo">×</button>
      </div>
      <div class="opt-sub"><span>${k.label}</span>${g.kind === 'add' ? `<label class="opt-max">Máximo <input data-f="max" inputmode="numeric" value="${g.max ?? ''}" placeholder="sem limite" aria-label="Quantidade máxima"></label>` : ''}</div>
      ${(g.items || []).map((it, ii) => `<div class="opt-item" data-i="${ii}">
        <input data-f="name" value="${esc(it.name)}" maxlength="40" placeholder="${k.ph}" aria-label="Nome da opção">
        ${k.price ? `<input class="opt-price" data-f="price" inputmode="decimal" value="${it.price ? money(it.price) : ''}" placeholder="+ R$ 0,00" aria-label="Preço extra">` : ''}
        <button class="opt-x" type="button" data-delitem aria-label="Remover opção">×</button></div>`).join('')}
      <button class="btn btn-ghost opt-additem" type="button" data-additem>+ Opção</button>
    </div>`;
  }).join('');
}
$('#opt-groups').addEventListener('input', (e) => {
  const gEl = e.target.closest('[data-g]'); if (!gEl) return; const g = OPTS[+gEl.dataset.g];
  const iEl = e.target.closest('[data-i]'); const f = e.target.dataset.f;
  if (iEl) { const it = g.items[+iEl.dataset.i]; it[f] = f === 'price' ? num(e.target.value) : e.target.value; }
  else if (f === 'max') g.max = e.target.value.trim() ? Math.max(1, parseInt(e.target.value, 10) || 1) : null;
  else if (f) g[f] = e.target.value;
});
$('#opt-groups').addEventListener('click', (e) => {
  const gEl = e.target.closest('[data-g]'); if (!gEl) return; const gi = +gEl.dataset.g;
  if (e.target.closest('[data-delgroup]')) { OPTS.splice(gi, 1); renderOpts(); return; }
  if (e.target.closest('[data-additem]')) { OPTS[gi].items.push({ id: rid(), name: '', price: 0 }); renderOpts(); $$(`[data-g="${gi}"] [data-f="name"]`).pop().focus(); return; }
  const del = e.target.closest('[data-delitem]'); if (del) { OPTS[gi].items.splice(+del.closest('[data-i]').dataset.i, 1); renderOpts(); }
});
$$('[data-addgroup]').forEach((b) => b.addEventListener('click', () => {
  const kind = b.dataset.addgroup;
  OPTS.push({ id: rid(), kind, title: KIND[kind].title, max: null, items: [{ id: rid(), name: '', price: 0 }] });
  renderOpts(); $$('#opt-groups [data-f="name"]').pop().focus();
}));
function cleanOpts() {
  return OPTS.map((g) => ({ id: g.id || rid(), kind: g.kind, title: (g.title || KIND[g.kind].title).trim().slice(0, 40), max: g.kind === 'add' && g.max ? g.max : null,
    items: (g.items || []).filter((it) => String(it.name || '').trim()).map((it) => ({ id: it.id || rid(), name: it.name.trim().slice(0, 40), price: g.kind === 'remove' ? 0 : Math.max(0, Number(it.price) || 0) })) }))
    .filter((g) => g.items.length);
}
/* ---------- produto (formulário) ---------- */
const dlg = $('#prod-dialog'); const pf = $('#prod-form');
let editing = null, photo = { url: null, blob: null, removed: false };
function setPhoto(url) { $('#pd-photo').innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span>Sem foto</span>'; $('#pd-rmphoto').hidden = !url; }
function openProduct(p, catId) {
  editing = p || null; photo = { url: p ? p.image_url : null, blob: null, removed: false };
  $('#pd-title').textContent = p ? 'Editar produto' : 'Novo produto';
  pf.name.value = p ? p.name : ''; pf.description.value = p ? p.description || '' : '';
  pf.price.value = p ? money(p.price) : ''; pf.available.checked = p ? p.available : true;
  pf.promo_price.value = p && p.promo_price != null ? money(p.promo_price) : ''; pf.featured.checked = !!(p && p.featured);
  const dd = (p && p.days) || [];
  $('#pd-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" value="${d}" ${dd.includes(d) ? 'checked' : ''}><span>${H.CURTO[d]}</span></label>`).join('');
  pf.category_id.innerHTML = CATS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="">Sem categoria</option>';
  pf.category_id.value = p ? (p.category_id || '') : (catId || '');
  $('#pd-delete').hidden = !p; $('#pd-err').textContent = '';
  setPhoto(photo.url); $('#pd-file').value = '';
  OPTS = JSON.parse(JSON.stringify((p && p.options) || []));
  renderOpts();
  if (window.BoraRecursos) window.BoraRecursos.recipeOpen(p);
  dlg.showModal();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
$('#pd-rmphoto').addEventListener('click', () => { photo = { url: null, blob: null, removed: true }; setPhoto(null); });
$('#pd-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { photo.blob = await resize(f, 900); photo.removed = false; setPhoto(URL.createObjectURL(photo.blob)); }
  catch (_) { toast('Não foi possível ler esta imagem.'); }
});
function resize(file, max, square) {
  return new Promise((res, rej) => {
    const img = new Image(); img.onload = () => {
      const c = document.createElement('canvas');
      if (square) { // recorte quadrado no centro (foto de perfil)
        const side = Math.min(img.width, img.height); const out = Math.min(max, side);
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
        c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.88); return;
      }
      const k = Math.min(1, max / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
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
  const promo = pf.promo_price.value.trim() ? num(pf.promo_price.value) : null;
  if (promo !== null && !(promo < price)) { $('#pd-err').textContent = 'O preço promocional precisa ser menor que o preço normal.'; return; }
  const days = [...$('#pd-days').querySelectorAll('input:checked')].map((i) => +i.value).sort();
  const btn = $('#pd-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  let image_url = photo.removed ? null : photo.url;
  if (photo.blob) {
    const path = `${R.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await sb.storage.from('produtos').upload(path, photo.blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) { btn.disabled = false; btn.textContent = 'Salvar produto'; $('#pd-err').textContent = 'Não foi possível enviar a foto.'; return; }
    image_url = sb.storage.from('produtos').getPublicUrl(path).data.publicUrl;
  }
  const row = { name: name.slice(0, 80), description: pf.description.value.trim().slice(0, 300) || null, price, available: pf.available.checked,
    category_id: pf.category_id.value ? +pf.category_id.value : null, image_url, options: cleanOpts(),
    promo_price: promo, featured: pf.featured.checked, days: days.length && days.length < 7 ? days : null };
  const q = editing ? sb.from('products').update(row).eq('id', editing.id).select('id').single()
    : sb.from('products').insert({ ...row, restaurant_id: R.id, position: PRODS.length + 1 }).select('id').single();
  const { data: saved, error } = await q;
  if (!error && saved && window.BoraRecursos) await window.BoraRecursos.recipeSave(saved.id);
  btn.disabled = false; btn.textContent = 'Salvar produto';
  if (error) { $('#pd-err').textContent = 'Não foi possível salvar. Confira os dados.'; return; }
  dlg.close(); toast(editing ? 'Produto atualizado.' : 'Produto adicionado ao cardápio.'); await loadMenu();
});
$('#pd-delete').addEventListener('click', async () => {
  if (!editing || !confirm(`Excluir "${editing.name}" do cardápio?`)) return;
  const { error } = await sb.from('products').delete().eq('id', editing.id);
  if (error) return toast('Não foi possível excluir.'); dlg.close(); await loadMenu();
});

/* ---------- minha loja (modelo Google Meu Negócio) ---------- */
const H = window.BoraHoras;
const SITE = (CFG.siteUrl || location.origin).replace(/\/$/, '');
function storeLink() { return `${SITE}/l/${R.slug}`; }
let ZONES = [], WEEK = {};
const sf = () => $('#store-form');

function selectSec(sec) {
  $$('.biz-tabs [data-sec]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sec === sec)));
  $$('[data-sec-panel]').forEach((p) => { p.hidden = p.dataset.secPanel !== sec; });
}
$$('.biz-tabs [data-sec]').forEach((b) => b.addEventListener('click', () => selectSec(b.dataset.sec)));

function renderIdentity() {
  $('#biz-name').textContent = R.name;
  $('#biz-cat').textContent = R.segment || 'Categoria não informada';
  const st = H.status(R);
  const el = $('#biz-status'); el.textContent = st.text; el.className = 'biz-status ' + (st.open ? 'on' : 'off');
  const li = $('#logo-img'); li.hidden = !R.logo_url; if (R.logo_url) li.src = R.logo_url;
  $('#logo-ini').hidden = !!R.logo_url; $('#logo-ini').textContent = R.name.trim().charAt(0).toUpperCase();
  const ci = $('#cover-img'); ci.hidden = !R.cover_url; if (R.cover_url) ci.src = R.cover_url;
  $('#store-name-tag').textContent = R.name;
}
setInterval(() => { if (R) { renderIdentity(); renderOpenLabel(); } }, 60000);
function renderOpenLabel() {
  const st = H.status(R);
  $('#open-label').textContent = !R.is_open ? 'Fechada' : st.open ? 'Aberta' : 'Fora do horário';
}

function renderLink() {
  const link = storeLink();
  $('#store-link').textContent = link; $('#open-link').href = link;
  $('#share-link').href = `https://wa.me/?text=${encodeURIComponent(`Bateu a fome? Peça na ${R.name} pelo nosso cardápio digital: ${link}`)}`;
  const q = $('#qr'); q.innerHTML = '';
  if (window.BoraQR) q.appendChild(window.BoraQR.canvas(link, 600, { color: '#1A1112', level: 'M' }));
}

function fillStore() {
  const f = sf();
  f.name.value = R.name; f.segment.value = R.segment || ''; f.description.value = R.description || '';
  $('#desc-count').textContent = f.description.value.length;
  f.whatsapp.value = R.whatsapp || ''; f.phone.value = R.phone || ''; f.instagram.value = R.instagram || ''; f.website.value = R.website || '';
  f.address.value = R.address || '';
  f.accepts_delivery.checked = R.accepts_delivery; f.accepts_pickup.checked = R.accepts_pickup;
  f.delivery_mode.value = R.delivery_mode || 'fixa';
  f.delivery_fee.value = money(R.delivery_fee); f.delivery_time.value = R.delivery_time || ''; f.min_order.value = money(R.min_order);
  f.allow_notes.checked = R.allow_notes !== false; f.ask_cutlery.checked = !!R.ask_cutlery;
  f.schedule_enabled.checked = !!R.schedule_enabled; f.schedule_days.value = String(R.schedule_days ?? 2); f.schedule_step.value = String(R.schedule_step ?? 30);
  $('#sched-box').hidden = !f.schedule_enabled.checked;
  $('#auto-accept').checked = !!R.auto_accept;
  ZONES = JSON.parse(JSON.stringify(R.delivery_zones || []));
  f.hours_mode.value = R.opening_hours ? 'normal' : 'livre';
  WEEK = R.opening_hours ? JSON.parse(JSON.stringify(R.opening_hours))
    : { 0: [], 1: [['18:00', '23:00']], 2: [['18:00', '23:00']], 3: [['18:00', '23:00']], 4: [['18:00', '23:00']], 5: [['18:00', '23:30']], 6: [['18:00', '23:30']] };
  const pm = R.payment_methods || ['pix', 'cartao', 'dinheiro'];
  f.pay_pix.checked = pm.includes('pix'); f.pay_cartao.checked = pm.includes('cartao'); f.pay_dinheiro.checked = pm.includes('dinheiro');
  f.pix_key.value = R.pix_key || ''; f.pix_key_type.value = R.pix_key_type || (R.pix_key ? window.BoraPix.guessType(R.pix_key) : 'celular');
  f.pix_name.value = R.pix_name || ''; f.pix_city.value = R.pix_city || ''; f.pix_bank.value = R.pix_bank || '';
  renderPixCfg(); loadMp();
  renderIdentity(); renderOpenLabel(); renderGeo(); renderDelivery(); renderWeek(); renderLink();
  const plan = $('#plan-box');
  const st = R.status === 'ativo' ? 'Plano ativo' : R.status === 'suspenso' ? 'Loja pausada' : canSell() ? `Teste grátis · ${daysLeft()} dia(s) restante(s)` : 'Teste encerrado';
  const prio = window.BoraPlanos.has(R.plan, 'prioritario');
  plan.innerHTML = `<b>Plano ${esc(R.plan)}</b><span>${st}</span>`
    + (prio ? `<a class="prio" href="${waSupport(`[PRIORITÁRIO] Olá! Sou da loja ${R.name} (${R.slug}), plano Completo, e preciso de ajuda.`)}" target="_blank" rel="noopener">⚡ Suporte prioritário</a>`
      : `<a href="${waSupport(`Olá! Quero falar sobre o plano da loja ${R.name} (${R.slug}).`)}" target="_blank" rel="noopener">Falar com o BoraLanchar!</a>`)
    + (R.plan !== 'Completo' ? `<a href="assinar.html?plano=${R.plan === 'Essencial' ? 'profissional' : 'completo'}">Conhecer o plano ${R.plan === 'Essencial' ? 'Profissional' : 'Completo'}</a>` : '');
}
sf().description.addEventListener('input', (e) => { $('#desc-count').textContent = e.target.value.length; });

/* fotos de perfil e capa: salvam na hora */
async function uploadImage(file, kind) {
  const blob = kind === 'logo' ? await resize(file, 480, true) : await resize(file, 1600);
  const path = `${R.id}/${kind}-${Date.now()}.jpg`;
  const up = await sb.storage.from('produtos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  return sb.storage.from('produtos').getPublicUrl(path).data.publicUrl;
}
[['logo-file', 'logo', 'logo_url', 'Foto de perfil atualizada!'], ['cover-file', 'cover', 'cover_url', 'Foto de capa atualizada!']].forEach(([id, kind, col, ok]) => {
  $('#' + id).addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    toast('Enviando foto…');
    try {
      const url = await uploadImage(file, kind);
      const { data, error } = await sb.from('restaurants').update({ [col]: url }).eq('id', R.id).select().single();
      if (error) throw error;
      R = data; renderIdentity(); toast(ok);
    } catch (_) { toast('Não foi possível enviar a foto. Tente outra imagem.'); }
  });
});

/* localização da loja (para entrega por distância) */
function renderGeo() {
  $('#geo-text').innerHTML = R.lat != null
    ? `Marcada ✓ <a href="https://www.google.com/maps/search/?api=1&query=${R.lat},${R.lng}" target="_blank" rel="noopener">conferir no mapa</a>`
    : 'Ainda não marcada. Precisa para cobrar a entrega por distância.';
}
async function saveGeo(lat, lng) {
  const { data, error } = await sb.from('restaurants').update({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) }).eq('id', R.id).select().single();
  if (error) { toast('Não foi possível salvar a localização.'); return; }
  R = data; renderGeo(); toast('Localização da loja salva!');
}
$('#geo-here').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Este aparelho não informa a localização.');
  toast('Pegando a localização…');
  navigator.geolocation.getCurrentPosition((p) => saveGeo(p.coords.latitude, p.coords.longitude),
    () => toast('Não deu para pegar a localização. Permita o acesso ou use "Buscar pelo endereço".'), { enableHighAccuracy: true, timeout: 15000 });
});
$('#geo-addr').addEventListener('click', async () => {
  const q = sf().address.value.trim(); if (!q) return toast('Preencha o endereço da loja primeiro.');
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'pt-BR' } });
    const [hit] = await r.json();
    if (!hit) return toast('Endereço não encontrado no mapa. Inclua bairro e cidade, ou use "Estou na loja agora".');
    saveGeo(+hit.lat, +hit.lon);
  } catch (_) { toast('Busca indisponível agora. Use "Estou na loja agora".'); }
});

/* entrega: taxa única, por bairro ou por distância */
function renderDelivery() {
  const f = sf(); const mode = f.delivery_mode.value;
  $('#deliv-box').hidden = !f.accepts_delivery.checked;
  $('#mode-fixa').hidden = mode !== 'fixa';
  $('#mode-zones').hidden = mode === 'fixa';
  if (mode === 'fixa') return;
  const bairro = mode === 'bairro';
  $('#zones-head').innerHTML = bairro ? '<span>Bairro</span><span>Taxa (R$)</span><span>Prazo</span><span></span>' : '<span>Até (km)</span><span>Taxa (R$)</span><span>Prazo</span><span></span>';
  $('#zones').innerHTML = ZONES.map((z, i) => `<div class="zone" data-z="${i}">
    ${bairro ? `<input data-k="name" value="${esc(z.name || '')}" maxlength="50" placeholder="Ex.: Laranjeiras" aria-label="Bairro">`
    : `<input data-k="km" inputmode="decimal" value="${z.km != null ? String(z.km).replace('.', ',') : ''}" placeholder="Ex.: 3" aria-label="Até quantos km">`}
    <input data-k="fee" inputmode="decimal" value="${z.fee != null ? money(z.fee) : ''}" placeholder="0,00" aria-label="Taxa">
    <input data-k="time" value="${esc(z.time || '')}" maxlength="30" placeholder="30–40 min" aria-label="Prazo">
    <button type="button" class="opt-x" data-delzone aria-label="Remover">×</button></div>`).join('') || `<p class="adm-muted">Nenhum${bairro ? ' bairro' : 'a faixa'} ainda.</p>`;
  $('#add-zone').textContent = bairro ? '+ Bairro' : '+ Faixa de distância';
  $('#zone-hint').innerHTML = bairro
    ? 'O cliente escolhe o bairro na hora de finalizar e vê a taxa e o prazo daquele bairro.'
    : `A distância é calculada do endereço do cliente até a loja (aproximada pela rua). ${R.lat == null ? '<b>Marque a localização da loja acima.</b>' : ''} Fora da última faixa, a entrega não é aceita.`;
}
const sortZones = () => { if (sf().delivery_mode.value === 'distancia') ZONES.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)); };
$('#zones').addEventListener('input', (e) => {
  const z = ZONES[+e.target.closest('[data-z]').dataset.z]; const k = e.target.dataset.k;
  z[k] = k === 'fee' || k === 'km' ? (e.target.value.trim() ? num(e.target.value) : null) : e.target.value;
});
$('#zones').addEventListener('click', (e) => { const b = e.target.closest('[data-delzone]'); if (b) { ZONES.splice(+b.closest('[data-z]').dataset.z, 1); renderDelivery(); } });
$('#add-zone').addEventListener('click', () => {
  const dist = sf().delivery_mode.value === 'distancia';
  const last = ZONES[ZONES.length - 1];
  ZONES.push(dist ? { km: last && last.km ? last.km + 2 : 3, fee: last ? (last.fee || 0) + 2 : 5, time: '' } : { name: '', fee: last ? last.fee : 5, time: last ? last.time : '' });
  renderDelivery(); $$('#zones input').slice(-3)[0].focus();
});
sf().addEventListener('change', (e) => {
  if (e.target.name === 'delivery_mode') { if (e.target.value !== (R.delivery_mode || 'fixa')) ZONES = []; sortZones(); renderDelivery(); }
  if (e.target.name === 'accepts_delivery') renderDelivery();
  if (e.target.name === 'hours_mode') renderWeek();
});

/* horário por dia da semana */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda primeiro, como no Google
function renderWeek() {
  const normal = sf().hours_mode.value === 'normal';
  $('#week').hidden = !normal; $('#copy-week').hidden = !normal;
  $('#week').innerHTML = WEEK_ORDER.map((d) => {
    const ivs = WEEK[d] || []; const open = ivs.length > 0;
    return `<div class="day" data-d="${d}">
      <label class="day-name"><input type="checkbox" data-open ${open ? 'checked' : ''}> <b>${H.DIAS[d]}</b></label>
      <div class="day-ivs">${open ? ivs.map((iv, i) => `<div class="iv" data-i="${i}">
          <input type="time" data-p="0" value="${esc(iv[0])}" aria-label="Abre às"><span>até</span><input type="time" data-p="1" value="${esc(iv[1])}" aria-label="Fecha às">
          ${ivs.length > 1 ? '<button type="button" class="opt-x" data-deliv aria-label="Remover turno">×</button>' : ''}</div>`).join('')
        + '<button type="button" class="btn btn-ghost add-iv" data-addiv>+ turno</button>' : '<span class="day-closed">Fechado</span>'}</div>
    </div>`;
  }).join('');
}
$('#week').addEventListener('input', (e) => {
  const d = e.target.closest('[data-d]').dataset.d; const iv = e.target.closest('[data-i]');
  if (iv && e.target.dataset.p) WEEK[d][+iv.dataset.i][+e.target.dataset.p] = e.target.value;
});
$('#week').addEventListener('change', (e) => {
  if (!e.target.matches('[data-open]')) return;
  const d = e.target.closest('[data-d]').dataset.d;
  WEEK[d] = e.target.checked ? [['18:00', '23:00']] : []; renderWeek();
});
$('#week').addEventListener('click', (e) => {
  const day = e.target.closest('[data-d]'); if (!day) return; const d = day.dataset.d;
  if (e.target.closest('[data-addiv]')) { WEEK[d].push(['18:00', '23:00']); renderWeek(); }
  const del = e.target.closest('[data-deliv]'); if (del) { WEEK[d].splice(+del.closest('[data-i]').dataset.i, 1); renderWeek(); }
});
$('#copy-week').addEventListener('click', () => {
  const base = WEEK[1] || [];
  if (!base.length) return toast('Marque a segunda-feira como aberta primeiro.');
  [2, 3, 4, 5, 6, 0].forEach((d) => { if ((WEEK[d] || []).length) WEEK[d] = base.map((iv) => [...iv]); });
  renderWeek(); toast('Horário copiado. Lembre de salvar.');
});

$('#copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(storeLink()); toast('Link copiado!'); } catch (_) { toast(storeLink()); } });
$('#dl-qr').addEventListener('click', () => {
  const c = $('#qr canvas'); const img = $('#qr img');
  const url = c ? c.toDataURL('image/png') : img && img.src; if (!url) return;
  const a = document.createElement('a'); a.href = url; a.download = `qrcode-${R.slug}.png`; a.click();
});

/* Pix: pré-visualização com QR de teste */
const PIX_PH = { celular: '(27) 99999-9999', cpf: '000.000.000-00', cnpj: '00.000.000/0001-00', email: 'voce@email.com', aleatoria: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' };
function renderPixCfg() {
  const f = sf();
  $('#pix-cfg').classList.toggle('off', !f.pay_pix.checked);
  f.pix_key.placeholder = PIX_PH[f.pix_key_type.value];
  f.pix_key.inputMode = ['celular', 'cpf', 'cnpj'].includes(f.pix_key_type.value) ? 'numeric' : f.pix_key_type.value === 'email' ? 'email' : 'text';
  const key = f.pix_key.value.trim() ? window.BoraPix.normalizeKey(f.pix_key_type.value, f.pix_key.value) : null;
  $('#pix-key-err').textContent = f.pix_key.value.trim() && !key ? 'Confira a chave: ela não combina com o tipo escolhido.' : '';
  const ok = key && f.pix_name.value.trim() && f.pix_city.value.trim();
  const box = $('#pix-test-qr');
  if (!ok) { box.innerHTML = '<span>Preencha chave, nome e cidade para ver o QR de teste</span>'; $('#pix-test-copy').disabled = true; return; }
  const code = window.BoraPix.payload({ key, name: f.pix_name.value, city: f.pix_city.value, amount: 1, txid: 'TESTEBORA', info: 'Teste BoraLanchar' });
  box.innerHTML = window.BoraQR.svg(code, { label: 'QR Code Pix de teste' }); box.dataset.code = code; $('#pix-test-copy').disabled = false;
}
['pix_key', 'pix_name', 'pix_city', 'pix_key_type', 'pay_pix'].forEach((n) => { sf()[n].addEventListener('input', renderPixCfg); sf()[n].addEventListener('change', renderPixCfg); });
$('#pix-test-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#pix-test-qr').dataset.code); toast('Código de teste copiado. Cole no app do banco em Pix › Copia e cola.'); } catch (_) {} });

/* Mercado Pago: confirmação automática do Pix */
function renderMp(connected, account) {
  $('#mp-state').textContent = connected ? 'Ligada' : 'Desligada';
  $('#mp-state').classList.toggle('on', !!connected);
  $('#mp-off').hidden = !!connected; $('#mp-on').hidden = !connected;
  $('#mp-acc').textContent = account || '';
}
async function mpCall(action, extra = {}) {
  if (!sb.functions) return { error: 'indisponível' };
  const { data, error } = await sb.functions.invoke('pix', { body: { action, ...extra } });
  if (error) { let msg = 'Não foi possível falar com o servidor.'; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} return { error: msg }; }
  return data || {};
}
async function loadMp() {
  if (SUPPORT) { // o token é pessoal do dono: só ele conecta pela própria conta
    renderMp(R.pix_auto, R.pix_auto ? 'conectada pelo dono' : ''); $('#mp-off').hidden = true; $('#mp-on').hidden = !R.pix_auto;
    $('#mp-disconnect').hidden = true;
    $('#mp-desc').textContent = 'No modo suporte não dá para conectar ou desconectar o Mercado Pago: o dono precisa fazer isso pela conta dele, na aba Pagamento.';
    return;
  }
  renderMp(R.pix_auto, ''); if (!R.pix_auto) return; const r = await mpCall('account'); if (!r.error) renderMp(r.connected, r.account); }
$('#mp-connect').addEventListener('click', async () => {
  const token = $('#mp-token').value.trim();
  if (!/^APP_USR-/.test(token)) return toast('Cole o Access Token de produção (começa com APP_USR-).');
  const b = $('#mp-connect'); b.disabled = true; b.textContent = 'Conectando…';
  const r = await mpCall('connect', { token });
  b.disabled = false; b.textContent = 'Conectar Mercado Pago';
  if (r.error) return toast(r.error);
  $('#mp-token').value = ''; R.pix_auto = true; renderMp(true, r.account); renderPending();
  toast('Mercado Pago conectado! Os pedidos em Pix agora entram sozinhos quando o cliente paga.');
});
$('#mp-disconnect').addEventListener('click', async () => {
  if (!confirm('Desconectar o Mercado Pago? Os pedidos em Pix voltam a precisar da sua confirmação.')) return;
  const r = await mpCall('disconnect'); if (r.error) return toast(r.error);
  R.pix_auto = false; renderMp(false, ''); renderPending(); toast('Mercado Pago desconectado.');
});

function fail(sec, msg) { selectSec(sec); toast(msg); return null; }
function buildPatch() {
  const f = sf();
  const wa = digits(f.whatsapp.value);
  if (f.name.value.trim().length < 2) return fail('sobre', 'Informe o nome da loja.');
  if (wa && (wa.length < 10 || wa.length > 13)) return fail('contato', 'WhatsApp inválido: use DDD + número.');
  if (!f.accepts_delivery.checked && !f.accepts_pickup.checked) return fail('local', 'Marque entrega, retirada ou os dois.');
  const mode = f.delivery_mode.value || 'fixa';
  let zones = [];
  if (f.accepts_delivery.checked && mode !== 'fixa') {
    if (mode === 'bairro') {
      zones = ZONES.filter((z) => String(z.name || '').trim()).map((z) => ({ name: z.name.trim().slice(0, 50), fee: Math.max(0, z.fee || 0), time: String(z.time || '').trim().slice(0, 30) }));
      const names = zones.map((z) => z.name.toLowerCase());
      if (new Set(names).size !== names.length) return fail('local', 'Há bairros repetidos na lista.');
    } else {
      zones = ZONES.filter((z) => z.km > 0).map((z) => ({ km: Math.round(z.km * 10) / 10, fee: Math.max(0, z.fee || 0), time: String(z.time || '').trim().slice(0, 30) })).sort((a, b) => a.km - b.km);
      if (R.lat == null) return fail('local', 'Para cobrar por distância, marque a localização da loja.');
    }
    if (!zones.length) return fail('local', mode === 'bairro' ? 'Adicione pelo menos um bairro com a taxa.' : 'Adicione pelo menos uma faixa de distância.');
  }
  let hours = null;
  if (f.hours_mode.value === 'normal') {
    hours = {};
    for (let d = 0; d < 7; d++) {
      const ivs = (WEEK[d] || []).filter((iv) => iv[0] && iv[1]).map((iv) => [iv[0].slice(0, 5), iv[1].slice(0, 5)]);
      hours[d] = ivs;
    }
    if (!Object.values(hours).some((v) => v.length)) return fail('horario', 'Marque pelo menos um dia aberto, ou escolha "Sem horário definido".');
  }
  const pay = ['pix', 'cartao', 'dinheiro'].filter((k) => f['pay_' + k].checked);
  if (!pay.length) return fail('pagamento', 'Marque pelo menos uma forma de pagamento.');
  let pixKey = null;
  if (f.pix_key.value.trim()) {
    pixKey = window.BoraPix.normalizeKey(f.pix_key_type.value, f.pix_key.value);
    if (!pixKey) return fail('pagamento', 'Chave Pix inválida para o tipo escolhido.');
    if (!f.pix_name.value.trim()) return fail('pagamento', 'Informe o nome de quem recebe o Pix.');
    if (!f.pix_city.value.trim()) return fail('pagamento', 'Informe a cidade da conta Pix.');
  } else if (pay.includes('pix')) return fail('pagamento', 'Para aceitar Pix, cadastre a chave Pix que vai receber os pagamentos.');
  let ig = f.instagram.value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  return {
    name: f.name.value.trim().slice(0, 80), segment: f.segment.value.trim() || null, description: f.description.value.trim().slice(0, 750) || null,
    whatsapp: wa || null, phone: f.phone.value.trim() || null, instagram: ig ? '@' + ig.slice(0, 58) : null, website: f.website.value.trim() || null,
    address: f.address.value.trim() || null,
    accepts_delivery: f.accepts_delivery.checked, accepts_pickup: f.accepts_pickup.checked,
    delivery_mode: mode, delivery_zones: zones,
    delivery_fee: num(f.delivery_fee.value), delivery_time: f.delivery_time.value.trim() || '30–45 min', min_order: num(f.min_order.value),
    opening_hours: hours, hours: null,
    allow_notes: f.allow_notes.checked, ask_cutlery: f.ask_cutlery.checked,
    schedule_enabled: f.schedule_enabled.checked, schedule_days: +f.schedule_days.value || 0, schedule_step: +f.schedule_step.value || 30,
    payment_methods: pay, pix_key: pixKey, pix_key_type: pixKey ? f.pix_key_type.value : null,
    pix_name: pixKey ? window.BoraPix.plain(f.pix_name.value).slice(0, 25) : null, pix_city: pixKey ? window.BoraPix.plain(f.pix_city.value).slice(0, 15) : null,
    pix_bank: f.pix_bank.value.trim().slice(0, 40) || null,
  };
}
sf().addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = buildPatch(); if (!patch) return;
  const btn = $('.biz-save button'); btn.disabled = true; btn.textContent = 'Salvando…';
  const oldSlug = R.slug;
  const { data, error } = await sb.from('restaurants').update(patch).eq('id', R.id).select().single();
  btn.disabled = false; btn.textContent = 'Salvar alterações';
  if (error) return toast(/link/.test(error.message || '') ? error.message : 'Não foi possível salvar. Confira os dados.');
  R = data; fillStore();
  toast(R.slug !== oldSlug ? 'Salvo! Seu link agora é ' + storeLink().replace(/^https?:\/\//, '') : 'Informações da loja salvas!');
});

boot();
