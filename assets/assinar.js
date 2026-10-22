/* ============================================================
   BoraLanchar! — assinatura dos planos
   assinar.html?plano=essencial|profissional|completo   (volta do Mercado Pago: ?ref=<id>)
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = window.BORA_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const PLANS = {
  Essencial: { price: 39.99, desc: 'Para começar a vender online', feats: ['Cardápio digital e QR Code', 'Pedidos ilimitados', 'Pagamento online'] },
  Profissional: { price: 59.99, desc: 'Atendimento no automático', feats: ['Tudo do Essencial', 'Robô de atendimento no WhatsApp', 'Caixa de entrada única', 'Cupons e fidelidade'] },
  Completo: { price: 79.99, desc: 'Delivery, salão e gestão', feats: ['Tudo do Profissional', 'App do garçom e mesas', 'Estoque e financeiro', 'Suporte prioritário'] },
};
const params = new URLSearchParams(location.search);
const fromParam = (params.get('plano') || '').toLowerCase();
let plan = Object.keys(PLANS).find((p) => p.toLowerCase() === fromParam) || 'Profissional';
let user = null, R = null, SETTINGS = {}, poll = null;

const toastEl = $('.toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3500); }
function step(id) { ['step-conta', 'step-pag', 'step-pix', 'step-check', 'step-ok'].forEach((s) => { $('#' + s).hidden = !id.includes(s); }); $('.as-intro').hidden = !id.includes('step-conta'); }

/* ---------- plano ---------- */
function renderPlan() {
  const p = PLANS[plan];
  $('#plan-name').textContent = plan; $('#plan-desc').textContent = p.desc;
  $('#plan-price').textContent = brl(p.price); $('#plan-total').textContent = brl(p.price);
  $('#plan-feats').innerHTML = p.feats.map((f) => `<li><svg width="18" height="18"><use href="#i-check"/></svg>${esc(f)}</li>`).join('');
  $$('.as-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plan === plan)));
  $('#as-plan').dataset.plan = plan.toLowerCase();
  syncPay();
  history.replaceState(null, '', `${location.pathname}?plano=${plan.toLowerCase()}`);
}
$$('.as-seg button').forEach((b) => b.addEventListener('click', () => { plan = b.dataset.plan; renderPlan(); }));

/* ---------- formas de pagamento ---------- */
const method = () => ($('input[name="metodo"]:checked') || {}).value || 'pix';
function syncPay() {
  const mp = !!SETTINGS.mp_enabled;
  const pixOk = mp || !!SETTINGS.pix_key;
  [['cartao', mp], ['boleto', mp], ['pix', pixOk]].forEach(([k, ok]) => {
    const l = $('#m-' + k); l.classList.toggle('off', !ok); $('input', l).disabled = !ok;
  });
  if (!mp) { $('#m-cartao-txt').textContent = 'Em breve'; $('#m-boleto-txt').textContent = 'Em breve'; }
  if ($('input[name="metodo"]:checked')?.disabled) { const first = $('input[name="metodo"]:not(:disabled)'); if (first) first.checked = true; }
  const m = method();
  $('#pay-txt').textContent = m === 'pix' ? `Pagar ${brl(PLANS[plan].price)} com Pix` : m === 'cartao' ? `Pagar ${brl(PLANS[plan].price)} no cartão` : `Gerar boleto de ${brl(PLANS[plan].price)}`;
  $('#pay-btn').disabled = !$('input[name="metodo"]:not(:disabled)');
}
$$('input[name="metodo"]').forEach((i) => i.addEventListener('change', syncPay));

/* ---------- conta ---------- */
function maskPhone(v) { const d = v.replace(/\D/g, '').slice(0, 11); return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d; }
$('#s-tel').addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
$$('[data-acc]').forEach((b) => b.addEventListener('click', () => { const login = b.dataset.acc === 'login'; $('#acc-signup').hidden = login; $('#acc-login').hidden = !login; }));
$('#acc-switch').addEventListener('click', async () => { await sb.auth.signOut(); user = null; R = null; renderAccount(); });
function renderAccount() {
  const logged = !!(user && R);
  $('#acc-logged').hidden = !logged; $('#acc-signup').hidden = logged; $('#acc-login').hidden = true;
  if (logged) {
    $('#acc-store').textContent = R.name; $('#acc-email').textContent = user.email;
    const until = R.paid_until ? new Date(R.paid_until).toLocaleDateString('pt-BR') : null;
    $('#acc-status').textContent = R.status === 'ativo' ? `Plano ${R.plan} ativo${until ? ' até ' + until : ''}. Pagar agora soma mais 30 dias.` : R.status === 'teste' ? `No teste grátis do plano ${R.plan}.` : 'Loja pausada: pague para voltar a vender.';
  }
  $('#trial-box').hidden = logged && R.status === 'ativo';
}
function fieldErr(input, msg) { const e = input.parentElement.querySelector('.err'); if (e) e.textContent = msg || ''; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
function validateSignup() {
  const f = $('#acc-signup'); let bad = null;
  const rules = { nome: (v) => v.length >= 2, loja: (v) => v.length >= 2, telefone: (v) => v.replace(/\D/g, '').length >= 10, email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), senha: (v) => v.length >= 8 };
  const msgs = { nome: 'Informe seu nome.', loja: 'Informe o nome do estabelecimento.', telefone: 'Informe um WhatsApp com DDD.', email: 'Informe um e-mail válido.', senha: 'Use pelo menos 8 caracteres.' };
  Object.keys(rules).forEach((k) => { const i = f.elements[k]; const ok = rules[k](i.value.trim()); fieldErr(i, ok ? '' : msgs[k]); if (!ok && !bad) bad = i; });
  if (bad) bad.focus();
  return !bad;
}
async function loadMine() {
  const { data } = await sb.from('restaurants').select('*').eq('owner_id', user.id).maybeSingle();
  R = data || null;
}
// garante conta + loja; devolve true quando pronto
async function ensureAccount() {
  if (user && R) return true;
  if (user && !R) {
    const m = user.user_metadata || {};
    const { data, error } = await sb.rpc('create_my_restaurant', { p_name: m.loja || $('#s-loja').value.trim() || 'Minha loja', p_whatsapp: m.telefone || $('#s-tel').value, p_segment: m.segmento || $('#s-seg').value, p_plan: plan });
    if (error) { $('#pay-err').textContent = 'Não foi possível criar sua loja. Fale com a gente no WhatsApp.'; return false; }
    R = data; renderAccount(); return true;
  }
  if (!$('#acc-login').hidden) { $('#pay-err').textContent = 'Entre na sua conta acima para continuar.'; $('#l-email').focus(); return false; }
  if (!validateSignup()) { $('#step-conta').scrollIntoView({ behavior: 'smooth', block: 'start' }); return false; }
  const f = $('#acc-signup');
  const meta = { nome: f.nome.value.trim(), loja: f.loja.value.trim(), telefone: f.telefone.value, segmento: f.segmento.value, plano: plan };
  const { data: auth, error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.senha.value, options: { data: meta, emailRedirectTo: new URL(`assinar.html?plano=${plan.toLowerCase()}`, location.href).href } });
  if (error) {
    $('#pay-err').textContent = /registered|already/i.test(error.message) ? 'Este e-mail já tem conta. Toque em "Entrar" acima.' : 'Não foi possível criar a conta: ' + error.message;
    return false;
  }
  try { await sb.from('leads').insert({ tipo: 'cadastro', nome: meta.nome, loja: meta.loja, telefone: meta.telefone, email: f.email.value.trim(), segmento: meta.segmento, plano: plan }); } catch (_) {}
  if (!auth.session) {
    const email = f.email.value.trim();
    // e-mail que já tem conta: o Supabase não manda nada e não avisa — então tentamos entrar com a senha digitada
    const { data: li, error: le } = await sb.auth.signInWithPassword({ email, password: f.senha.value });
    if (!le && li && li.session) { user = li.user; await loadMine(); renderAccount(); return ensureAccount(); }
    if (auth.user && Array.isArray(auth.user.identities) && auth.user.identities.length === 0) {
      showLogin(email, 'Este e-mail já tem conta no BoraLanchar!. Digite a senha dele para entrar e continuar.');
      return false;
    }
    showConfirm(email); return false;
  }
  user = auth.user;
  const { data, error: e2 } = await sb.rpc('create_my_restaurant', { p_name: meta.loja, p_whatsapp: meta.telefone, p_segment: meta.segmento, p_plan: plan });
  if (e2) { $('#pay-err').textContent = 'Conta criada, mas não deu para montar a loja. Fale com a gente no WhatsApp.'; return false; }
  R = data; renderAccount(); return true;
}
function showLogin(email, msg) {
  $('#acc-signup').hidden = true; $('#acc-login').hidden = false;
  $('#l-email').value = email || ''; $('#l-senha').value = ''; $('#l-senha').focus();
  fieldErr($('#l-senha'), ''); $('#pay-err').textContent = msg || '';
}
function showConfirm(email) {
  const box = $('#pay-err');
  box.innerHTML = `Falta confirmar o e-mail <b>${esc(email)}</b>: abra o link que enviamos (veja também a caixa de spam e promoções). `
    + '<button class="as-link" type="button" id="resend">Reenviar e-mail</button> · '
    + `<a class="as-link" target="_blank" rel="noopener" href="https://wa.me/${esc(CFG.whatsapp || '')}?text=${encodeURIComponent('Olá! Criei minha conta no BoraLanchar! com o e-mail ' + email + ', mas o e-mail de confirmação não chegou.')}">Não chegou? Fale no WhatsApp</a>`;
  $('#resend').onclick = async () => {
    const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: new URL(`assinar.html?plano=${plan.toLowerCase()}`, location.href).href } });
    toast(error ? 'Aguarde alguns minutos para pedir outro e-mail.' : 'E-mail reenviado! Confira também o spam.');
  };
}
$('#acc-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim(), password = $('#l-senha').value;
  if (!email || !password) { fieldErr($('#l-senha'), 'Preencha e-mail e senha.'); return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) { fieldErr($('#l-senha'), ''); showConfirm(email); return; }
    fieldErr($('#l-senha'), 'E-mail ou senha incorretos.');
    $('#pay-err').innerHTML = `Esqueceu a senha? <button class="as-link" type="button" id="forgot">Receber link para criar nova senha</button>`;
    $('#forgot').onclick = async () => { await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('painel.html', location.href).href }); toast('Se o e-mail tiver conta, enviamos o link. Confira também o spam.'); };
    return;
  }
  $('#pay-err').textContent = '';
  user = data.user; await loadMine(); renderAccount();
  if (!R) toast('Conta encontrada. Vamos criar sua loja ao pagar.');
});

