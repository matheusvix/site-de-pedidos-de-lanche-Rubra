/* ============================================================
   BoraLanchar! — recursos por plano no painel
   Profissional: Mensagens (caixa de entrada única), Cupons e fidelidade
   Completo:     Mesas e app do garçom, Estoque (ficha técnica) e Financeiro
   Usa o que o painel.js já carregou: sb, R, SUPPORT, SITE, toast, esc, brl, num, money, digits, $, $$, ding, waSupport.
   Banco: supabase/recursos-planos.sql
   ============================================================ */
window.BoraRecursos = (() => {
  let started = false;
  const has = (f) => window.BoraPlanos.has(R.plan, f);
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 60000); if (m < 1) return 'agora'; if (m < 60) return `${m} min`; const h = Math.round(m / 60); if (h < 24) return `${h} h`; return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
  const hm = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dm = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtPhone = (d) => { d = String(d || '').replace(/\D/g, ''); if (d.startsWith('55') && d.length >= 12) d = d.slice(2); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
  const qtyFmt = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const errMsg = (e, fallback) => { const m = (e && e.message) || ''; return /violates|duplicate|permission|policy|JWT|fetch/i.test(m) || !m ? fallback : m.replace(/^.*?:\s*/, ''); };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- janela genérica ---------- */
  const rxd = $('#rx-dialog'); let rxSubmit = null;
  function dialog({ title, sub = '', body, ok = 'Salvar', danger = null, onSubmit, onDanger }) {
    $('#rx-title').textContent = title; $('#rx-sub').textContent = sub; $('#rx-sub').hidden = !sub;
    $('#rx-body').innerHTML = body; $('#rx-err').textContent = '';
    $('#rx-actions').innerHTML = (danger ? `<button class="btn btn-ghost adm-danger" type="button" data-rxdanger>${esc(danger)}</button>` : '<span></span>')
      + `<button class="btn btn-primary" type="submit">${esc(ok)}</button>`;
    rxSubmit = onSubmit;
    const d = $('[data-rxdanger]', rxd); if (d) d.onclick = async () => { d.disabled = true; const e = await onDanger(); d.disabled = false; if (e) $('#rx-err').textContent = e; else rxd.close(); };
    rxd.showModal();
    const first = $('#rx-body input:not([type=checkbox]):not([type=hidden]):not([type=radio]), #rx-body select', rxd);
    if (first && matchMedia('(pointer: fine)').matches) first.focus(); // no celular não abre o teclado sozinho
  }
  $('#rx-form').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!rxSubmit) return;
    const b = $('#rx-actions [type=submit]'); b.disabled = true;
    const err = await rxSubmit($('#rx-form'));
    b.disabled = false;
    if (err) $('#rx-err').textContent = err; else rxd.close();
  });
  rxd.addEventListener('click', (e) => { if (e.target === rxd || e.target.closest('[data-rxclose]')) rxd.close(); });
  const field = (label, html, hint = '') => `<div class="field"><label>${label}</label>${html}${hint ? `<small class="adm-muted">${hint}</small>` : ''}</div>`;

  /* ---------- planos: trava o que não está no plano ---------- */
  const DESC = {
    inbox: 'Responda o WhatsApp e o chat do cardápio num lugar só, sem perder nenhum cliente.',
    cupons: 'Crie cupons de desconto e um cartão fidelidade digital ("compre 10, ganhe 1") para o cliente voltar sempre.',
    robo: 'Um atendente automático no WhatsApp que manda o cardápio, responde dúvidas e avisa o status do pedido.',
    mesas: 'QR Code em cada mesa, app do garçom para lançar pedidos e fechar a conta com taxa de serviço.',
    estoque: 'Baixa automática dos insumos a cada pedido, relatório de vendas, despesas, lucro e controle de caixa.',
  };
  function applyLocks() {
    $$('.p-tabs [data-feat]').forEach((b) => { const ok = has(b.dataset.feat); b.classList.toggle('locked', !ok); if (!ok && !b.querySelector('.lock-ic')) b.insertAdjacentHTML('beforeend', '<span class="lock-ic" aria-label="Bloqueado no seu plano">🔒</span>'); });
    $$('[data-panel][data-feat]').forEach((sec) => {
      const f = sec.dataset.feat; if (has(f) || sec.querySelector('.lock-card')) return;
      [...sec.children].forEach((c) => { c.hidden = true; });
      const min = window.BoraPlanos.min(f);
      sec.insertAdjacentHTML('afterbegin', `<div class="lock-card">
        <span class="lock-big" aria-hidden="true">🔒</span>
        <h1>${esc(f === 'estoque' && sec.dataset.panel === 'financeiro' ? 'Financeiro' : window.BoraPlanos.nome(f))}</h1>
        <p>${esc(DESC[f] || '')}</p>
        <p class="adm-muted">Disponível no plano <b>${min}</b>. Seu plano hoje: <b>${esc(R.plan)}</b>.</p>
        <div class="lock-acts">${SUPPORT ? '' : `<a class="btn btn-primary" href="assinar.html?plano=${min.toLowerCase()}">Mudar para o plano ${min}</a>`}
        <a class="btn btn-ghost" href="${waSupport(`Olá! Quero liberar ${window.BoraPlanos.nome(f)} na minha loja ${R.name}.`)}" target="_blank" rel="noopener">Tirar dúvidas</a></div>
      </div>`);
    });
  }

  /* ============================================================
     CUPONS E FIDELIDADE
     ============================================================ */
  let COUPONS = [];
  const KIND = { percent: '% de desconto', fixed: 'R$ de desconto', frete: 'Entrega grátis' };
  const cpLabel = (c) => (c.kind === 'percent' ? `${String(c.value).replace('.', ',')}% de desconto` : c.kind === 'fixed' ? `${brl(c.value)} de desconto` : 'Entrega grátis');
  async function loadCupons() {
    const { data } = await sb.from('coupons').select('*').eq('restaurant_id', R.id).order('created_at', { ascending: false });
    COUPONS = data || []; renderCupons(); fillLoyalty(); loadLoyalCustomers();
  }
  function renderCupons() {
    const now = Date.now();
    $('#cp-list').innerHTML = COUPONS.map((c) => {
      const expired = c.expires_at && new Date(c.expires_at) < now, out = c.max_uses && c.uses >= c.max_uses;
      const st = !c.active ? ['Pausado', ''] : expired ? ['Expirado', 'bad'] : out ? ['Esgotado', 'bad'] : ['Ativo', 'on'];
      const cond = [Number(c.min_order) > 0 ? `pedido a partir de ${brl(c.min_order)}` : '', c.max_uses ? `${c.uses}/${c.max_uses} usos` : `${c.uses} uso(s)`,
        c.expires_at ? `até ${new Date(c.expires_at).toLocaleDateString('pt-BR')}` : '', c.once_per_customer ? '1 vez por cliente' : ''].filter(Boolean).join(' · ');
      return `<div class="rx-row" data-cp="${c.id}"><div class="rx-main"><b class="cp-code">${esc(c.code)}</b><span>${esc(cpLabel(c))}</span><small class="adm-muted">${esc(cond)}</small></div>
        <span class="mp-state ${st[1]}">${st[0]}</span>
        <div class="rx-acts"><button class="btn btn-ghost" type="button" data-cpshare>Divulgar</button><button class="btn btn-outline" type="button" data-cpedit>Editar</button></div></div>`;
    }).join('') || '<p class="adm-empty">Nenhum cupom ainda. Que tal um "BEMVINDO10" para o primeiro pedido?</p>';
  }
  function couponDialog(c) {
    const exp = c && c.expires_at ? new Date(c.expires_at).toISOString().slice(0, 10) : '';
    dialog({
      title: c ? `Cupom ${c.code}` : 'Novo cupom', sub: 'O cliente digita o código no carrinho, antes de finalizar.',
      body: field('Código do cupom', `<input name="code" maxlength="20" required value="${esc(c ? c.code : '')}" placeholder="Ex.: BEMVINDO10" style="text-transform:uppercase" autocomplete="off">`, 'Letras e números, sem espaço.')
        + `<div class="row2">${field('Tipo', `<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${c && c.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
           ${field('Valor', `<input name="value" inputmode="decimal" value="${c ? money(c.value) : ''}" placeholder="10">`, 'Em % ou em R$')}</div>`
        + `<div class="row2">${field('Pedido mínimo (R$)', `<input name="min_order" inputmode="decimal" value="${c && Number(c.min_order) ? money(c.min_order) : ''}" placeholder="0,00">`)}
           ${field('Limite de usos', `<input name="max_uses" inputmode="numeric" value="${c && c.max_uses ? c.max_uses : ''}" placeholder="Sem limite">`)}</div>`
        + field('Válido até', `<input name="expires" type="date" value="${exp}">`, 'Deixe em branco para não expirar.')
        + `<label class="check"><input type="checkbox" name="once" ${!c || c.once_per_customer ? 'checked' : ''}> <span>Cada cliente usa só uma vez (pelo WhatsApp)</span></label>
           <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> <span>Cupom ativo</span></label>`,
      ok: c ? 'Salvar cupom' : 'Criar cupom', danger: c ? 'Excluir' : null,
      onDanger: async () => { if (!confirm(`Excluir o cupom ${c.code}?`)) return 'Cancelado.'; const { error } = await sb.from('coupons').delete().eq('id', c.id); if (error) return 'Não foi possível excluir.'; await loadCupons(); toast('Cupom excluído.'); return null; },
      onSubmit: async (f) => {
        const code = f.code.value.trim().toUpperCase().replace(/\s+/g, '');
        if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return 'O código precisa ter de 3 a 20 letras ou números, sem espaço nem acento.';
        const kind = f.kind.value, value = kind === 'frete' ? 0 : num(f.value.value);
        if (kind !== 'frete' && !(value > 0)) return 'Informe o valor do desconto.';
        if (kind === 'percent' && value > 100) return 'A porcentagem vai até 100%.';
        const maxU = f.max_uses.value.trim() ? parseInt(f.max_uses.value, 10) : null;
        if (maxU !== null && !(maxU > 0)) return 'Limite de usos inválido.';
        const row = { code, kind, value, min_order: num(f.min_order.value), max_uses: maxU, once_per_customer: f.once.checked, active: f.active.checked,
          expires_at: f.expires.value ? new Date(`${f.expires.value}T23:59:59-03:00`).toISOString() : null };
        const q = c ? sb.from('coupons').update(row).eq('id', c.id) : sb.from('coupons').insert({ ...row, restaurant_id: R.id });
        const { error } = await q;
        if (error) return /duplicate|unique/i.test(error.message) ? 'Já existe um cupom com esse código.' : 'Não foi possível salvar o cupom.';
        await loadCupons(); toast(c ? 'Cupom atualizado.' : `Cupom ${code} criado! Divulgue para os clientes.`); return null;
      },
    });
    const kindSel = $('#rx-body [name=kind]'); const valBox = $('#rx-body [name=value]').closest('.field');
    const sync = () => { valBox.hidden = kindSel.value === 'frete'; }; kindSel.addEventListener('change', sync); sync();
  }
  $('#cp-new').addEventListener('click', () => couponDialog(null));
  $('#cp-list').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-cp]'); if (!row) return; const c = COUPONS.find((x) => x.id === +row.dataset.cp);
    if (e.target.closest('[data-cpedit]')) return couponDialog(c);
    if (e.target.closest('[data-cpshare]')) {
      const txt = `🎟️ Cupom ${c.code}: ${cpLabel(c)}${Number(c.min_order) > 0 ? ` em pedidos a partir de ${brl(c.min_order)}` : ''} na ${R.name}! Peça pelo cardápio: ${SITE}/l/${R.slug}`;
      try { await navigator.clipboard.writeText(txt); toast('Texto do cupom copiado! Cole no WhatsApp ou no Instagram.'); } catch (_) { prompt('Copie o texto do cupom:', txt); }
    }
  });
  function fillLoyalty() {
    const f = $('#ly-form');
    f.loyalty_enabled.checked = !!R.loyalty_enabled; f.loyalty_goal.value = R.loyalty_goal || 10;
    f.loyalty_reward.value = Number(R.loyalty_reward) ? money(R.loyalty_reward) : ''; f.loyalty_min.value = Number(R.loyalty_min) ? money(R.loyalty_min) : '';
    $('#ly-state').textContent = R.loyalty_enabled ? 'Ligado' : 'Desligado'; $('#ly-state').classList.toggle('on', !!R.loyalty_enabled);
  }
  $('#ly-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const goal = parseInt(f.loyalty_goal.value, 10), reward = num(f.loyalty_reward.value), min = num(f.loyalty_min.value);
    if (!(goal >= 2 && goal <= 50)) return toast('Use de 2 a 50 pedidos para ganhar o prêmio.');
    if (f.loyalty_enabled.checked && !(reward > 0)) return toast('Informe o valor do prêmio em reais.');
    if (reward > 1000) return toast('O prêmio vai até R$ 1.000,00.');
    const { data, error } = await sb.from('restaurants').update({ loyalty_enabled: f.loyalty_enabled.checked, loyalty_goal: goal, loyalty_reward: reward, loyalty_min: min }).eq('id', R.id).select().single();
    if (error) return toast('Não foi possível salvar a fidelidade.');
    R = data; fillLoyalty(); toast(R.loyalty_enabled ? `Fidelidade ligada: a cada ${goal} pedidos o cliente ganha ${brl(reward)}.` : 'Fidelidade desligada.');
  });
  async function loadLoyalCustomers() {
    const { data } = await sb.from('loyalty_cards').select('*').eq('restaurant_id', R.id).order('orders', { ascending: false }).limit(20);
    const goal = R.loyalty_goal || 10;
    $('#ly-list').innerHTML = (data || []).map((c) => `<div class="rx-row"><div class="rx-main"><b>${esc(c.name || fmtPhone(c.phone))}</b><small class="adm-muted">${esc(fmtPhone(c.phone))} · ${c.orders} pedido(s)</small></div>
      <div class="stamps" aria-label="${c.stamps} de ${goal} selos">${Array.from({ length: Math.min(goal, 12) }, (_, i) => `<i class="${i < c.stamps * Math.min(goal, 12) / goal ? 'on' : ''}"></i>`).join('')}</div>
      ${c.rewards ? `<span class="mp-state on">${c.rewards} prêmio(s)</span>` : ''}</div>`).join('') || '<p class="adm-empty">Os clientes aparecem aqui depois do primeiro pedido entregue com a fidelidade ligada.</p>';
  }

  /* ============================================================
     MENSAGENS — caixa de entrada única (chat do cardápio + WhatsApp)
     ============================================================ */
  let THREADS = [], WACONV = [], OPEN = null, ich = 'todos', inboxChan = null, waOn = false;
  async function loadInbox() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [a, b, c] = await Promise.all([
      sb.from('chat_threads').select('*').eq('restaurant_id', R.id).gte('last_msg_at', since).order('last_msg_at', { ascending: false }).limit(60),
      sb.from('wa_conversations').select('*').eq('restaurant_id', R.id).gte('last_msg_at', since).order('last_msg_at', { ascending: false }).limit(60),
      sb.from('whatsapp_bots').select('phone_number_id').eq('restaurant_id', R.id).maybeSingle(),
    ]);
    THREADS = a.data || []; WACONV = b.data || []; waOn = !!(c.data && c.data.phone_number_id);
    $('#ich-wa').classList.toggle('on', waOn); $('#ich-wa').textContent = waOn ? 'WhatsApp' : 'WhatsApp · conecte na aba Robô';
    renderInbox();
  }
  const items = () => [
    ...THREADS.map((t) => ({ ch: 'site', id: t.id, name: t.name, sub: t.phone ? fmtPhone(t.phone) : 'Chat do cardápio', last: t.last_msg_at, unread: t.unread, raw: t })),
    ...WACONV.map((c) => ({ ch: 'wa', id: c.id, name: c.name || fmtPhone(c.wa_id), sub: fmtPhone(c.wa_id), last: c.last_msg_at, unread: c.unread, raw: c })),
  ].sort((x, y) => new Date(y.last) - new Date(x.last));
  function renderInbox() {
    const all = items(); const list = all.filter((i) => ich === 'todos' || i.ch === ich);
    const unread = all.reduce((s, i) => s + (i.unread || 0), 0);
    $('#inbox-count').hidden = !unread; $('#inbox-count').textContent = unread;
    $('#inbox-list').innerHTML = list.map((i) => `<button type="button" class="inbox-item ${OPEN && OPEN.ch === i.ch && OPEN.id === i.id ? 'on' : ''}" data-ich-id="${i.ch}:${i.id}">
      <span class="ch-dot ${i.ch}" aria-hidden="true">${i.ch === 'wa' ? 'W' : 'C'}</span>
      <span class="inbox-who"><b>${esc(i.name)}</b><small>${i.ch === 'wa' ? 'WhatsApp' : 'Chat do cardápio'} · ${esc(i.sub)}</small></span>
      <span class="inbox-meta"><small>${ago(i.last)}</small>${i.unread ? `<b class="p-count">${i.unread}</b>` : ''}</span></button>`).join('')
      || `<p class="adm-empty">${ich === 'wa' && !waOn ? 'Conecte o número na aba "Robô WhatsApp" para as conversas do WhatsApp aparecerem aqui.' : 'Nenhuma conversa ainda. Quando um cliente mandar mensagem pelo cardápio, ela aparece aqui.'}</p>`;
  }
  $$('[data-ich]').forEach((b) => b.addEventListener('click', () => { ich = b.dataset.ich; $$('[data-ich]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderInbox(); }));
  $('#inbox-list').addEventListener('click', (e) => { const b = e.target.closest('[data-ich-id]'); if (!b) return; const [ch, id] = b.dataset.ichId.split(':'); openThread(ch, +id); });
  async function openThread(ch, id) {
    const it = items().find((i) => i.ch === ch && i.id === id); if (!it) return;
    OPEN = { ch, id, raw: it.raw };
    $('#inbox-empty').hidden = true; $('#inbox-open').hidden = false; $('#inbox-thread').classList.add('open');
    $('#it-name').textContent = it.name; $('#it-sub').textContent = `${ch === 'wa' ? 'WhatsApp' : 'Chat do cardápio'} · ${it.sub}`;
    const phone = ch === 'wa' ? it.raw.wa_id : it.raw.phone; const d = digits(phone);
    $('#it-wa').hidden = d.length < 10; if (d.length >= 10) $('#it-wa').href = `https://wa.me/${d.length <= 11 ? '55' + d : d}`;
    $('#it-wa').hidden = ch === 'wa' || d.length < 10;
    renderInbox(); await loadThreadMsgs();
    if (it.unread) {
      if (ch === 'site') await sb.from('chat_threads').update({ unread: 0 }).eq('id', id); else await sb.from('wa_conversations').update({ unread: 0 }).eq('id', id);
      it.raw.unread = 0; renderInbox();
    }
  }
  async function loadThreadMsgs() {
    if (!OPEN) return; const box = $('#it-msgs');
    let msgs = [];
    if (OPEN.ch === 'site') {
      const { data } = await sb.from('chat_messages').select('*').eq('thread_id', OPEN.id).order('created_at', { ascending: false }).limit(100);
      msgs = (data || []).reverse().map((m) => ({ out: m.sender === 'loja', who: m.sender === 'loja' ? 'Loja' : '', body: m.body, at: m.created_at }));
    } else {
      const { data } = await sb.from('wa_messages').select('*').eq('conversation_id', OPEN.id).order('created_at', { ascending: false }).limit(100);
      const who = { robo: '🤖 Robô', loja: 'Loja', aviso: '🔔 Aviso' };
      msgs = (data || []).reverse().map((m) => ({ out: m.direction === 'out', who: who[m.sender] || '', body: m.body || '', at: m.created_at, failed: m.status === 'failed' }));
    }
    box.innerHTML = msgs.map((m) => `<div class="wa-msg ${m.out ? 'out' : 'in'} ${m.failed ? 'failed' : ''}">${m.out && m.who ? `<span class="wa-who">${esc(m.who)}</span>` : ''}${esc(m.body).replace(/\n/g, '<br>')}<span class="wa-foot">${dm(m.at)}</span></div>`).join('') || '<p class="adm-muted">Sem mensagens.</p>';
    box.scrollTop = box.scrollHeight;
  }
  $('#it-back').addEventListener('click', () => { OPEN = null; $('#inbox-open').hidden = true; $('#inbox-empty').hidden = false; $('#inbox-thread').classList.remove('open'); renderInbox(); });
  $('#it-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const text = $('#it-text').value.trim(); if (!text || !OPEN) return;
    const b = $('#it-form button'); b.disabled = true;
    let error = null;
    if (OPEN.ch === 'site') { const r = await sb.rpc('chat_reply', { p_thread: OPEN.id, p_body: text }); error = r.error && 'Não foi possível enviar.'; }
    else {
      const { error: e2 } = await sb.functions.invoke('whatsapp', { body: { action: 'send', conversation_id: OPEN.id, text } });
      if (e2) { error = 'Não foi possível enviar pelo WhatsApp.'; try { const j = await e2.context.json(); error = j.error || error; } catch (_) {} }
    }
    b.disabled = false; if (error) return toast(error);
    $('#it-text').value = ''; await loadThreadMsgs();
  });
  $('#it-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#it-form').requestSubmit(); } });
  const refreshInbox = debounce(async () => { const before = items().reduce((s, i) => s + (i.unread || 0), 0); await loadInbox(); const now = items().reduce((s, i) => s + (i.unread || 0), 0); if (now > before && typeof ding === 'function') { ding(); toast('Mensagem nova de cliente na aba Mensagens.'); } if (OPEN) loadThreadMsgs(); }, 400);
  function listenInbox() {
    if (inboxChan) sb.removeChannel(inboxChan);
    inboxChan = sb.channel('inbox-' + R.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads', filter: `restaurant_id=eq.${R.id}` }, refreshInbox)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations', filter: `restaurant_id=eq.${R.id}` }, refreshInbox)
      .subscribe();
    setInterval(() => { if (!document.hidden) refreshInbox(); }, 30000);
  }

  /* ============================================================
     MESAS E GARÇOM
     ============================================================ */
  let TABLES = [], BILLS = [], BORD = [], WAITERS = [];
  const tableUrl = (t) => `${SITE}/loja.html?r=${encodeURIComponent(R.slug)}&mesa=${t.token}`;
  async function loadMesas() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [t, b, w, c] = await Promise.all([
      sb.from('dining_tables').select('*').eq('restaurant_id', R.id).order('position').order('id'),
      sb.from('table_bills').select('*').eq('restaurant_id', R.id).is('closed_at', null),
      sb.from('waiters').select('id,name,active,created_at').eq('restaurant_id', R.id).order('name'),
      sb.from('table_bills').select('*, dining_tables(label)').eq('restaurant_id', R.id).gte('closed_at', today.toISOString()).order('closed_at', { ascending: false }),
    ]);
    TABLES = t.data || []; BILLS = b.data || []; WAITERS = w.data || [];
    BORD = [];
    if (BILLS.length) { const o = await sb.from('orders').select('*').in('bill_id', BILLS.map((x) => x.id)).neq('status', 'cancelado').order('created_at'); BORD = o.data || []; }
    renderMesas(c.data || []); renderWaiters();
    $('#gc-link').textContent = `${SITE}/garcom.html?loja=${R.slug}`;
  }
  function billOf(t) { const b = BILLS.find((x) => x.table_id === t.id); if (!b) return null; const os = BORD.filter((o) => o.bill_id === b.id); return { ...b, orders: os, total: os.reduce((s, o) => s + Number(o.total), 0), ready: os.filter((o) => o.status === 'pronto').length, kitchen: os.filter((o) => ['novo', 'preparo'].includes(o.status)).length }; }
  function renderMesas(closed) {
    const ready = TABLES.reduce((s, t) => { const b = billOf(t); return s + (b ? b.ready : 0); }, 0);
    $('#mesas-count').hidden = !ready; $('#mesas-count').textContent = ready;
    $('#ms-grid').innerHTML = TABLES.map((t) => {
      const b = billOf(t);
      return `<div class="ms-card ${b ? 'busy' : ''} ${t.active ? '' : 'off'}" data-ms="${t.id}">
        <div class="ms-top"><b class="ms-label">Mesa ${esc(t.label)}</b><span class="mp-state ${b ? 'warn' : 'on'}">${!t.active ? 'Desativada' : b ? 'Ocupada' : 'Livre'}</span></div>
        ${b ? `<div class="ms-total">${brl(b.total)}</div><small class="adm-muted">${b.orders.length} pedido(s) · aberta há ${ago(b.opened_at)}</small>${b.ready ? `<span class="ms-ready">${b.ready} pronto(s) para servir</span>` : b.kitchen ? `<span class="ms-kitchen">${b.kitchen} na cozinha</span>` : ''}` : '<small class="adm-muted">Sem conta aberta</small>'}
        <div class="ms-acts">${b ? '<button class="btn btn-primary" type="button" data-msbill>Ver conta</button>' : ''}<button class="btn btn-ghost" type="button" data-msqr>QR Code</button><button class="btn btn-ghost" type="button" data-msedit>Editar</button></div>
      </div>`;
    }).join('') || '<div class="p-card ms-empty"><b>Nenhuma mesa ainda</b><span class="adm-muted">Crie as mesas do salão (1, 2, 3… ou Varanda 1). Cada uma ganha o seu QR Code.</span><button class="btn btn-primary" type="button" data-msfirst>Criar mesas 1 a 10</button></div>';
    const PG = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
    $('#ms-closed').innerHTML = closed.map((b) => `<div class="rx-row"><div class="rx-main"><b>Mesa ${esc(b.dining_tables ? b.dining_tables.label : '')} · ${brl(b.total)}</b><small class="adm-muted">${hm(b.closed_at)} · ${PG[b.payment] || ''}${Number(b.service) > 0 ? ` · serviço ${brl(b.service)}` : ''}${b.closed_by ? ` · ${esc(b.closed_by)}` : ''}</small></div></div>`).join('') || '<p class="adm-empty">Nenhuma conta fechada hoje.</p>';
  }
  $('#ms-grid').addEventListener('click', async (e) => {
    if (e.target.closest('[data-msfirst]')) {
      const rows = Array.from({ length: 10 }, (_, i) => ({ restaurant_id: R.id, label: String(i + 1), position: i + 1 }));
      const { error } = await sb.from('dining_tables').insert(rows); if (error) return toast('Não foi possível criar as mesas.');
      toast('10 mesas criadas! Imprima os QR Codes.'); return loadMesas();
    }
    const card = e.target.closest('[data-ms]'); if (!card) return; const t = TABLES.find((x) => x.id === +card.dataset.ms);
    if (e.target.closest('[data-msbill]')) return billDialog(t);
    if (e.target.closest('[data-msqr]')) return printQrs([t]);
    if (e.target.closest('[data-msedit]')) return tableDialog(t);
  });
  $('#ms-add').addEventListener('click', () => tableDialog(null));
  $('#ms-print').addEventListener('click', () => { const ts = TABLES.filter((t) => t.active); if (!ts.length) return toast('Crie as mesas primeiro.'); printQrs(ts); });
  function tableDialog(t) {
    dialog({
      title: t ? `Mesa ${t.label}` : 'Nova mesa',
      body: field('Nome ou número da mesa', `<input name="label" maxlength="30" required value="${esc(t ? t.label : String(TABLES.length + 1))}" placeholder="Ex.: 5 ou Varanda 2">`)
        + (t ? `<label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> <span>Mesa ativa (aceita pedidos pelo QR Code)</span></label>
          <button class="btn btn-ghost" type="button" data-newqr>Gerar QR Code novo (o antigo para de funcionar)</button>` : ''),
      ok: t ? 'Salvar' : 'Criar mesa', danger: t ? 'Excluir mesa' : null,
      onDanger: async () => { if (billOf(t)) return 'Feche a conta desta mesa antes de excluir.'; if (!confirm(`Excluir a mesa ${t.label}?`)) return 'Cancelado.'; const { error } = await sb.from('dining_tables').delete().eq('id', t.id); if (error) return 'Esta mesa já tem pedidos no histórico. Desative em vez de excluir.'; await loadMesas(); return null; },
      onSubmit: async (f) => {
        const label = f.label.value.trim(); if (!label) return 'Dê um nome à mesa.';
        const row = t ? { label, active: f.active.checked } : { label, restaurant_id: R.id, position: TABLES.length + 1 };
        const { error } = t ? await sb.from('dining_tables').update(row).eq('id', t.id) : await sb.from('dining_tables').insert(row);
        if (error) return /duplicate|unique/i.test(error.message) ? 'Já existe uma mesa com esse nome.' : 'Não foi possível salvar a mesa.';
        await loadMesas(); toast(t ? 'Mesa atualizada.' : `Mesa ${label} criada.`); return null;
      },
    });
    const nq = $('#rx-body [data-newqr]');
    if (nq) nq.onclick = async () => { if (!confirm('Gerar um QR Code novo? O impresso atual deixa de funcionar.')) return; const tok = crypto.randomUUID(); const { error } = await sb.from('dining_tables').update({ token: tok }).eq('id', t.id); if (error) return toast('Não foi possível gerar.'); toast('QR Code novo gerado. Imprima de novo.'); rxd.close(); loadMesas(); };
  }
  function printQrs(ts) {
    const w = window.open('', '_blank'); if (!w) return toast('Permita pop-ups para imprimir.');
    const cards = ts.map((t) => { const c = window.BoraQR.canvas(tableUrl(t), 520, { color: '#1A1112', level: 'M' }); return `<div class="c"><b>${esc(R.name)}</b><img src="${c.toDataURL('image/png')}" alt=""><h2>Mesa ${esc(t.label)}</h2><p>Aponte a câmera do celular<br>e faça seu pedido</p></div>`; }).join('');
    w.document.write(`<html><head><title>QR Codes das mesas — ${esc(R.name)}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.c{border:2px dashed #ccc;border-radius:16px;padding:16px;text-align:center;break-inside:avoid}.c img{width:100%;max-width:260px}.c h2{margin:6px 0;font-size:28px}.c p{margin:0;color:#555}.c b{font-size:16px}@media print{.no{display:none}}</style></head><body><p class="no">Imprima, recorte e deixe em cada mesa.</p><div class="g">${cards}</div><script>setTimeout(()=>print(),300)<\/script></body></html>`);
    w.document.close();
  }
  function billDialog(t) {
    const b = billOf(t); if (!b) return toast('Esta mesa não tem conta aberta.');
    const ST2 = { novo: 'Na cozinha', preparo: 'Em preparo', pronto: 'Pronto p/ servir', entregue: 'Servido' };
    dialog({
      title: `Conta da mesa ${t.label}`, sub: `Aberta às ${hm(b.opened_at)}`,
      body: `<div class="bill">${b.orders.map((o) => `<div class="bill-ord"><div class="bill-h"><b>#${o.number}${o.waiter ? ` · ${esc(o.waiter)}` : ''}</b><span class="ord-st ${o.status}">${ST2[o.status] || o.status}</span></div>
          ${(o.items || []).map((i) => `<div class="bill-l"><span>${i.qty}× ${esc(i.name)}${(i.opts || []).length ? `<small>${i.opts.map(esc).join(' · ')}</small>` : ''}</span><span>${brl(i.price * i.qty)}</span></div>`).join('')}</div>`).join('')}
          <div class="bill-l bill-sub"><span>Consumo</span><span>${brl(b.total)}</span></div>
          <label class="check"><input type="checkbox" name="svc" checked> <span>Taxa de serviço de 10% (${brl(b.total * 0.1)})</span></label>
          <div class="bill-l bill-tot"><span>Total</span><span id="bill-tot">${brl(b.total * 1.1)}</span></div></div>`
        + field('Forma de pagamento', `<select name="pay"><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option></select>`)
        + '<button class="btn btn-ghost" type="button" data-billprint>Imprimir conta</button>',
      ok: 'Fechar conta',
      onSubmit: async (f) => {
        if (!confirm(`Fechar a conta da mesa ${t.label}?`)) return 'Cancelado.';
        const { error } = await sb.rpc('owner_close_bill', { p_bill: b.id, p_payment: f.pay.value, p_service_pct: f.svc.checked ? 10 : 0 });
        if (error) return errMsg(error, 'Não foi possível fechar a conta.');
        toast(`Conta da mesa ${t.label} fechada.`); await loadMesas(); if (typeof loadOrders === 'function') loadOrders(); return null;
      },
    });
    const svc = $('#rx-body [name=svc]'); svc.addEventListener('change', () => { $('#bill-tot').textContent = brl(b.total * (svc.checked ? 1.1 : 1)); });
    $('#rx-body [data-billprint]').onclick = () => {
      const s = svc.checked ? b.total * 0.1 : 0; const w = window.open('', '_blank', 'width=380,height=600'); if (!w) return;
      const lines = b.orders.flatMap((o) => o.items || []).map((i) => `<tr><td>${i.qty}x ${esc(i.name)}</td><td style="text-align:right">${brl(i.price * i.qty)}</td></tr>`).join('');
      w.document.write(`<html><head><title>Conta mesa ${esc(t.label)}</title><style>body{font:14px monospace;padding:12px;width:300px}hr{border:0;border-top:1px dashed #000}</style></head><body><b>${esc(R.name)}</b><br>Mesa ${esc(t.label)} · ${new Date().toLocaleString('pt-BR')}<hr><table style="width:100%">${lines}</table><hr>Consumo: ${brl(b.total)}<br>${s ? `Serviço (10%): ${brl(s)}<br>` : ''}<b>TOTAL: ${brl(b.total + s)}</b><hr>Obrigado e volte sempre!<script>print()<\/script></body></html>`);
      w.document.close();
    };
  }
  function renderWaiters() {
    $('#wt-list').innerHTML = WAITERS.map((w) => `<div class="rx-row" data-wt="${w.id}"><div class="rx-main"><b>${esc(w.name)}</b><small class="adm-muted">Entra com PIN</small></div><span class="mp-state ${w.active ? 'on' : ''}">${w.active ? 'Ativo' : 'Inativo'}</span><div class="rx-acts"><button class="btn btn-outline" type="button" data-wtedit>Editar</button></div></div>`).join('')
      || '<p class="adm-empty">Cadastre os garçons com um PIN de 4 a 6 números.</p>';
  }
  function waiterDialog(w) {
    dialog({
      title: w ? `Garçom ${w.name}` : 'Novo garçom', sub: 'O PIN é a senha que o garçom usa no app.',
      body: field('Nome', `<input name="name" maxlength="40" required value="${esc(w ? w.name : '')}" placeholder="Ex.: João">`)
        + field(w ? 'Novo PIN (opcional)' : 'PIN', `<input name="pin" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="${w ? 'Deixe em branco para manter' : '4 a 6 números'}">`)
        + (w ? `<label class="check"><input type="checkbox" name="active" ${w.active ? 'checked' : ''}> <span>Pode entrar no app</span></label>` : ''),
      ok: w ? 'Salvar' : 'Cadastrar garçom',
      onSubmit: async (f) => {
        const name = f.name.value.trim(), pin = f.pin.value.trim();
        if (!name) return 'Informe o nome.'; if (!w && !/^\d{4,6}$/.test(pin)) return 'O PIN precisa ter de 4 a 6 números.'; if (w && pin && !/^\d{4,6}$/.test(pin)) return 'O PIN precisa ter de 4 a 6 números.';
        if (pin && WAITERS.length > 1 && /^(\d)\1+$/.test(pin)) return 'Use um PIN menos óbvio (não repita o mesmo número).';
        const { error } = await sb.rpc('waiter_save', { p_rid: R.id, p_id: w ? w.id : null, p_name: name, p_pin: pin || null, p_active: w ? f.active.checked : true });
        if (error) return errMsg(error, 'Não foi possível salvar.');
        await loadMesas(); toast(w ? 'Garçom atualizado.' : `${name} cadastrado. Passe o link do app e o PIN para ele.`); return null;
      },
    });
  }
  $('#wt-add').addEventListener('click', () => waiterDialog(null));
  $('#wt-list').addEventListener('click', (e) => { const r = e.target.closest('[data-wt]'); if (r && e.target.closest('[data-wtedit]')) waiterDialog(WAITERS.find((x) => x.id === +r.dataset.wt)); });
  $('#gc-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#gc-link').textContent); toast('Link do app do garçom copiado!'); } catch (_) { toast('Selecione e copie o link.'); } });
  const refreshMesas = debounce(() => { if (has('mesas')) loadMesas(); }, 600);

  /* ============================================================
     ESTOQUE + FICHA TÉCNICA
     ============================================================ */
  let STOCK = [];
  const UN = { un: 'unidade', g: 'g', kg: 'kg', ml: 'ml', l: 'litro', pct: 'pacote', fatia: 'fatia' };
  async function loadStock() {
    const [s, m] = await Promise.all([
      sb.from('stock_items').select('*').eq('restaurant_id', R.id).order('name'),
      sb.from('stock_moves').select('*, stock_items(name, unit)').eq('restaurant_id', R.id).order('created_at', { ascending: false }).limit(30),
    ]);
    STOCK = s.data || []; renderStock(); renderMoves(m.data || []);
  }
  const low = (i) => Number(i.min_qty) > 0 && Number(i.qty) <= Number(i.min_qty);
  function renderStock() {
    const q = ($('#st-q').value || '').trim().toLowerCase();
    const lows = STOCK.filter(low).length;
    $('#sk-n').textContent = STOCK.length; $('#sk-low').textContent = lows;
    $('#sk-val').textContent = brl(STOCK.reduce((s, i) => s + Math.max(0, Number(i.qty)) * Number(i.cost), 0));
    $('#estoque-count').hidden = !lows; $('#estoque-count').textContent = lows;
    const list = STOCK.filter((i) => !q || i.name.toLowerCase().includes(q));
    $('#st-rows').innerHTML = list.map((i) => `<tr data-st="${i.id}" class="${low(i) ? 'low' : ''}">
      <td><b>${esc(i.name)}</b>${low(i) ? '<small class="st-low">Abaixo do mínimo</small>' : ''}</td>
      <td><b>${qtyFmt(i.qty)}</b> <small>${UN[i.unit] || i.unit}</small></td>
      <td>${Number(i.min_qty) ? `${qtyFmt(i.min_qty)} ${UN[i.unit] || i.unit}` : '—'}</td>
      <td>${Number(i.cost) ? `${brl(i.cost)} / ${UN[i.unit] || i.unit}` : '—'}</td>
      <td class="st-acts"><button class="btn btn-primary row-btn" type="button" data-stin>Entrada</button><button class="btn btn-outline row-btn" type="button" data-stadj>Ajustar</button><button class="btn btn-ghost row-btn" type="button" data-stedit>Editar</button></td></tr>`).join('');
    $('#st-empty').hidden = list.length > 0;
  }
  function renderMoves(ms) {
    const RS = { pedido: 'Pedido', entrada: 'Entrada', ajuste: 'Ajuste', perda: 'Perda', estorno: 'Estorno' };
    $('#st-moves').innerHTML = ms.map((m) => `<tr><td><small>${dm(m.created_at)}</small></td><td>${esc(m.stock_items ? m.stock_items.name : '')}</td><td class="${Number(m.delta) < 0 ? 'neg' : 'pos'}">${Number(m.delta) > 0 ? '+' : ''}${qtyFmt(m.delta)} ${m.stock_items ? UN[m.stock_items.unit] || '' : ''}</td><td>${RS[m.reason] || m.reason}${m.note ? ` <small class="adm-muted">${esc(m.note)}</small>` : ''}</td></tr>`).join('');
    $('#st-moves-empty').hidden = ms.length > 0;
  }
  $('#st-q').addEventListener('input', renderStock);
  const unitSel = (v) => `<select name="unit">${Object.entries(UN).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  function stockDialog(i) {
    dialog({
      title: i ? i.name : 'Novo insumo', sub: 'Ex.: pão de hambúrguer (unidade), queijo (g), refrigerante lata (unidade).',
      body: field('Nome', `<input name="name" maxlength="60" required value="${esc(i ? i.name : '')}" placeholder="Ex.: Pão de hambúrguer">`)
        + `<div class="row2">${field('Unidade', unitSel(i ? i.unit : 'un'))}${i ? '' : field('Quantidade em estoque', '<input name="qty" inputmode="decimal" placeholder="0">')}</div>`
        + `<div class="row2">${field('Estoque mínimo', `<input name="min_qty" inputmode="decimal" value="${i && Number(i.min_qty) ? qtyFmt(i.min_qty) : ''}" placeholder="Avisa quando chegar nisso">`)}${field('Custo por unidade (R$)', `<input name="cost" inputmode="decimal" value="${i && Number(i.cost) ? String(Number(i.cost)).replace('.', ',') : ''}" placeholder="Ex.: 0,80">`, 'Usado para calcular o custo dos produtos')}</div>`,
      ok: i ? 'Salvar' : 'Cadastrar insumo', danger: i ? 'Excluir' : null,
      onDanger: async () => { if (!confirm(`Excluir ${i.name}? Ele sai também das fichas técnicas.`)) return 'Cancelado.'; const { error } = await sb.from('stock_items').delete().eq('id', i.id); if (error) return 'Não foi possível excluir.'; await loadStock(); return null; },
      onSubmit: async (f) => {
        const name = f.name.value.trim(); if (!name) return 'Informe o nome do insumo.';
        const row = { name, unit: f.unit.value, min_qty: num(f.min_qty.value), cost: num4(f.cost.value) };
        const { error } = i ? await sb.from('stock_items').update({ ...row, updated_at: new Date().toISOString() }).eq('id', i.id)
          : await sb.from('stock_items').insert({ ...row, qty: num(f.qty.value), restaurant_id: R.id });
        if (error) return 'Não foi possível salvar o insumo.';
        await loadStock(); toast(i ? 'Insumo atualizado.' : `${name} cadastrado.`); return null;
      },
    });
  }
  const num4 = (s) => { let t = String(s || '').trim().replace(/[^0-9.,]/g, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const v = parseFloat(t); return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0; };
  const numQ = (s) => { let t = String(s || '').trim().replace(/[^0-9.,-]/g, ''); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const v = parseFloat(t); return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN; };
  function moveDialog(i, kind) {
    const u = UN[i.unit] || i.unit;
    dialog({
      title: kind === 'in' ? `Entrada de ${i.name}` : `Ajustar ${i.name}`, sub: `Hoje no sistema: ${qtyFmt(i.qty)} ${u}`,
      body: kind === 'in'
        ? field(`Quantidade que chegou (${u})`, '<input name="q" inputmode="decimal" required placeholder="Ex.: 50">') + field(`Custo por ${u} desta compra (opcional)`, `<input name="cost" inputmode="decimal" placeholder="${Number(i.cost) ? String(Number(i.cost)).replace('.', ',') : 'Ex.: 0,80'}">`) + field('Observação', '<input name="note" maxlength="120" placeholder="Ex.: Atacadão, nota 123">')
        : `<div class="mode-cards two"><label><input type="radio" name="kind" value="contagem" checked><b>Contei o estoque</b><small>Informe quanto tem de verdade</small></label><label><input type="radio" name="kind" value="perda"><b>Perda / quebra</b><small>Venceu, estragou ou caiu</small></label></div>`
          + field(`Quantidade (${u})`, '<input name="q" inputmode="decimal" required>') + field('Observação', '<input name="note" maxlength="120">'),
      ok: kind === 'in' ? 'Lançar entrada' : 'Salvar ajuste',
      onSubmit: async (f) => {
        const q = numQ(f.q.value); if (!Number.isFinite(q) || q < 0) return 'Informe uma quantidade válida.';
        let delta, reason, cost = null;
        if (kind === 'in') { if (!(q > 0)) return 'Informe a quantidade que chegou.'; delta = q; reason = 'entrada'; cost = f.cost.value.trim() ? num4(f.cost.value) : null; }
        else if (f.kind.value === 'perda') { if (!(q > 0)) return 'Informe quanto foi perdido.'; delta = -q; reason = 'perda'; }
        else { delta = Math.round((q - Number(i.qty)) * 1000) / 1000; reason = 'ajuste'; if (!delta) return 'A quantidade já é essa.'; }
        const { error } = await sb.rpc('stock_adjust', { p_item: i.id, p_delta: delta, p_reason: reason, p_note: f.note.value.trim() || null, p_cost: cost });
        if (error) return errMsg(error, 'Não foi possível lançar.');
        await loadStock(); toast('Estoque atualizado.'); return null;
      },
    });
  }
  $('#st-add').addEventListener('click', () => stockDialog(null));
  $('#st-rows').addEventListener('click', (e) => {
    const r = e.target.closest('[data-st]'); if (!r) return; const i = STOCK.find((x) => x.id === +r.dataset.st);
    if (e.target.closest('[data-stin]')) moveDialog(i, 'in'); else if (e.target.closest('[data-stadj]')) moveDialog(i, 'adj'); else if (e.target.closest('[data-stedit]')) stockDialog(i);
  });

  // ficha técnica dentro da tela do produto
  let RECIPE = [], recipeOn = false;
  async function recipeOpen(p) {
    recipeOn = !!(started && has('estoque')); $('#recipe-box').hidden = !recipeOn; RECIPE = [];
    if (!recipeOn) return;
    if (!STOCK.length) { const { data } = await sb.from('stock_items').select('*').eq('restaurant_id', R.id).order('name'); STOCK = data || []; }
    if (p) { const { data } = await sb.from('product_recipes').select('*').eq('product_id', p.id); RECIPE = (data || []).map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty) })); }
    renderRecipe();
  }
  function renderRecipe() {
    if (!STOCK.length) { $('#recipe-rows').innerHTML = '<p class="adm-muted">Cadastre os insumos na aba <b>Estoque</b> para montar a ficha técnica.</p>'; $('#recipe-add').hidden = true; return; }
    $('#recipe-add').hidden = false;
    $('#recipe-rows').innerHTML = RECIPE.map((r, i) => { const it = STOCK.find((s) => s.id === r.stock_item_id); return `<div class="opt-item rc-row" data-rc="${i}">
      <select data-rcf="stock_item_id" aria-label="Insumo">${STOCK.map((s) => `<option value="${s.id}" ${s.id === r.stock_item_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <input data-rcf="qty" inputmode="decimal" value="${r.qty ? qtyFmt(r.qty) : ''}" placeholder="Qtd" aria-label="Quantidade"><span class="rc-un">${it ? UN[it.unit] || it.unit : ''}</span>
      <button class="opt-x" type="button" data-rcdel aria-label="Remover">×</button></div>`; }).join('') || '<p class="adm-muted">Nenhum insumo ligado a este produto.</p>';
  }
  $('#recipe-add').addEventListener('click', () => { const used = new Set(RECIPE.map((r) => r.stock_item_id)); const s = STOCK.find((x) => !used.has(x.id)) || STOCK[0]; RECIPE.push({ stock_item_id: s.id, qty: 0 }); renderRecipe(); });
  $('#recipe-rows').addEventListener('input', (e) => { const r = e.target.closest('[data-rc]'); if (!r) return; const x = RECIPE[+r.dataset.rc]; if (e.target.dataset.rcf === 'qty') x.qty = numQ(e.target.value) || 0; });
  $('#recipe-rows').addEventListener('change', (e) => { const r = e.target.closest('[data-rc]'); if (!r || e.target.dataset.rcf !== 'stock_item_id') return; RECIPE[+r.dataset.rc].stock_item_id = +e.target.value; renderRecipe(); });
  $('#recipe-rows').addEventListener('click', (e) => { const d = e.target.closest('[data-rcdel]'); if (!d) return; RECIPE.splice(+d.closest('[data-rc]').dataset.rc, 1); renderRecipe(); });
  async function recipeSave(pid) {
    if (!recipeOn) return;
    const rows = []; const seen = new Set();
    RECIPE.forEach((r) => { if (r.qty > 0 && !seen.has(r.stock_item_id)) { seen.add(r.stock_item_id); rows.push({ product_id: pid, stock_item_id: r.stock_item_id, restaurant_id: R.id, qty: r.qty }); } });
    await sb.from('product_recipes').delete().eq('product_id', pid);
    if (rows.length) { const { error } = await sb.from('product_recipes').insert(rows); if (error) toast('O produto foi salvo, mas a ficha técnica não. Confira os insumos.'); }
  }

  /* ============================================================
     FINANCEIRO
     ============================================================ */
  let period = 'hoje', EXPENSES = [];
  function spMidnight(daysAgo = 0) { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - daysAgo * 86400000)); return new Date(`${p}T00:00:00-03:00`); }
  function range() {
    const to = new Date(Date.now() + 60000);
    if (period === 'hoje') return { from: spMidnight(0), to };
    if (period === 'mes') { const d = spMidnight(0); const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d); return { from: new Date(`${p}-01T00:00:00-03:00`), to }; }
    return { from: spMidnight(+period - 1), to };
  }
  const PAYL = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro', mesa: 'Mesa (conta aberta)' };
  const MODEL = { entrega: 'Entrega', retirada: 'Retirada', mesa: 'Mesa / salão' };
  async function loadFin() {
    const { from, to } = range();
    const [rep, ex] = await Promise.all([
      sb.rpc('finance_report', { p_rid: R.id, p_from: from.toISOString(), p_to: to.toISOString() }),
      sb.from('expenses').select('*').eq('restaurant_id', R.id).gte('spent_on', ymd(from)).order('spent_on', { ascending: false }).order('id', { ascending: false }).limit(100),
    ]);
    if (rep.error) { toast('Não foi possível carregar o financeiro.'); return; }
    renderFin(rep.data || {}, from, to); EXPENSES = ex.data || []; renderExpenses(); loadCash();
  }
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  function renderFin(r, from, to) {
    const fat = Number(r.total || 0) + Number(r.service || 0);
    const profit = fat - Number(r.cmv || 0) - Number(r.expenses || 0);
    $('#fk-total').textContent = brl(fat); $('#fk-orders').textContent = `${r.orders || 0} pedido(s)`;
    $('#fk-ticket').textContent = brl(r.orders ? Number(r.total) / r.orders : 0);
    $('#fk-cmv').textContent = brl(r.cmv); $('#fk-exp').textContent = brl(r.expenses);
    $('#fk-profit').textContent = brl(profit); $('#fk-profit').closest('.adm-kpi').classList.toggle('kpi-bad', profit < 0);
    // barras por dia (ou por hora, no "hoje")
    let bars;
    if (period === 'hoje') { const map = Object.fromEntries((r.by_hour || []).map((x) => [x.h, x.n])); const hs = (r.by_hour || []).map((x) => x.h); const a = Math.min(11, ...hs, 18), b = Math.max(23, ...hs); bars = []; for (let h = a; h <= b; h++) bars.push({ k: `${h}h`, v: map[h] || 0, t: `${map[h] || 0} pedido(s)` }); }
    else { const map = Object.fromEntries((r.by_day || []).map((x) => [x.d, Number(x.v)])); bars = []; for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86400000)) { const k = ymd(d); bars.push({ k: k.slice(8, 10) + '/' + k.slice(5, 7), v: map[k] || 0, t: brl(map[k] || 0) }); } }
    const max = Math.max(1, ...bars.map((x) => x.v));
    $('#fin-days').innerHTML = bars.map((x) => `<div class="fb" title="${x.k}: ${x.t}"><i style="height:${Math.round(x.v / max * 100)}%"></i><small>${x.k}</small></div>`).join('');
    $('#fin-days').classList.toggle('many', bars.length > 16);
    const split = (arr, L) => { const tot = arr.reduce((s, x) => s + Number(x.v), 0) || 1; return arr.map((x) => `<div class="fs"><span>${L[x.k] || x.k} <small class="adm-muted">${x.n} pedido(s)</small></span><b>${brl(x.v)}</b><i style="--w:${Math.round(Number(x.v) / tot * 100)}%"></i></div>`).join('') || '<p class="adm-muted">Sem vendas no período.</p>'; };
    $('#fin-pay').innerHTML = split(r.by_payment || [], PAYL); $('#fin-mode').innerHTML = split(r.by_mode || [], MODEL);
    $('#fin-extra').textContent = [Number(r.fees) ? `Inclui ${brl(r.fees)} de taxa de entrega` : '', Number(r.service) ? `${brl(r.service)} de serviço de mesa` : '', Number(r.discounts) ? `${brl(r.discounts)} dados em descontos` : '', r.canceled ? `${r.canceled} pedido(s) cancelado(s)` : ''].filter(Boolean).join(' · ');
    $('#fin-top').innerHTML = (r.top || []).map((x, i) => `<div class="rx-row"><span class="top-n">${i + 1}</span><div class="rx-main"><b>${esc(x.name)}</b><small class="adm-muted">${qtyFmt(x.qty)} vendido(s)</small></div><b>${brl(x.v)}</b></div>`).join('') || '<p class="adm-empty">Sem vendas no período.</p>';
  }
  $$('[data-fp]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.fp; $$('[data-fp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadFin(); }));
  const CATS_EX = ['Insumos', 'Embalagens', 'Entregador', 'Funcionários', 'Aluguel', 'Energia e água', 'Gás', 'Marketing', 'Taxas e impostos', 'Outros'];
  function renderExpenses() {
    $('#ex-list').innerHTML = EXPENSES.map((x) => `<div class="rx-row" data-ex="${x.id}"><div class="rx-main"><b>${esc(x.description)}</b><small class="adm-muted">${x.spent_on.split('-').reverse().join('/')}${x.category ? ` · ${esc(x.category)}` : ''}</small></div><b>${brl(x.amount)}</b><button class="opt-x" type="button" data-exdel aria-label="Excluir despesa">×</button></div>`).join('') || '<p class="adm-empty">Nenhuma despesa lançada no período.</p>';
  }
  $('#ex-add').addEventListener('click', () => dialog({
    title: 'Lançar despesa', sub: 'Gastos da loja entram no lucro do período.',
    body: field('Descrição', '<input name="description" maxlength="80" required placeholder="Ex.: Compra de carne">')
      + `<div class="row2">${field('Valor (R$)', '<input name="amount" inputmode="decimal" required placeholder="0,00">')}${field('Data', `<input name="spent_on" type="date" value="${ymd(new Date())}">`)}</div>`
      + field('Categoria', `<select name="category">${CATS_EX.map((c) => `<option>${c}</option>`).join('')}</select>`),
    ok: 'Lançar',
    onSubmit: async (f) => {
      const d = f.description.value.trim(), a = num(f.amount.value);
      if (!d) return 'Descreva a despesa.'; if (!(a > 0)) return 'Informe o valor.';
      const { error } = await sb.from('expenses').insert({ restaurant_id: R.id, description: d, amount: a, category: f.category.value, spent_on: f.spent_on.value || ymd(new Date()) });
      if (error) return 'Não foi possível lançar.'; await loadFin(); toast('Despesa lançada.'); return null;
    },
  }));
  $('#ex-list').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-ex]'); if (!r || !e.target.closest('[data-exdel]')) return;
    if (!confirm('Excluir esta despesa?')) return;
    const { error } = await sb.from('expenses').delete().eq('id', +r.dataset.ex); if (error) return toast('Não foi possível excluir.'); loadFin();
  });
  // caixa
  let CASH = null;
  async function loadCash() { const { data, error } = await sb.rpc('cash_status', { p_rid: R.id }); if (!error) { CASH = data; renderCash(); } }
  function renderCash() {
    const o = CASH && CASH.open; const st = $('#cx-state'); st.textContent = o ? 'Aberto' : 'Fechado'; st.classList.toggle('on', !!o);
    const hist = ((CASH && CASH.history) || []).slice(0, 5).map((h) => { const diff = Number(h.counted) - Number(h.expected); return `<div class="rx-row"><div class="rx-main"><b>${dm(h.opened_at)} → ${hm(h.closed_at)}</b><small class="adm-muted">Esperado ${brl(h.expected)} · contado ${brl(h.counted)}</small></div><span class="mp-state ${Math.abs(diff) < 0.01 ? 'on' : 'bad'}">${Math.abs(diff) < 0.01 ? 'Bateu' : (diff > 0 ? 'Sobrou ' : 'Faltou ') + brl(Math.abs(diff))}</span></div>`; }).join('');
    $('#cx-body').innerHTML = o
      ? `<div class="cx-now"><div><small class="adm-muted">Aberto às ${hm(o.opened_at)} com ${brl(o.opening)}</small><b>${brl(o.expected)}</b><small class="adm-muted">esperado na gaveta agora (troco + vendas em dinheiro ${o.moves.length ? '+ movimentos' : ''})</small></div></div>
        ${o.moves.length ? `<div class="rx-list">${o.moves.map((m) => `<div class="rx-row"><div class="rx-main"><b>${m.kind === 'sangria' ? 'Sangria' : 'Suprimento'}</b><small class="adm-muted">${hm(m.created_at)}${m.note ? ` · ${esc(m.note)}` : ''}</small></div><b class="${m.kind === 'sangria' ? 'neg' : 'pos'}">${m.kind === 'sangria' ? '−' : '+'}${brl(m.amount)}</b></div>`).join('')}</div>` : ''}
        <div class="cx-acts"><button class="btn btn-outline" type="button" data-cx="sangria">Sangria</button><button class="btn btn-outline" type="button" data-cx="suprimento">Suprimento</button><button class="btn btn-primary" type="button" data-cx="fechar">Fechar caixa</button></div>`
      : `<p class="adm-muted">Abra o caixa no começo do expediente com o valor do troco. No fim do dia, conte a gaveta e feche: o sistema mostra se bateu.</p>
        <div class="cx-open"><div class="field"><label for="cx-op">Troco inicial (R$)</label><input id="cx-op" inputmode="decimal" placeholder="0,00"></div><button class="btn btn-primary" type="button" data-cx="abrir">Abrir caixa</button></div>`;
    $('#cx-body').insertAdjacentHTML('beforeend', hist ? `<h3 class="rx-sub">Fechamentos anteriores</h3><div class="rx-list">${hist}</div>` : '');
  }
  $('#cx-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cx]'); if (!b) return; const k = b.dataset.cx;
    if (k === 'abrir') { b.disabled = true; const { data, error } = await sb.rpc('cash_open', { p_rid: R.id, p_opening: num($('#cx-op').value) }); b.disabled = false; if (error) return toast(errMsg(error, 'Não foi possível abrir o caixa.')); CASH = data; renderCash(); toast('Caixa aberto. Bom trabalho!'); return; }
    if (k === 'fechar') {
      const o = CASH.open;
      return dialog({ title: 'Fechar caixa', sub: `Esperado na gaveta: ${brl(o.expected)}`, body: field('Quanto tem na gaveta? (R$)', '<input name="counted" inputmode="decimal" required placeholder="0,00">', 'Conte as notas e moedas.') + field('Observação', '<input name="note" maxlength="200">'), ok: 'Fechar caixa',
        onSubmit: async (f) => { if (!f.counted.value.trim()) return 'Informe o valor contado.'; const { data, error } = await sb.rpc('cash_close', { p_rid: R.id, p_counted: num(f.counted.value), p_note: f.note.value.trim() || null }); if (error) return errMsg(error, 'Não foi possível fechar.'); CASH = data; renderCash(); const h = data.history[0]; const diff = Number(h.counted) - Number(h.expected); toast(Math.abs(diff) < 0.01 ? 'Caixa fechado. Bateu certinho!' : `Caixa fechado. ${diff > 0 ? 'Sobrou' : 'Faltou'} ${brl(Math.abs(diff))}.`); return null; } });
    }
    dialog({ title: k === 'sangria' ? 'Sangria (retirada da gaveta)' : 'Suprimento (colocar dinheiro na gaveta)', body: field('Valor (R$)', '<input name="amount" inputmode="decimal" required placeholder="0,00">') + field('Motivo', `<input name="note" maxlength="120" placeholder="${k === 'sangria' ? 'Ex.: pagamento do entregador' : 'Ex.: mais troco'}">`), ok: 'Lançar',
      onSubmit: async (f) => { const a = num(f.amount.value); if (!(a > 0)) return 'Informe o valor.'; const { data, error } = await sb.rpc('cash_move', { p_rid: R.id, p_kind: k, p_amount: a, p_note: f.note.value.trim() || null }); if (error) return errMsg(error, 'Não foi possível lançar.'); CASH = data; renderCash(); return null; } });
  });

  /* ---------- ciclo de vida ---------- */
  const loaded = {};
  function onTab(t) {
    if (!started) return;
    const map = { cupons: ['cupons', loadCupons], mensagens: ['inbox', loadInbox], mesas: ['mesas', loadMesas], estoque: ['estoque', loadStock], financeiro: ['estoque', loadFin] };
    const m = map[t]; if (!m || !has(m[0])) return;
    m[1](); loaded[t] = true;
  }
  const refreshStock = debounce(() => loadStock(), 800);
  function onOrder(o) { if (!started || !o) return; if (o.mode === 'mesa') refreshMesas(); if (loaded.estoque && o.status !== 'pagamento') refreshStock(); }
  function start() {
    if (started || typeof R === 'undefined' || !R) return;
    started = true;
    applyLocks();
    if (has('inbox')) { loadInbox(); listenInbox(); }
    if (has('mesas')) loadMesas();
    if (has('estoque')) sb.from('stock_items').select('*').eq('restaurant_id', R.id).order('name').then(({ data }) => { STOCK = data || []; renderStock(); });
    const cur = $('.p-tabs [aria-selected="true"]'); if (cur) onTab(cur.dataset.tab);
  }
  return { start, onTab, onOrder, recipeOpen, recipeSave };
})();
// o painel pode ter aberto antes deste arquivo carregar
try { if (typeof R !== 'undefined' && R) window.BoraRecursos.start(); } catch (_) {}
