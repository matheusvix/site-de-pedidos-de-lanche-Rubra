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

  /* ---------- jogo do pedido (Corrida da Entrega) ---------- */
  const gf = () => $('#gm-form');
  function fillGame() {
    const f = gf();
    f.game_enabled.checked = R.game_enabled !== false;
    f.game_reward_enabled.checked = !!R.game_reward_enabled;
    f.game_reward_score.value = R.game_reward_score ?? 2000;
    f.game_reward_kind.value = R.game_reward_kind || 'percent';
    f.game_reward_value.value = String(R.game_reward_value ?? 10).replace('.', ',');
    f.game_reward_days.value = R.game_reward_days ?? 7;
    syncGame();
    const st = $('#gm-state'); const on = R.game_enabled !== false;
    st.textContent = !on ? 'Desligado' : R.game_reward_enabled ? 'Com prêmio' : 'Ligado'; st.classList.toggle('on', on);
  }
  function syncGame() {
    const f = gf(); const k = f.game_reward_kind.value;
    $('#gm-val-box').hidden = k === 'frete';
    $('#gm-val-box label').textContent = k === 'percent' ? 'Desconto (%)' : 'Desconto (R$)';
    [f.game_reward_score, f.game_reward_kind, f.game_reward_value, f.game_reward_days].forEach((i) => { i.disabled = !f.game_reward_enabled.checked; });
  }
  gf().addEventListener('change', syncGame);
  gf().addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = gf(); const k = f.game_reward_kind.value;
    const score = parseInt(String(f.game_reward_score.value).replace(/\D/g, ''), 10), val = num(f.game_reward_value.value), days = parseInt(f.game_reward_days.value, 10);
    if (f.game_reward_enabled.checked) {
      if (!(score >= 100 && score <= 1000000)) return toast('A meta de pontos vai de 100 a 1.000.000.');
      if (k !== 'frete' && !(val > 0 && val <= (k === 'percent' ? 100 : 1000))) return toast(k === 'percent' ? 'O desconto vai de 1 a 100%.' : 'O desconto vai de R$ 0,01 a R$ 1.000.');
      if (!(days >= 1 && days <= 60)) return toast('A validade vai de 1 a 60 dias.');
    }
    const row = { game_enabled: f.game_enabled.checked, game_reward_enabled: f.game_reward_enabled.checked };
    if (f.game_reward_enabled.checked) Object.assign(row, { game_reward_score: score, game_reward_kind: k, game_reward_value: k === 'frete' ? 0 : val, game_reward_days: days });
    const b = $('#gm-form button[type=submit]'); b.disabled = true;
    const { data, error } = await sb.from('restaurants').update(row).eq('id', R.id).select().single();
    b.disabled = false;
    if (error) return toast('Não foi possível salvar agora.');
    Object.assign(R, data); fillGame();
    toast(!data.game_enabled ? 'Jogo desligado.' : data.game_reward_enabled ? `Pronto! Quem fizer ${Number(data.game_reward_score).toLocaleString('pt-BR')} pontos ganha o cupom.` : 'Jogo ligado, sem prêmio.');
  });
  async function gameRank() {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const [{ data: top }, { count: plays }, { count: prizes }] = await Promise.all([
      sb.from('game_scores').select('name, score').eq('restaurant_id', R.id).eq('day', day).gt('score', 0).order('score', { ascending: false }).limit(10),
      sb.from('game_scores').select('id', { count: 'exact', head: true }).eq('restaurant_id', R.id).gte('day', new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })),
      sb.from('game_scores').select('id', { count: 'exact', head: true }).eq('restaurant_id', R.id).not('reward_coupon_id', 'is', null).gte('day', new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })),
    ]);
    $('#gm-rank').innerHTML = (top || []).map((g, i) => `<li><span class="gm-pos">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><b>${esc(g.name)}</b><span>${Number(g.score).toLocaleString('pt-BR')} pts</span></li>`).join('')
      || '<li class="gm-empty">Ninguém jogou hoje ainda.</li>';
    $('#gm-stats').textContent = plays ? `Últimos 30 dias: ${plays} pedido(s) com partida${prizes ? ` · ${prizes} cupom(ns) de prêmio` : ''}.` : '';
  }

  async function load() {
    if (typeof R === 'undefined' || !R || !has()) return;
    fillCb(); cbStats(); fillGame(); gameRank();
    const [rep, sent, cps] = await Promise.all([
      sb.rpc('reports_data', { p_rid: R.id, p_days: 365 }),
      sb.from('recover_sends').select('phone, sent_at').eq('restaurant_id', R.id).gte('sent_at', new Date(Date.now() - 60 * 86400000).toISOString()).order('sent_at'),
      sb.from('coupons').select('code, active, expires_at').eq('restaurant_id', R.id).eq('active', true).is('source', null),
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
