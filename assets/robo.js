/* ============================================================
   BoraLanchar! — aba "Robô WhatsApp" do painel
   Usa o que o painel.js já carregou: sb, R, SUPPORT, toast, esc, $, $$, selectTab.
   Servidor: supabase/functions/whatsapp · Banco: supabase/whatsapp-robo.sql
   ============================================================ */
window.BoraRobo = (() => {
  let started = false, BOT = null, ACC = null, CONVS = [], OPEN = null, FAQ = [], chan = null;
  const fmtPhone = (d) => { d = String(d || '').replace(/\D/g, ''); if (d.startsWith('55') && d.length >= 12) d = d.slice(2); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 60000); if (m < 1) return 'agora'; if (m < 60) return `${m} min`; const h = Math.round(m / 60); if (h < 24) return `${h} h`; return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
  const human = (c) => c.human_until && new Date(c.human_until) > new Date();
  const waFmt = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/\n/g, '<br>');

  async function call(action, extra = {}) {
    const { data, error } = await sb.functions.invoke('whatsapp', { body: { action, ...extra } });
    if (error) { let msg = 'Não foi possível falar com o servidor.'; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} return { error: msg }; }
    return data || {};
  }

  /* ---------- conexão ---------- */
  const isQr = () => !!(BOT && BOT.provider === 'qr');
  const connected = () => !!(BOT && (isQr() ? BOT.qr_state === 'open' : BOT.phone_number_id));
  function renderConn() {
    const on = connected();
    $('#robo-off').hidden = on; $('#robo-on').hidden = !on;
    const st = $('#robo-state');
    st.textContent = !on ? 'Desconectado' : BOT.enabled ? 'Robô ligado' : 'Robô pausado';
    st.classList.toggle('on', on && BOT.enabled);
    if (on) {
      $('#robo-phone').textContent = BOT.display_phone || 'Número conectado';
      $('#robo-vname').textContent = BOT.verified_name ? `Nome no WhatsApp: ${BOT.verified_name}` : '';
      $('#robo-enabled').checked = !!BOT.enabled;
      $('#robo-enabled-label').textContent = BOT.enabled ? 'Robô ligado' : 'Robô pausado';
      $('#robo-conn-sub').textContent = isQr() ? 'Conectado como aparelho do WhatsApp' : 'API oficial do WhatsApp (Meta)';
      $('#robo-on-hint').textContent = isQr()
        ? 'Para testar, mande um "oi" para este número de outro celular. Se você desconectar este aparelho em "Dispositivos conectados" no celular, o robô para.'
        : 'Para testar, mande um "oi" para este número de outro celular.';
    } else {
      $('#robo-conn-sub').textContent = 'Conecte o número da loja';
      $('#qr-lost').hidden = !(BOT && BOT.qr_instance && BOT.qr_state === 'close' && !POLL);
      const ph = $('#qr-phone'); if (!ph.value && R.whatsapp) ph.value = fmtPhone(R.whatsapp);
    }
    if (ACC) {
      const qrOk = ACC.qr_available !== false;
      $('#qr-start').hidden = !qrOk; $('#qr-phone').closest('.field').hidden = !qrOk; $('#qr-unavail').hidden = qrOk;
      if (!qrOk) $('#robo-meta').open = true;
      $('#robo-hook').hidden = !ACC.webhook_url;
      $('#robo-hook-url').textContent = ACC.webhook_url || '';
      $('#robo-hook-token').textContent = ACC.verify_token || '(ainda não gerado)';
      $('#wa-secret-hint').textContent = ACC.app_secret_ok ? 'Opcional: só se você criou um app próprio na Meta.' : 'Usada para conferir que as mensagens vieram mesmo da Meta.';
    }
    if (SUPPORT) {
      $('#wa-connect').disabled = true; $('#wa-disconnect').hidden = true; $('#qr-start').disabled = true;
      $('#robo-conn-sub').textContent = 'No modo suporte, só o dono conecta ou desconecta o número.';
    }
    $('#robo-count').hidden = true;
  }

  $('#wa-connect').addEventListener('click', async () => {
    const b = $('#wa-connect');
    const body = { phone_number_id: $('#wa-pnid').value.trim(), waba_id: $('#wa-waba').value.trim(), token: $('#wa-token').value.trim(), app_secret: $('#wa-secret').value.trim() };
    if (!body.phone_number_id || !body.waba_id || !body.token) return toast('Preencha o ID do número, o ID da conta e o token.');
    if (!body.app_secret && !(ACC && ACC.app_secret_ok)) return toast('Cole também a Chave secreta do aplicativo.');
    b.disabled = true; b.textContent = 'Conectando…';
    const r = await call('connect', body);
    b.disabled = false; b.textContent = 'Conectar número';
    if (r.error) return toast(r.error);
    $('#wa-token').value = ''; $('#wa-secret').value = '';
    BOT = r.bot; renderConn(); renderPreview();
    toast('WhatsApp conectado! Mande um "oi" de outro celular para testar.');
  });
  /* ---------- conexão por código (aparelho conectado) ---------- */
  let POLL = null, TICK = null, LEFT = 0;
  const qstep = (n) => { $('#qr-step1').hidden = n !== 1; $('#qr-step2').hidden = n !== 2; };
  function stopPoll() { clearInterval(POLL); clearInterval(TICK); POLL = null; TICK = null; }
  function showCode(r) {
    if (r.code) $('#qr-code').textContent = r.code;
    if (r.qr) { $('#qr-img').src = r.qr; $('#qr-qrbox').hidden = false; }
  }
  function timer() {
    LEFT = 300;
    const draw = () => { const m = Math.floor(LEFT / 60), s = String(LEFT % 60).padStart(2, '0'); $('#qr-timer').textContent = LEFT > 0 ? `O código vale por ${m}:${s}` : 'O código expirou.'; };
    draw(); clearInterval(TICK);
    TICK = setInterval(() => {
      LEFT--; draw();
      if (LEFT <= 0) { stopPoll(); $('#qr-wait').hidden = true; $('#qr-again').hidden = false; $('#qr-code').classList.add('old'); }
    }, 1000);
  }
  function poll() {
    clearInterval(POLL);
    POLL = setInterval(async () => {
      if (document.hidden) return;
      const r = await call('qr_check');
      if (r.state === 'open') {
        stopPoll(); BOT = r.bot || { ...BOT, provider: 'qr', qr_state: 'open', enabled: true };
        qstep(1); renderConn(); renderPreview();
        toast('Robô ativado! 🎉 Mande um "oi" de outro celular para testar.');
      } else if (r.code && r.code !== $('#qr-code').textContent) showCode(r);
    }, 3000);
  }
  async function qrStart() {
    const d = $('#qr-phone').value.replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) { toast('Digite o número do WhatsApp da loja com DDD.'); $('#qr-phone').focus(); return; }
    const b = $('#qr-start'), again = $('#qr-again');
    b.disabled = true; again.disabled = true; b.textContent = 'Gerando código…';
    const r = await call('qr_start', { phone: d });
    b.disabled = false; again.disabled = false; b.textContent = 'Gerar código';
    if (r.error) return toast(r.error);
    if (!r.code && !r.qr) return toast('O WhatsApp não devolveu o código. Tente de novo em instantes.');
    $('#qr-code').classList.remove('old'); $('#qr-code').textContent = r.code || '—';
    $('#qr-qrbox').hidden = true; showCode(r);
    $('#qr-num').textContent = r.phone || fmtPhone(d);
    $('#qr-wait').hidden = false; again.hidden = true; $('#qr-lost').hidden = true;
    qstep(2); timer(); poll();
  }
  $('#qr-start').addEventListener('click', qrStart);
  $('#qr-again').addEventListener('click', qrStart);
  $('#qr-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qrStart(); } });
  $('#qr-phone').addEventListener('input', (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 11); e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d; });
  $('#qr-change').addEventListener('click', () => { stopPoll(); qstep(1); $('#qr-phone').focus(); });
  $('#qr-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#qr-code').textContent.replace(/[^A-Z0-9]/gi, '')); toast('Código copiado!'); } catch (_) {} });

  $('#wa-disconnect').addEventListener('click', async () => {
    if (!confirm('Desconectar o número? O robô para de responder e os avisos de pedido param.')) return;
    const r = await call(isQr() ? 'qr_disconnect' : 'disconnect'); if (r.error) return toast(r.error);
    BOT = r.bot; renderConn(); toast('Número desconectado.');
  });
  $('#wa-test').addEventListener('click', async () => {
    const b = $('#wa-test'); b.disabled = true;
    const r = await call('test'); b.disabled = false;
    if (r.error) return toast(r.error);
    const q = { GREEN: 'boa', YELLOW: 'média', RED: 'baixa' }[r.quality] || null;
    toast(`Conexão ok com ${r.display_phone}${q ? ` · qualidade ${q}` : ''}.`);
  });
  $('#robo-enabled').addEventListener('change', async (e) => {
    const v = e.target.checked;
    const { data, error } = await sb.from('whatsapp_bots').update({ enabled: v }).eq('restaurant_id', R.id).select().single();
    if (error) { e.target.checked = !v; return toast('Não foi possível mudar agora.'); }
    BOT = data; renderConn(); toast(v ? 'Robô ligado: ele responde os clientes sozinho.' : 'Robô pausado: as mensagens chegam aqui, mas ele não responde.');
  });
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#' + b.dataset.copy).textContent); toast('Copiado!'); } catch (_) {} }));

  /* ---------- mensagens e perguntas frequentes ---------- */
  const rf = () => $('#robo-form');
  const MSGS = [
    ['novo', 'Pedido recebido', 'Oi, {nome}! 🧾 Recebemos seu pedido #{numero} na {loja} ({total}). Já já a loja confirma!'],
    ['preparo', 'Pedido aceito / em preparo', '👨‍🍳 Seu pedido #{numero} foi aceito e já está em preparo na {loja}.'],
    ['pronto', 'Pedido pronto', '✅ Seu pedido #{numero} está pronto!'],
    ['saiu', 'Saiu para entrega', '🛵 Seu pedido #{numero} saiu para entrega. Já já chega aí!'],
    ['entregue', 'Pedido entregue', '😋 Pedido #{numero} entregue. Obrigado por pedir na {loja}!'],
    ['cancelado', 'Pedido cancelado', 'Seu pedido #{numero} na {loja} foi cancelado.'],
    ['humano', 'Cliente pediu atendente (loja aberta)', 'Certo! 🙋 Já chamei alguém da loja para falar com você.'],
    ['humano_fechado', 'Cliente pediu atendente (loja fechada)', 'Certo! 🙋 Deixei seu recado para a equipe.'],
    ['nao_entendi', 'Quando o robô não entende', 'Desculpe, não entendi bem 🤔'],
  ];
  function fillForm() {
    const f = rf();
    f.greeting.value = BOT.greeting || ''; f.away_text.value = BOT.away_text || '';
    f.greeting.placeholder = `Olá, {nome}! 👋 Bem-vindo(a) à *${R.name}*. Eu sou o atendente automático e te ajudo por aqui.`;
    f.away_text.placeholder = 'Ex.: Estamos fechados agora, abrimos às 18h. Você já pode ver o cardápio!';
    f.notify_status.checked = BOT.notify_status !== false; f.template_name.value = BOT.template_name || '';
    f.human_minutes.value = String(BOT.human_minutes || 120);
    if (!f.human_minutes.value) f.human_minutes.value = '120';
    FAQ = JSON.parse(JSON.stringify(BOT.faq || []));
    const M = BOT.messages || {};
    $('#rb-msgs').innerHTML = MSGS.map(([k, l, ph]) => `<div class="field"><label for="rbm-${k}">${l}</label><textarea id="rbm-${k}" data-msg="${k}" rows="2" maxlength="600" placeholder="${esc(ph)}">${esc(M[k] || '')}</textarea></div>`).join('');
    renderFaq(); renderPreview();
  }
  function renderFaq() {
    $('#rb-faq').innerHTML = FAQ.map((q, i) => `<div class="faq-row" data-q="${i}">
      <input data-k="keys" value="${esc(q.keys || '')}" maxlength="150" placeholder="Palavras: estacionamento, vaga" aria-label="Palavras-chave">
      <textarea data-k="answer" rows="2" maxlength="800" placeholder="Resposta do robô" aria-label="Resposta">${esc(q.answer || '')}</textarea>
      <button type="button" class="opt-x" data-delq aria-label="Remover pergunta">×</button></div>`).join('') || '<p class="adm-muted">Nenhuma pergunta ainda. Exemplos: estacionamento, mesa para aniversário, cardápio vegetariano.</p>';
  }
  $('#rb-faq').addEventListener('input', (e) => { const row = e.target.closest('[data-q]'); if (row) FAQ[+row.dataset.q][e.target.dataset.k] = e.target.value; });
  $('#rb-faq').addEventListener('click', (e) => { const b = e.target.closest('[data-delq]'); if (b) { FAQ.splice(+b.closest('[data-q]').dataset.q, 1); renderFaq(); } });
  $('#rb-addfaq').addEventListener('click', () => {
    if (FAQ.length >= 30) return toast('Limite de 30 perguntas.');
    FAQ.push({ keys: '', answer: '' }); renderFaq(); $$('#rb-faq [data-k="keys"]').pop().focus();
  });
  rf().addEventListener('input', (e) => { if (e.target.name === 'greeting' || e.target.name === 'away_text') renderPreview(); });
  rf().addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = rf(); const tpl = f.template_name.value.trim().toLowerCase();
    if (tpl && !/^[a-z0-9_]{1,60}$/.test(tpl)) return toast('O nome do modelo usa só letras minúsculas, números e _ (igual na Meta).');
    const faq = FAQ.map((q) => ({ keys: String(q.keys || '').trim().slice(0, 150), answer: String(q.answer || '').trim().slice(0, 800) })).filter((q) => q.keys && q.answer);
    const patch = { greeting: f.greeting.value.trim() || null, away_text: f.away_text.value.trim() || null, faq, notify_status: f.notify_status.checked, template_name: tpl || null, human_minutes: +f.human_minutes.value || 120 };
    const messages = {}; $$('#rb-msgs [data-msg]').forEach((t) => { const v = t.value.trim().slice(0, 600); if (v) messages[t.dataset.msg] = v; });
    patch.messages = messages;
    const btn = $('#robo-form button[type=submit]'); btn.disabled = true;
    const { data, error } = await sb.from('whatsapp_bots').update(patch).eq('restaurant_id', R.id).select().single();
    btn.disabled = false;
    if (error) return toast('Não foi possível salvar. Confira os textos.');
    BOT = data; fillForm(); toast('Mensagens do robô salvas!');
  });

  function renderPreview() {
    const f = rf(); const st = window.BoraHoras.status(R);
    const g = (f.greeting.value.trim() || f.greeting.placeholder).replace(/\{nome\}/g, 'Ana').replace(/\{loja\}/g, R.name).replace(/\{link\}/g, '');
    const away = !st.open ? `\n\n🔒 ${f.away_text.value.trim() || st.text + '. Você já pode ver o cardápio e pedir quando abrirmos.'}` : '';
    $('#robo-preview').innerHTML = `<div class="wa-bar"><b>${esc(R.name)}</b><small>${BOT && BOT.display_phone ? esc(BOT.display_phone) : 'conta comercial'}</small></div>
      <div class="wa-body">
        <div class="wa-msg in">oi</div>
        <div class="wa-msg out">${waFmt(g + away)}<br><br>Escolha uma opção abaixo 👇 (ou digite o número)<span class="wa-foot">Atendimento automático · BoraLanchar!</span><span class="wa-btn">☰ Ver opções</span></div>
        <div class="wa-msg in">1</div>
        <div class="wa-msg out">📋 <b>Cardápio da ${esc(R.name)}</b><br>É só tocar no link, montar sua sacola e finalizar 😋<br>👉 <u>${esc(`${(CFG.siteUrl || location.origin).replace(/\/$/, '')}/l/${R.slug}`)}</u></div>
      </div>`;
  }

  /* ---------- conversas ---------- */
  async function loadConvs() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await sb.from('wa_conversations').select('*').eq('restaurant_id', R.id).gte('last_msg_at', since).order('last_msg_at', { ascending: false }).limit(60);
    CONVS = data || []; renderConvs();
  }
  function renderConvs() {
    const waiting = CONVS.filter((c) => human(c) && c.unread > 0).length;
    $('#robo-count').hidden = !waiting; $('#robo-count').textContent = waiting;
    $('#robo-list').innerHTML = CONVS.map((c) => `<button type="button" class="robo-conv ${human(c) ? 'is-human' : ''}" data-c="${c.id}">
      <span class="rc-av">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</span>
      <span class="rc-txt"><b>${esc(c.name || fmtPhone(c.wa_id))}</b><small>${human(c) ? '🙋 Pediu atendente' : '🤖 Com o robô'} · ${fmtPhone(c.wa_id)}</small></span>
      <span class="rc-meta"><small>${ago(c.last_msg_at)}</small>${c.unread > 0 ? `<b class="p-count">${c.unread}</b>` : ''}</span></button>`).join('')
      || `<p class="adm-empty">${BOT && BOT.phone_number_id ? 'Nenhuma conversa ainda. Quando um cliente mandar mensagem, ela aparece aqui.' : 'Conecte o número do WhatsApp para ver as conversas aqui.'}</p>`;
  }
  $('#robo-list').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) openConv(+b.dataset.c); });
  async function openConv(id) {
    OPEN = CONVS.find((c) => c.id === id); if (!OPEN) return;
    $('#robo-list').hidden = true; $('#robo-thread').hidden = false;
    $('#rt-name').textContent = OPEN.name || fmtPhone(OPEN.wa_id); $('#rt-phone').textContent = fmtPhone(OPEN.wa_id);
    renderMode(); await loadMsgs();
    if (OPEN.unread > 0) { await sb.from('wa_conversations').update({ unread: 0 }).eq('id', OPEN.id); OPEN.unread = 0; renderConvs(); }
  }
  function renderMode() {
    const h = human(OPEN);
    $('#rt-mode').textContent = h ? 'Devolver para o robô' : 'Assumir atendimento';
    $('#rt-mode').title = h ? 'O robô volta a responder este cliente' : 'O robô fica em silêncio e você responde por aqui';
  }
  async function loadMsgs() {
    if (!OPEN) return;
    const { data } = await sb.from('wa_messages').select('*').eq('conversation_id', OPEN.id).order('created_at', { ascending: false }).limit(80);
    const who = { cliente: '', robo: '🤖 Robô', loja: '🙋 Loja', aviso: '🔔 Aviso de pedido' };
    const box = $('#rt-msgs');
    box.innerHTML = (data || []).reverse().map((m) => `<div class="wa-msg ${m.direction === 'in' ? 'in' : 'out'} ${m.status === 'failed' ? 'failed' : ''}">
      ${m.direction === 'out' ? `<span class="wa-who">${who[m.sender] || ''}</span>` : ''}${waFmt(m.body || '')}
      <span class="wa-foot">${new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${m.direction === 'out' && m.status ? ` · ${{ sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' }[m.status] || m.status}` : ''}</span></div>`).join('') || '<p class="adm-muted">Sem mensagens.</p>';
    box.scrollTop = box.scrollHeight;
  }
  $('#rt-back').addEventListener('click', () => { OPEN = null; $('#robo-thread').hidden = true; $('#robo-list').hidden = false; });
  $('#rt-mode').addEventListener('click', async () => {
    const h = human(OPEN);
    const until = h ? null : new Date(Date.now() + (BOT.human_minutes || 120) * 60000).toISOString();
    const { error } = await sb.from('wa_conversations').update({ human_until: until }).eq('id', OPEN.id);
    if (error) return toast('Não foi possível mudar agora.');
    OPEN.human_until = until; renderMode(); renderConvs();
    toast(h ? 'O robô voltou a atender este cliente.' : 'Você assumiu: o robô fica em silêncio com este cliente.');
  });
  $('#rt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#rt-text').value.trim(); if (!text || !OPEN) return;
    const b = $('#rt-form button'); b.disabled = true;
    const r = await call('send', { conversation_id: OPEN.id, text });
    b.disabled = false;
    if (r.error) return toast(r.error);
    $('#rt-text').value = ''; OPEN.human_until = new Date(Date.now() + (BOT.human_minutes || 120) * 60000).toISOString(); renderMode(); await loadMsgs();
  });
  $('#rt-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#rt-form').requestSubmit(); } });

  function listen() {
    if (chan) sb.removeChannel(chan);
    chan = sb.channel('robo-' + R.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations', filter: `restaurant_id=eq.${R.id}` }, (p) => {
        const c = p.new; const i = CONVS.findIndex((x) => x.id === c.id);
        const wasHuman = i >= 0 && human(CONVS[i]) && CONVS[i].unread;
        if (i >= 0) CONVS.splice(i, 1);
        CONVS.unshift(c); renderConvs();
        if (OPEN && OPEN.id === c.id) { OPEN = c; renderMode(); loadMsgs(); if (c.unread) sb.from('wa_conversations').update({ unread: 0 }).eq('id', c.id).then(() => {}); }
        else if (human(c) && c.unread && !wasHuman && typeof ding === 'function') { ding(); toast(`${c.name || fmtPhone(c.wa_id)} quer falar com um atendente no WhatsApp.`); }
      }).subscribe();
    setInterval(() => { if (!document.hidden) loadConvs(); }, 60000);
  }

  async function start() {
    if (started || typeof R === 'undefined' || !R) return;
    if (window.BoraPlanos && !window.BoraPlanos.has(R.plan, 'robo')) return; // robô só nos planos Profissional e Completo
    started = true;
    let { data } = await sb.from('whatsapp_bots').select('*').eq('restaurant_id', R.id).maybeSingle();
    BOT = data || { restaurant_id: R.id, enabled: false, faq: [], notify_status: true, human_minutes: 120 };
    renderConn(); fillForm(); loadConvs(); listen();
    if (!SUPPORT) call('account').then((r) => { if (!r.error) { ACC = r; renderConn(); } });
  }
  return { start };
})();
try { if (typeof R !== 'undefined' && R) window.BoraRobo.start(); } catch (_) {}