/* ---------- pagar ---------- */
async function fn(action, extra) {
  if (!sb.functions) return { error: 'indisponível' };
  const { data, error } = await sb.functions.invoke('assinatura', { body: { action, origin: location.origin, ...extra } });
  if (error) { let msg = 'Não foi possível falar com o servidor.'; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} return { error: msg }; }
  return data || {};
}
$('#pay-btn').addEventListener('click', async () => {
  $('#pay-err').textContent = '';
  const btn = $('#pay-btn'); btn.disabled = true; const label = $('#pay-txt').textContent; $('#pay-txt').textContent = 'Aguarde…';
  try {
    if (!(await ensureAccount())) return;
    const { data: sp, error } = await sb.rpc('start_subscription', { p_plan: plan, p_method: method() });
    if (error || !sp) { $('#pay-err').textContent = (error && error.message) || 'Não foi possível iniciar o pagamento.'; return; }
    if (sp.method === 'pix') return showPix(sp);
    const r = await fn('create', { public_id: sp.public_id });
    if (r.error) { $('#pay-err').textContent = r.error; return; }
    if (r.url) { $('#pay-txt').textContent = 'Abrindo o Mercado Pago…'; location.href = r.url; return; }
  } finally { btn.disabled = false; if ($('#pay-txt').textContent === 'Aguarde…') $('#pay-txt').textContent = label; }
});
$('#trial-btn').addEventListener('click', async () => {
  $('#pay-err').textContent = '';
  if (await ensureAccount()) location.href = 'painel.html?bemvindo=1';
});

