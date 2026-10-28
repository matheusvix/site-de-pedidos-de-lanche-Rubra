/* ============================================================
   BoraLanchar! — Marketing na aba Cupons: cashback e recuperar clientes
   Usa o que o painel.js já carregou: sb, R, brl, esc, num, money, toast, digits, $, $$.
   Banco: supabase/etapa3-marketing.sql
   ============================================================ */
window.BoraMarketing = (() => {
  const has = () => window.BoraPlanos.has(R.plan, 'cupons');
  const MKEY = () => 'bora-recuperar-msg-' + R.id;
  const DEF = 'Oi, {nome}! Faz um tempinho que você não pede na {loja} e a gente sentiu sua falta 😊 Separamos um presente: use o cupom {cupom} no seu próximo pedido. Peça aqui: {link}';
  const DEF_NO = 'Oi, {nome}! Faz um tempinho que você não pede na {loja} e a gente sentiu sua falta 😊 Tem novidade no cardápio, dá uma olhada: {link}';
  let CLIENTS = [], SENT = {}, COUPONS = [];

  /* ---------- cashback ---------- */
  function fillCb() {
    const f = $('#cb-form');
    f.cashback_enabled.checked = !!R.cashback_enabled;
    f.cashback_pct.value = String(R.cashback_pct ?? 5).replace('.', ',');
    f.cashback_days.value = R.cashback_days ?? 30;
    const st = $('#cb-state'); st.textContent = R.cashback_enabled ? 'Ligado' : 'Desligado'; st.classList.toggle('on', !!R.cashback_enabled);
  }
  async function cbStats() {
    const { data } = await sb.from('cashback_wallets').select('balance, expires_at').eq('restaurant_id', R.id).gt('balance', 0).limit(5000);
    const live = (data || []).filter((w) => !w.expires_at || new Date(w.expires_at) > new Date());
    const tot = live.reduce((s, w) => s + Number(w.balance), 0);
    $('#cb-stats').innerHTML = R.cashback_enabled || live.length
      ? `<div class="cb-kpi"><b>${live.length}</b><span>cliente(s) com saldo</span></div><div class="cb-kpi"><b>${brl(tot)}</b><span>em saldo para usar</span></div>` : '';
  }
  $('#cb-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const pct = num(f.cashback_pct.value), days = parseInt(f.cashback_days.value, 10);
    if (!(pct >= 0.5 && pct <= 50)) return toast('O cashback precisa ser de 0,5% a 50%.');
    if (!(days >= 1 && days <= 365)) return toast('A validade precisa ser de 1 a 365 dias.');
    const b = $('[type=submit]', f); b.disabled = true;
    const { data, error } = await sb.from('restaurants').update({ cashback_enabled: f.cashback_enabled.checked, cashback_pct: pct, cashback_days: days }).eq('id', R.id).select().single();
    b.disabled = false;
    if (error) return toast('Não foi possível salvar o cashback.');
    Object.assign(R, { cashback_enabled: data.cashback_enabled, cashback_pct: data.cashback_pct, cashback_days: data.cashback_days });
    fillCb(); cbStats(); toast(data.cashback_enabled ? `Cashback ligado: ${String(pct).replace('.', ',')}% volta para o cliente.` : 'Cashback desligado.');
  });

  /* ---------- recuperar clientes ---------- */
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const link = () => (typeof storeLink === 'function' ? storeLink() : `${location.origin}/l/${R.slug}`);
  function msgFor(c) {
    const cp = $('#rc-cp').value;
    let t = $('#rc-msg').value.trim() || (cp ? DEF : DEF_NO);
    return t.replace(/\{nome\}/g, first(c.name)).replace(/\{loja\}/g, R.name).replace(/\{cupom\}/g, cp || '').replace(/\{link\}/g, link());
  }
  function renderRc() {
    const d = +$('#rc-days').value;
    const list = CLIENTS.filter((c) => (Date.now() - new Date(c.last)) / 86400000 >= d).sort((a, b) => b.total - a.total);
    $('#rc-list').innerHTML = list.slice(0, 200).map((c) => {
      const sent = SENT[c.phone]; const ago = Math.floor((Date.now() - new Date(c.last)) / 86400000);
      return `<div class="rx-row" data-rc="${esc(c.phone)}"><div class="rx-main"><b>${esc(c.name)}</b><small class="adm-muted">${c.orders} pedido(s) · ${brl(c.total)} · sem pedir há ${ago} dias${sent ? ` · chamado em ${new Date(sent).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}</small></div>
        <div class="rx-acts"><a class="btn ${sent ? 'btn-ghost' : 'btn-outline'}" href="#" data-rcsend>${sent ? 'Chamar de novo' : 'Chamar no WhatsApp'}</a></div></div>`;
    }).join('') || '<p class="adm-empty">Nenhum cliente sumido nesse período. Ótimo sinal!</p>';
    if (list.length > 200) $('#rc-list').insertAdjacentHTML('beforeend', `<p class="adm-muted">Mostrando os 200 que mais gastaram de ${list.length}.</p>`);
  }
  $('#rc-list').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-rcsend]'); if (!a) return; e.preventDefault();
    const ph = a.closest('[data-rc]').dataset.rc; const c = CLIENTS.find((x) => x.phone === ph);
    window.open(`https://wa.me/55${ph}?text=${encodeURIComponent(msgFor(c))}`, '_blank', 'noopener');
    SENT[ph] = new Date().toISOString(); renderRc();
    sb.from('recover_sends').insert({ restaurant_id: R.id, phone: ph }).then(() => {}, () => {});
  });
  $('#rc-days').addEventListener('change', renderRc);
  $('#rc-cp').addEventListener('change', () => {
    const m = $('#rc-msg'); const cp = $('#rc-cp').value;
    if (!m.value.trim() || m.value === DEF || m.value === DEF_NO) m.value = cp ? DEF : DEF_NO;
  });
  $('#rc-msg').addEventListener('input', (e) => { try { localStorage.setItem(MKEY(), e.target.value); } catch (_) {} });

  async function load() {
    if (typeof R === 'undefined' || !R || !has()) return;
    fillCb(); cbStats();
    const [rep, sent, cps] = await Promise.all([
      sb.rpc('reports_data', { p_rid: R.id, p_days: 365 }),
      sb.from('recover_sends').select('phone, sent_at').eq('restaurant_id', R.id).gte('sent_at', new Date(Date.now() - 60 * 86400000).toISOString()).order('sent_at'),
      sb.from('coupons').select('code, active, expires_at').eq('restaurant_id', R.id).eq('active', true),
    ]);
    CLIENTS = (rep.data && rep.data.clients) || [];
    SENT = {}; (sent.data || []).forEach((s) => { SENT[s.phone] = s.sent_at; });
    COUPONS = (cps.data || []).filter((c) => !c.expires_at || new Date(c.expires_at) > new Date());
    const sel = $('#rc-cp'); const cur = sel.value;
    sel.innerHTML = '<option value="">Sem cupom</option>' + COUPONS.map((c) => `<option value="${esc(c.code)}">${esc(c.code)}</option>`).join('');
    if (COUPONS.some((c) => c.code === cur)) sel.value = cur;
    let saved = ''; try { saved = localStorage.getItem(MKEY()) || ''; } catch (_) {}
    $('#rc-msg').value = saved || (sel.value ? DEF : DEF_NO);
    renderRc();
  }
  return { load };
})();
