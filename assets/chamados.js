/* ============================================================
   BoraLanchar! — chamados das mesas no painel (plano Completo)
   O cliente lê o QR Code da mesa e toca em "Chamar garçom" ou "Pedir a conta".
   O chamado aparece aqui na hora (tempo real), com a campainha, em qualquer aba.
   Usa o que o painel.js já carregou: sb, R, STAFF_NAME, toast, esc, $, ding.
   Banco: supabase/chamar-garcom.sql
   ============================================================ */
window.BoraChamados = (() => {
  let CALLS = [], LABELS = {}, chan = null, started = false, tick = null;
  const PAY = { pix: 'Pix', cartao: 'cartão', dinheiro: 'dinheiro' };
  const ago = (t) => { const m = Math.max(0, Math.floor((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'agora' : `há ${m} min`; };
  const tname = (t) => { if (!t) return 'Mesa'; const k = t.kind === 'comanda' ? 'Comanda' : 'Mesa'; const l = String(t.label || '').trim(); return new RegExp(`^${k}\\b`, 'i').test(l) ? l : `${k} ${l}`; };
  const what = (c) => (c.kind === 'conta' ? `pediu a conta${c.pay ? ` · ${PAY[c.pay]}` : ''}` : 'chamou o garçom');

  async function start() {
    if (started || !window.BoraPlanos || !window.BoraPlanos.has(R.plan, 'mesas')) return;
    started = true;
    fillForm();
    await load();
    chan = sb.channel('chamados-' + R.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_calls', filter: `restaurant_id=eq.${R.id}` }, async (p) => {
        if (p.eventType === 'INSERT') {
          if (!LABELS[p.new.table_id]) await labels();
          if (!CALLS.some((c) => c.id === p.new.id)) CALLS.push(p.new);
          ding();
          const t = LABELS[p.new.table_id];
          toast(`${tname(t)} ${what(p.new)}!`);
          if ('Notification' in window && Notification.permission === 'granted') new Notification(`${tname(t)} ${what(p.new)}`, { body: 'Toque em Atender quando alguém for até a mesa.' });
        } else if (p.eventType === 'UPDATE') {
          const i = CALLS.findIndex((c) => c.id === p.new.id);
          if (p.new.done_at) { if (i >= 0) CALLS.splice(i, 1); } else if (i >= 0) CALLS[i] = p.new; else CALLS.push(p.new);
        }
        render();
      })
      .subscribe();
    // reserva: confere a cada 30 s caso a conexão em tempo real caia
    clearInterval(tick); tick = setInterval(() => { if (!document.hidden) load(); else render(); }, 30000);
  }
  async function labels() {
    const { data } = await sb.from('dining_tables').select('id, label, kind').eq('restaurant_id', R.id);
    LABELS = Object.fromEntries((data || []).map((t) => [t.id, t]));
  }
  async function load() {
    const since = new Date(Date.now() - 2 * 3600e3).toISOString();
    const [{ data }] = await Promise.all([
      sb.from('table_calls').select('*').eq('restaurant_id', R.id).is('done_at', null).gte('created_at', since).order('id'),
      labels(),
    ]);
    const before = new Set(CALLS.map((c) => c.id));
    CALLS = data || [];
    if (before.size && CALLS.some((c) => !before.has(c.id))) ding();
    render();
  }
  function row(c, big) {
    const t = LABELS[c.table_id];
    return `<div class="${big ? 'pc-call' : 'rx-row'} ${c.kind}"><div class="${big ? '' : 'rx-main'}"><b>${esc(tname(t))}</b> ${esc(what(c))}<small class="${big ? '' : 'adm-muted'}"> · ${ago(c.created_at)}</small></div>
      <button class="btn ${big ? 'btn-ghost' : 'btn-primary'}" type="button" data-cgdone="${c.id}">Atender</button></div>`;
  }
  function render() {
    const bar = $('#pc-calls');
    bar.innerHTML = CALLS.map((c) => row(c, true)).join(''); bar.hidden = !CALLS.length;
    const list = $('#cg-list');
    if (list) list.innerHTML = CALLS.map((c) => row(c, false)).join('') || '<p class="adm-empty">Nenhuma mesa chamando agora.</p>';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cgdone]'); if (!b) return;
    b.disabled = true; const id = +b.dataset.cgdone;
    const { error } = await sb.from('table_calls').update({ done_at: new Date().toISOString(), done_by: (STAFF_NAME || 'Painel').slice(0, 80) }).eq('id', id);
    if (error) { b.disabled = false; return toast('Não foi possível marcar como atendido.'); }
    CALLS = CALLS.filter((c) => c.id !== id); render();
  });

  function fillForm() {
    const f = $('#cg-form'); if (!f) return;
    f.calls_enabled.checked = R.calls_enabled !== false;
    f.google_review_url.value = R.google_review_url || '';
  }
  const form = $('#cg-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.currentTarget; const b = f.querySelector('[type=submit]');
    let g = f.google_review_url.value.trim();
    if (g && !/^https?:\/\//i.test(g)) g = 'https://' + g;
    g = g.replace(/^http:\/\//i, 'https://');
    if (g && !/^https:\/\/[^\s]+\.[^\s]+/i.test(g)) return toast('Confira o link do Google: ele começa com https://');
    b.disabled = true;
    const row = { calls_enabled: f.calls_enabled.checked, google_review_url: g || null };
    const { error } = await sb.from('restaurants').update(row).eq('id', R.id);
    b.disabled = false;
    if (error) return toast('Não foi possível salvar.');
    Object.assign(R, row); f.google_review_url.value = g; toast('Chamados das mesas salvos.');
  });
  return { start };
})();