async function showPix(sp) {
  let code = null, auto = false;
  const r = await fn('create', { public_id: sp.public_id });
  if (r.status === 'pago') return done();
  if (r.mode === 'auto' && r.qr_code) { code = r.qr_code; auto = true; }
  else if (SETTINGS.pix_key && window.BoraPix) {
    code = window.BoraPix.payload({ key: SETTINGS.pix_key, name: SETTINGS.pix_name || 'BORALANCHAR', city: SETTINGS.pix_city || 'BRASIL', amount: Number(sp.amount), txid: `BLSUB${sp.public_id.replace(/-/g, '').slice(0, 18)}`, info: `Plano ${sp.plan} BoraLanchar` });
  }
  if (!code) { $('#pay-err').textContent = 'O Pix ainda não está disponível. Fale com a gente no WhatsApp.'; return; }
  step(['step-pix']); window.scrollTo(0, 0);
  $('#pix-amount').textContent = brl(sp.amount);
  $('#pix-qr').innerHTML = window.BoraQR.svg(code, { label: 'QR Code Pix da assinatura', color: '#1A1112' });
  $('#pix-code').textContent = code;
  $('#pix-to').innerHTML = auto ? 'Pagamento processado pelo Mercado Pago para <b>BoraLanchar!</b>.' : `Você vai pagar para <b>${esc(SETTINGS.pix_name || 'BoraLanchar!')}</b>${SETTINGS.pix_bank ? ' · ' + esc(SETTINGS.pix_bank) : ''}.`;
  $('#pix-wait').textContent = auto ? 'Assim que o Pix for aprovado, seu plano é ativado e esta tela muda sozinha.' : 'Assim que confirmarmos o recebimento, seu plano é ativado e esta tela muda sozinha.';
  watch(sp.public_id, auto);
}
function watch(publicId, auto) {
  clearInterval(poll);
  const tick = async () => {
    let st = null;
    if (auto) st = (await fn('status', { public_id: publicId })).status;
    else { const { data } = await sb.from('subscription_payments').select('status').eq('public_id', publicId).maybeSingle(); st = data && data.status; }
    if (st === 'pago') { clearInterval(poll); done(); }
    if (st === 'cancelado') { clearInterval(poll); step(['step-conta', 'step-pag']); $('#pay-err').textContent = 'Este pagamento foi cancelado. Tente de novo.'; }
  };
  tick(); poll = setInterval(tick, 5000);
}
async function done() {
  if (user) await loadMine();
  step(['step-ok']); window.scrollTo(0, 0);
  const until = R && R.paid_until ? new Date(R.paid_until).toLocaleDateString('pt-BR') : null;
  $('#ok-title').textContent = `Plano ${R ? R.plan : plan} ativado!`;
  $('#ok-text').textContent = `Pagamento confirmado. Seu cardápio está liberado${until ? ' até ' + until : ''}. Agora é só montar o cardápio e divulgar o seu link.`;
}
$('#pix-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#pix-code').textContent); toast('Código Pix copiado! Cole no app do banco em Pix › Copia e cola.'); }
  catch (_) { $('.as-code').open = true; toast('Toque e segure o código abaixo para copiar.'); }
});
$('#pix-back').addEventListener('click', () => { clearInterval(poll); step(['step-conta', 'step-pag']); });

