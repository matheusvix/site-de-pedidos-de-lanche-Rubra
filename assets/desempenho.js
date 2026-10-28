/* ============================================================
   BoraLanchar! — aba Desempenho (todos os planos)
   Usa o que o painel.js já carregou: sb, R, ORDERS, brl, esc, toast, $, $$.
   Banco: performance_report (supabase/etapa1-pedidos.sql)
   ============================================================ */
window.BoraDesempenho = (() => {
  let days = 7, busy = false;
  const MODE = { entrega: 'Entrega', retirada: 'Retirada no balcão', mesa: 'Mesa' };
  const SRC = { cardapio: 'Cardápio digital', balcao: 'Lançado no balcão', garcom: 'App do garçom', qrcode: 'QR Code da mesa', whatsapp: 'WhatsApp', instagram: 'Instagram' };
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const delta = (a, b) => {
    a = Number(a) || 0; b = Number(b) || 0;
    if (!b) return a ? '<span class="up">novo no período</span>' : '';
    const p = Math.round((a - b) / b * 100);
    return `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs. ${days} dias antes</span>`;
  };
  const bars = (el, list) => { const max = Math.max(1, ...list.map((x) => x.v)); el.innerHTML = list.map((x) => `<div class="fb" title="${esc(x.k)}: ${esc(x.t)}"><i style="height:${Math.round(x.v / max * 100)}%"></i><small>${esc(x.k)}</small></div>`).join(''); el.classList.toggle('many', list.length > 16); };
  const split = (arr, L) => { const tot = arr.reduce((s, x) => s + Number(x.v), 0) || 1; return arr.map((x) => `<div class="fs"><span>${esc(L[x.k] || x.k)} <small class="adm-muted">${x.n} pedido(s)</small></span><b>${brl(x.v)}</b><i style="--w:${Math.round(Number(x.v) / tot * 100)}%"></i></div>`).join('') || '<p class="adm-muted">Sem vendas no período.</p>'; };
  function now() {
    const os = typeof ORDERS !== 'undefined' ? ORDERS : [];
    $('#dk-novo').textContent = os.filter((o) => o.status === 'novo').length;
    $('#dk-prep').textContent = os.filter((o) => o.status === 'preparo').length;
    $('#dk-ready').textContent = os.filter((o) => ['pronto', 'saiu'].includes(o.status)).length;
  }
  async function load() {
    if (busy || typeof R === 'undefined' || !R) return; busy = true;
    const { data: r, error } = await sb.rpc('performance_report', { p_rid: R.id, p_days: days });
    busy = false;
    if (error) { toast('Não foi possível carregar o desempenho agora.'); return; }
    now();
    $('#dk-today').textContent = brl(r.today.total); $('#dk-today-n').textContent = `${r.today.orders} pedido(s)`;
    const tk = (x) => (x.orders ? Number(x.total) / x.orders : 0);
    $('#dk-total').textContent = brl(r.cur.total); $('#dk-total-d').innerHTML = delta(r.cur.total, r.prev.total);
    $('#dk-orders').textContent = r.cur.orders; $('#dk-orders-d').innerHTML = delta(r.cur.orders, r.prev.orders);
    $('#dk-ticket').textContent = brl(tk(r.cur)); $('#dk-ticket-d').innerHTML = delta(tk(r.cur), tk(r.prev));
    $('#dk-cancel').textContent = r.canceled;
    // dias
    const map = Object.fromEntries((r.by_day || []).map((x) => [x.d, Number(x.v)]));
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
    const list = []; for (let i = days - 1; i >= 0; i--) { const k = fmt.format(new Date(Date.now() - i * 86400000)); list.push({ k: k.slice(8, 10) + '/' + k.slice(5, 7), v: map[k] || 0, t: brl(map[k] || 0) }); }
    bars($('#dp-days'), list);
    // horas
    const hm = Object.fromEntries((r.by_hour || []).map((x) => [x.h, x.n])); const hs = (r.by_hour || []).map((x) => x.h);
    const a = Math.min(11, ...hs), b = Math.max(23, ...hs); const hl = []; for (let h = a; h <= b; h++) hl.push({ k: `${h}h`, v: hm[h] || 0, t: `${hm[h] || 0} pedido(s)` });
    bars($('#dp-hours'), hl);
    const peak = (r.by_hour || []).slice().sort((x, y) => y.n - x.n)[0];
    $('#dp-peak').textContent = peak ? `O pico é por volta das ${peak.h}h. Deixe a equipe e os motoboys prontos nesse horário.` : '';
    $('#dp-mode').innerHTML = split(r.by_mode || [], MODE);
    $('#dp-source').innerHTML = split(r.by_source || [], SRC);
    const wm = Object.fromEntries((r.by_weekday || []).map((x) => [x.d, Number(x.v)]));
    bars($('#dp-week'), [1, 2, 3, 4, 5, 6, 0].map((d) => ({ k: WD[d], v: wm[d] || 0, t: brl(wm[d] || 0) })));
  }
  $$('[data-dp]').forEach((b) => b.addEventListener('click', () => { days = +b.dataset.dp; $$('[data-dp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  return { load, now };
})();
