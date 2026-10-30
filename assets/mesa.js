/* ============================================================
   BoraLanchar! — tela da mesa (QR Code ou placa NFC)
   "Como podemos ajudar?": Chamar garçom, Ver cardápio, Pedir a conta,
   Instagram e Avaliar no Google. Usa as variáveis do loja.js (sb, slug, R, MESA, go).
   Banco: supabase/chamar-garcom.sql
   ============================================================ */
window.BoraMesa = (() => {
  const api = { on: false, start };
  const PAY = { pix: 'Pix', cartao: 'cartão', dinheiro: 'dinheiro' };
  let HUB = null, CALLS = [], poll = null, tickT = null;

  const ago = (t) => { const m = Math.max(0, Math.floor((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'agora há pouco' : m === 1 ? 'há 1 minuto' : `há ${m} minutos`; };

  let started = false;
  async function start() {
    if (started || typeof MESA === 'undefined' || !MESA || !sb) return;
    started = true;
    let data = null;
    try { ({ data } = await sb.rpc('table_hub', { p_slug: slug, p_token: MESA.token })); } catch (_) {}
    if (!data || !data.calls) return; // loja sem o recurso: segue direto no cardápio
    HUB = data; api.on = true;
    renderTop(); renderLinks();
    if (typeof renderHeader === 'function') renderHeader();
    if (location.hash !== '#cardapio') go('mesa');
    await refresh();
    clearInterval(poll); poll = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
    clearInterval(tickT); tickT = setInterval(renderStatus, 30000);
  }

  function renderTop() {
    $('#mh-name').textContent = R.name;
    const logo = $('#mh-logo'); logo.hidden = !R.logo_url; if (R.logo_url) { logo.src = R.logo_url; logo.alt = `Logo ${R.name}`; }
    $('#mh-ini').hidden = !!R.logo_url; $('#mh-ini').textContent = R.name.trim().charAt(0).toUpperCase();
    $('#mh-mesa').textContent = mesaTxt();
  }
  function renderLinks() {
    const l = [];
    const ig = String(HUB.instagram || '').replace(/^@/, '').trim();
    if (ig) l.push(`<a class="mh-link" href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></g></svg>
      <span><b>Instagram</b><small>@${esc(ig)}</small></span><i aria-hidden="true">›</i></a>`);
    if (HUB.google_review_url) l.push(`<a class="mh-link" href="${esc(HUB.google_review_url)}" target="_blank" rel="noopener">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span><b>Avaliar no Google</b><small>Conte como foi a sua experiência</small></span><i aria-hidden="true">›</i></a>`);
    $('#mh-links').innerHTML = l.join(''); $('#mh-links').hidden = !l.length;
  }

  async function refresh() {
    try { const { data } = await sb.rpc('table_call_status', { p_slug: slug, p_token: MESA.token }); CALLS = Array.isArray(data) ? data : []; } catch (_) {}
    renderStatus();
  }
  function renderStatus() {
    const box = $('#mh-status');
    const open = CALLS.filter((c) => !c.done_at);
    const done = CALLS.filter((c) => c.done_at && Date.now() - new Date(c.done_at) < 3 * 60000);
    const lines = [];
    open.forEach((c) => lines.push(`<div class="mh-st wait"><span class="dot" aria-hidden="true"></span><p><b>${c.kind === 'conta' ? `Conta pedida${c.pay ? ` · ${PAY[c.pay]}` : ''}` : 'Garçom chamado'}</b><small>${ago(c.created_at)} · já já alguém vem até a ${esc(mesaTxt().toLowerCase())}</small></p></div>`));
    if (!open.length) done.slice(0, 1).forEach((c) => lines.push(`<div class="mh-st ok"><span class="dot" aria-hidden="true"></span><p><b>${c.kind === 'conta' ? 'Conta a caminho' : 'Garçom a caminho'}</b><small>Seu chamado foi atendido.</small></p></div>`));
    box.innerHTML = lines.join(''); box.hidden = !lines.length;
    const g = open.find((c) => c.kind === 'garcom'), b = open.find((c) => c.kind === 'conta');
    $('#mh-call').classList.toggle('sent', !!g);
    $('#mh-call b').textContent = g ? 'Garçom chamado' : 'Chamar garçom';
    $('#mh-call small').textContent = g ? 'Toque para lembrar a equipe' : 'Toque aqui';
    $('#mh-bill small').textContent = b ? 'Já avisamos o garçom' : 'Avisamos o garçom';
  }

  async function send(kind, pay) {
    const { data, error } = await sb.rpc('table_call', { p_slug: slug, p_token: MESA.token, p_kind: kind, p_pay: pay || null });
    if (error) { toast(String(error.message || 'Não foi possível chamar agora.').replace(/^.*?:\s*/, '')); return false; }
    try { navigator.vibrate && navigator.vibrate(60); } catch (_) {}
    toast(kind === 'conta' ? 'Pronto! O garçom já vai trazer a conta.' : data && data.again ? 'Lembramos a equipe do seu chamado.' : 'Pronto! Já chamamos o garçom.');
    await refresh();
    return true;
  }

  $('#mh-call').addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; await send('garcom'); b.disabled = false; });
  $('#mh-menu').addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search + '#cardapio'); go('menu'); });
  $('#mh-bill').addEventListener('click', () => { $('#dc-err').textContent = ''; $('#d-conta').showModal(); });
  $('#dc-ok').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const pay = ($('#dc-form input[name=pay]:checked') || {}).value;
    const ok = await send('conta', pay); b.disabled = false;
    if (ok) $('#d-conta').close();
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-mesa-hub]')) { history.replaceState(null, '', location.pathname + location.search); go('mesa'); refresh(); } });
  return api;
})();
// se o cardápio já carregou antes deste arquivo, abre a tela da mesa agora
if (typeof MESA !== 'undefined' && MESA && !document.querySelector('#v-menu').hidden && location.hash !== '#pedido') window.BoraMesa.start();