/* ---------- início ---------- */
async function boot() {
  renderPlan();
  if (!sb) { $('#pay-err').textContent = 'Pagamento indisponível no momento.'; return; }
  const [{ data: st }, { data: { session } }] = await Promise.all([
    sb.from('platform_settings').select('pix_key, pix_name, pix_city, pix_bank, mp_enabled').eq('id', 1).maybeSingle(),
    sb.auth.getSession(),
  ]);
  SETTINGS = st || {};
  if (session) { user = session.user; await loadMine(); if (R && !params.get('plano')) plan = R.plan; }
  renderAccount(); renderPlan();
  const ref = params.get('ref');
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) { // voltou do Mercado Pago
    step(['step-check']);
    let tries = 0;
    clearInterval(poll);
    poll = setInterval(async () => {
      tries++;
      const r = await fn('status', { public_id: ref });
      if (r.status === 'pago') { clearInterval(poll); done(); return; }
      if (tries === 6) { $('#check-txt').textContent = 'Boleto ou pagamento em análise? Seu plano é ativado sozinho assim que o banco confirmar (boleto: até 3 dias úteis).'; $('#check-panel').hidden = false; }
      if (tries > 60) clearInterval(poll);
    }, 4000);
    return;
  }
  step(['step-conta', 'step-pag']);
}
boot();
