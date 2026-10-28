/* ============================================================
   BoraLanchar! — tela da cozinha (KDS)
   Usa o mesmo login do painel. Mostra os pedidos em 3 colunas
   (novos, em preparo, prontos) e atualiza sozinha em tempo real.
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
let R = null, ORDERS = [], filter = 'todos', fresh = new Set();
const ACT = ['novo', 'preparo', 'pronto'];
const toastEl = $('.k-toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3000); }
function state(msg, login) { $('#k-state').hidden = false; $('#k-msg').textContent = msg; $('#k-login').hidden = !login; }

/* ---------- som ---------- */
let audio = null;
$('#k-sound').addEventListener('click', () => {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (_) {}
  $('#k-sound').textContent = '🔔 Som ligado'; ding();
});
function ding() {
  if (!audio) return; const now = audio.currentTime;
  [[880, 0], [1320, 0.15], [880, 0.6], [1320, 0.75]].forEach(([f, t]) => {
    const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, now + t); g.gain.exponentialRampToValueAtTime(0.4, now + t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.4);
    o.start(now + t); o.stop(now + t + 0.45);
  });
}
$('#k-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });

/* ---------- quadro ---------- */
const mins = (t) => Math.floor((Date.now() - new Date(t)) / 60000);
const visible = (o) => ACT.includes(o.status) && o.mode !== undefined && (filter === 'todos' || o.mode === filter)
  && !(o.scheduled_for && new Date(o.scheduled_for) - Date.now() > 3600e3);
function next(o) {
  if (o.status === 'novo') return ['preparo', 'Começar preparo', ''];
  if (o.status === 'preparo') return ['pronto', 'Pronto ✓', 'ok'];
  if (o.status === 'pronto') return o.mode === 'entrega' ? ['saiu', 'Saiu para entrega', 'ok'] : ['entregue', o.mode === 'mesa' ? 'Servido' : 'Entregue', 'ok'];
  return null;
}
function card(o) {
  const m = mins(o.status === 'novo' ? o.created_at : o.created_at);
  const cls = m >= 30 ? 'late' : m >= 15 ? 'warn' : '';
  const n = next(o);
  const tag = o.mode === 'entrega' ? '<span class="k-tag ent">Entrega</span>' : o.mode === 'mesa' ? `<span class="k-tag mesa">${esc(o.delivery_info || 'Mesa').split(' · ')[0]}</span>` : '<span class="k-tag">Balcão</span>';
  const sched = o.scheduled_for ? ` · para ${new Date(o.scheduled_for).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<article class="k-card ${cls} ${fresh.has(o.id) ? 'fresh' : ''}" data-id="${o.id}">
    <div class="k-h"><b>#${o.number}</b><span class="k-time">${m} min</span></div>
    <div class="k-meta">${tag}${esc(o.customer_name)}${o.waiter ? ` · garçom ${esc(o.waiter)}` : ''}${sched}</div>
    <ul class="k-items">${(o.items || []).map((i) => `<li><span>${i.qty}×</span>${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}${i.note ? `<em>⚠ ${esc(i.note)}</em>` : ''}</li>`).join('')}</ul>
    ${o.notes ? `<div class="k-note">Obs.: ${esc(o.notes)}</div>` : ''}
    ${n ? `<button class="k-go ${n[2]}" type="button" data-st="${n[0]}">${n[1]}</button>` : ''}
  </article>`;
}
function render() {
  const list = ORDERS.filter(visible).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  ACT.forEach((st) => {
    const os = list.filter((o) => o.status === st);
    $('#c-' + st).textContent = os.length;
    $('#l-' + st).innerHTML = os.map(card).join('') || '<p class="k-empty">Nada por aqui</p>';
  });
  fresh.clear();
}
$('#k-board').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-st]'); if (!b) return;
  const id = +b.closest('[data-id]').dataset.id; const o = ORDERS.find((x) => x.id === id);
  b.disabled = true;
  const { error } = await sb.from('orders').update({ status: b.dataset.st }).eq('id', id);
  if (error) { b.disabled = false; toast('Não foi possível atualizar. Confira a internet.'); return; }
  o.status = b.dataset.st; render();
});
document.querySelectorAll('[data-kf]').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.kf; document.querySelectorAll('[data-kf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render();
}));

async function load() {
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const { data, error } = await sb.from('orders').select('id, number, status, mode, customer_name, items, notes, created_at, delivery_info, waiter, scheduled_for')
    .eq('restaurant_id', R.id).in('status', ACT).gte('created_at', since).order('created_at').limit(200);
  if (error) { toast('Sem conexão. Tentando de novo…'); return; }
  ORDERS = data || []; render();
}
function listen() {
  sb.channel('cozinha-' + R.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${R.id}` }, (p) => {
      const o = p.new; if (!o || !o.id) return;
      const i = ORDERS.findIndex((x) => x.id === o.id);
      const isNew = i < 0 && ACT.includes(o.status) && o.number > 0;
      if (i >= 0) ORDERS[i] = { ...ORDERS[i], ...o }; else if (isNew) ORDERS.push(o);
      if (isNew) { fresh.add(o.id); ding(); toast(`Pedido novo #${o.number}!`); }
      render();
    })
    .subscribe();
}
function clock() { $('#k-clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

async function boot() {
  if (!sb) return state('Sistema indisponível.');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return state('Entre no painel da loja neste aparelho e depois abra a tela da cozinha de novo.', true);
  let { data: r } = await sb.from('restaurants').select('id, name').eq('owner_id', session.user.id).maybeSingle();
  if (!r) { // colaborador da loja
    const { data: ms } = await sb.rpc('my_store');
    if (ms && ms.id) r = (await sb.from('restaurants').select('id, name').eq('id', ms.id).maybeSingle()).data;
  }
  if (!r) return state('Não encontramos a sua loja. Entre no painel primeiro.', true);
  R = r; $('#k-store').textContent = `Cozinha · ${r.name}`; document.title = `Cozinha · ${r.name}`;
  $('#k-state').hidden = true;
  await load(); listen(); clock();
  setInterval(() => { clock(); if (!document.hidden) render(); }, 30000);
  setInterval(() => { if (!document.hidden) load(); }, 60000); // reserva caso o tempo real caia
}
boot();
