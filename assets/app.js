/* ============================================================
   BoraLanchar! — interações da landing page
   Configuração em assets/config.js
   ============================================================ */
const CONFIG = window.BORA_CONFIG || window.TILIM_CONFIG || window.RUBRA_CONFIG || {};

/* O Supabase (~50 KB) só é baixado depois que a página aparece, ou na hora em que alguém
   abre um formulário. Assim ele não atrasa o primeiro carregamento. */
const SB_SRC = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];
let sbPromise = null;
function getSb() {
  if (sbPromise) return sbPromise;
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return (sbPromise = Promise.resolve(null));
  sbPromise = new Promise((resolve) => {
    const make = () => {
      try { resolve(window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)); }
      catch (e) { console.warn('Supabase indisponível', e); resolve(null); }
    };
    if (window.supabase) { make(); return; }
    const tryLoad = (i) => {
      if (i >= SB_SRC.length) { resolve(null); return; }
      const el = document.createElement('script');
      el.src = SB_SRC[i]; el.async = true;
      el.onload = make; el.onerror = () => { el.remove(); tryLoad(i + 1); };
      document.head.appendChild(el);
    };
    tryLoad(0);
  });
  return sbPromise;
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------- Toast ---------- */
const toastEl = $('.toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

/* ---------- Menu mobile ---------- */
const menuBtn = $('.menu-toggle');
const mobileMenu = $('#menu-mobile');
function setMenu(open) {
  mobileMenu.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
}
menuBtn.addEventListener('click', () => setMenu(!mobileMenu.classList.contains('open')));
$$('a', mobileMenu).forEach((a) => a.addEventListener('click', () => setMenu(false)));

/* ---------- Modais ---------- */
function playDemo() {
  const box = document.getElementById('demo'); const v = document.getElementById('demo-video');
  if (!box || !v) return;
  setMenu(false);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  box.classList.add('playing'); v.controls = true;
  const p = v.play(); if (p && p.catch) p.catch(() => {});
}
const demoBtn = document.getElementById('demo-play');
if (demoBtn) demoBtn.addEventListener('click', playDemo);
const demoVid = document.getElementById('demo-video');
if (demoVid) demoVid.addEventListener('ended', () => { demoVid.controls = false; demoVid.currentTime = 0; document.getElementById('demo').classList.remove('playing'); });

function openModal(id, opts = {}) {
  if (id === 'video') { playDemo(); return; }
  const d = document.getElementById(id);
  if (!d) return;
  $$('dialog[open]').forEach((o) => o !== d && o.close());
  setMenu(false);
  if (opts.plan) { const sel = $('#s-plano'); if (sel) sel.value = opts.plan; }
  if (!d.open) d.showModal();
  const first = $('input, select, textarea', d);
  if (first) setTimeout(() => first.focus(), 50);
}
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) { e.preventDefault(); getSb(); openModal(opener.dataset.open, { plan: opener.dataset.plan }); return; }
  const closer = e.target.closest('[data-close]');
  if (closer) { closer.closest('dialog').close(); return; }
  if (e.target.tagName === 'DIALOG') e.target.close(); // clique no fundo
});

/* ---------- Validação e envio de formulários ---------- */
function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
$$('[data-mask="phone"]').forEach((i) => i.addEventListener('input', () => { i.value = maskPhone(i.value); }));

function fieldError(input) {
  const v = input.value.trim();
  if (input.type === 'checkbox') return input.checked ? '' : 'É preciso aceitar para continuar.';
  if (input.required && !v) return 'Campo obrigatório.';
  if (input.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Informe um e-mail válido.';
  if (input.dataset.mask === 'phone' && v.replace(/\D/g, '').length < 10) return 'Informe um WhatsApp com DDD.';
  if (input.minLength > 0 && v.length < input.minLength) return `Mínimo de ${input.minLength} caracteres.`;
  return '';
}
function showError(input, msg) {
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  const err = input.type === 'checkbox'
    ? $(`[data-err="${input.name}"]`, input.form)
    : input.parentElement.querySelector('.err');
  if (err) err.textContent = msg;
}
function validate(form) {
  let firstBad = null;
  $$('input, select, textarea', form).forEach((i) => {
    const msg = fieldError(i);
    showError(i, msg);
    if (msg && !firstBad) firstBad = i;
  });
  if (firstBad) firstBad.focus();
  return !firstBad;
}
$$('form input, form select').forEach((i) => i.addEventListener('blur', () => { if (i.value) showError(i, fieldError(i)); }));

/* Envia uma cópia para a Netlify Forms (aparece no painel da Netlify e pode avisar por e-mail).
   Funciona sozinha mesmo sem o Supabase configurado. */
async function netlifySave(formName, fields) {
  if (location.protocol === 'file:') return false;
  try {
    const body = new URLSearchParams({ 'form-name': formName });
    Object.entries(fields).forEach(([k, v]) => { if (v != null && v !== '') body.append(k, String(v).slice(0, 2000)); });
    const r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    return r.ok;
  } catch (e) { console.warn('Netlify Forms indisponível', e); return false; }
}

async function sendLead(type, data) {
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, data[k]]));
  const netOk = await netlifySave(type === 'cadastro' ? 'cadastro' : 'contato',
    type === 'cadastro' ? pick(['nome', 'loja', 'telefone', 'segmento', 'email', 'plano']) : pick(['nome', 'loja', 'assunto', 'mensagem']));
  const sb = await getSb();
  if (!sb) { if (!netOk) console.warn('Nem Supabase nem Netlify Forms disponíveis — lead não foi salvo.'); return netOk; }
  const clip = (v, n) => (v ? String(v).trim().slice(0, n) : null);
  const row = {
    tipo: type,
    nome: clip(data.nome, 120),
    loja: clip(data.loja, 160),
    telefone: clip(data.telefone, 30),
    email: clip(data.email, 200),
    segmento: clip(data.segmento, 60),
    plano: clip(data.plano, 40),
    assunto: clip(data.assunto, 120),
    mensagem: clip(data.mensagem, 2000),
  };
  const { error } = await sb.from('leads').insert(row);
  if (error) console.error(error);
  return !error || netOk;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function successView(form, title, text) {
  form.innerHTML = `<div class="success">
    <i><svg width="34" height="34" style="color:#2E8B57"><use href="#i-check"/></svg></i>
    <h3 style="font-size:24px">${title}</h3><p style="color:var(--muted)">${text}</p>
    <button class="btn btn-primary btn-block" type="button" data-close>Fechar</button></div>`;
}

$$('form[data-form]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form)) return;
    const data = Object.fromEntries(new FormData(form));
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'Enviando…';
    const kind = form.dataset.form;
    const sb = await getSb();

    if (kind === 'login') {
      if (!sb) { btn.disabled = false; btn.innerHTML = label; toast('Login indisponível: configure o Supabase em assets/config.js.'); return; }
      const { error } = await sb.auth.signInWithPassword({ email: data.email.trim(), password: data.senha });
      if (error) { btn.disabled = false; btn.innerHTML = label; toast('E-mail ou senha incorretos.'); return; }
      { const { data: isAdm } = await sb.rpc('is_admin'); location.href = isAdm ? 'admin.html' : 'painel.html'; }
      return;
    }

    if (kind === 'depoimento') {
      const ok = await sendTestimonial(data);
      if (!ok) { btn.disabled = false; btn.innerHTML = label; toast('Não foi possível enviar agora. Tente de novo.'); return; }
      successView(form, 'Obrigado pelo depoimento!', 'Ele foi enviado para aprovação e aparece no site assim que for liberado.');
      return;
    }

    if (kind === 'consultor') {
      await sendLead('consultor', data);
      const msg = `Olá! Sou ${data.nome}, do ${data.loja}. Assunto: ${data.assunto}.${data.mensagem ? ' ' + data.mensagem : ''}`;
      const waUrl = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`;
      const win = window.open(waUrl, '_blank');
      if (win) win.opener = null;
      successView(form, 'Tudo certo!', win
        ? 'Abrimos o WhatsApp numa nova aba com sua mensagem pronta.'
        : 'Recebemos seu pedido de contato. Um especialista vai chamar você no WhatsApp informado.');
      return;
    }

    const ok = await sendLead('cadastro', { ...data, senha: undefined });
    const first = data.nome.trim().split(' ')[0];
    const waMsg = `Olá! Sou ${data.nome.trim()}, do ${data.loja.trim()}. Acabei de criar minha conta no BoraLanchar! (plano ${data.plano}). Meu WhatsApp: ${data.telefone}.`;
    const waUrl = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(waMsg)}`;

    // Sem banco configurado: guarda o cadastro e segue pelo WhatsApp
    if (!sb) {
      if (!ok) { btn.disabled = false; btn.innerHTML = label; toast('Não foi possível enviar agora. Tente de novo.'); return; }
      form.innerHTML = `<div class="success">
        <i><svg width="34" height="34" style="color:#2E8B57"><use href="#i-check"/></svg></i>
        <h3 style="font-size:24px">Cadastro recebido, ${escapeHtml(first)}!</h3>
        <p style="color:var(--muted)">Toque no botão abaixo e envie a mensagem pronta no WhatsApp para liberarmos seu acesso.</p>
        <a class="btn btn-primary btn-lg btn-block" href="${waUrl}" target="_blank" rel="noopener">Falar no WhatsApp</a>
        <button class="btn btn-ghost btn-block" type="button" data-close>Fechar</button></div>`;
      return;
    }

    // Cria a conta do restaurante (o painel termina de montar a loja no primeiro acesso)
    const { data: auth, error } = await sb.auth.signUp({
      email: data.email.trim(),
      password: data.senha,
      options: {
        data: { nome: data.nome.trim(), loja: data.loja.trim(), telefone: data.telefone, segmento: data.segmento, plano: data.plano },
        emailRedirectTo: new URL('painel.html', location.href).href,
      },
    });
    if (error) {
      btn.disabled = false; btn.innerHTML = label;
      const already = /registered|already/i.test(error.message);
      toast(already ? 'Este e-mail já tem conta. Use "Entrar" para acessar seu painel.' : 'Não foi possível criar a conta: ' + error.message);
      return;
    }
    if (auth.session) {
      await sb.rpc('create_my_restaurant', { p_name: data.loja.trim(), p_whatsapp: data.telefone, p_segment: data.segmento, p_plan: data.plano });
      location.href = 'painel.html?bemvindo=1';
      return;
    }
    // e-mail que já tem conta: o Supabase não manda e-mail nenhum — tenta entrar com a senha digitada
    {
      const { data: li } = await sb.auth.signInWithPassword({ email: data.email.trim(), password: data.senha });
      if (li && li.session) { location.href = 'painel.html'; return; }
      if (auth.user && Array.isArray(auth.user.identities) && auth.user.identities.length === 0) {
        btn.disabled = false; btn.innerHTML = label;
        toast('Este e-mail já tem conta. Use "Entrar" para acessar seu painel.');
        return;
      }
    }
    // Confirmação de e-mail ligada no Supabase
    form.innerHTML = `<div class="success">
      <i><svg width="34" height="34" style="color:#2E8B57"><use href="#i-check"/></svg></i>
      <h3 style="font-size:24px">Quase lá, ${escapeHtml(first)}!</h3>
      <p style="color:var(--muted)">Enviamos um link de confirmação para <b>${escapeHtml(data.email.trim())}</b>. Abra o e-mail, toque no link e seu painel abre com o teste de 7 dias do plano ${escapeHtml(data.plano)}.</p>
      <a class="btn btn-ghost btn-block" href="${waUrl}" target="_blank" rel="noopener">Não chegou? Fale com a gente no WhatsApp</a>
      <button class="btn btn-primary btn-block" type="button" data-close>Fechar</button></div>`;
  });
});

$('[data-action="forgot"]').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim();
  if (!email) { toast('Digite seu e-mail acima para redefinir a senha.'); return; }
  const sb = await getSb();
  if (sb) {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('painel.html', location.href).href });
  }
  toast(`Se ${email} tiver conta, enviaremos o link de redefinição.`);
});

/* ---------- Cardápio interativo no mockup ---------- */
const MENU = {
  classicos: [
    { n: 'Brasa Clássico', d: 'Blend 150 g, queijo e salada', p: 24.9, img: 'assets/img/brasa-classico.jpg' },
    { n: 'Brasa Salada', d: 'Muçarela e maionese verde', p: 26.9, img: 'assets/img/brasa-salada.jpg' },
    { n: 'Bacon Brasa', d: 'Cheddar, bacon e cebola', p: 29.9, img: 'assets/img/bacon-brasa.jpg' },
  ],
  especiais: [
    { n: 'Duplo Rubro', d: 'Dois blends, cheddar e bacon', p: 36.9, img: 'assets/img/duplo-rubro.jpg' },
    { n: 'Frango Crocante', d: 'Empanado na panko, coleslaw', p: 27.9, img: 'assets/img/frango-crocante.jpg' },
  ],
};
const bag = { count: 0, total: 0 };
const itemsEl = $('#menu-items');
function renderMenu(cat) {
  itemsEl.innerHTML = MENU[cat].map((it, i) => `
    <div class="item"><img class="thumb" src="${it.img}" alt="${it.n}" width="56" height="56" loading="lazy">
      <div><b>${it.n}</b><span>${it.d}</span><strong>${brl(it.p)}</strong></div>
      <button class="add" data-add="${cat}:${i}" aria-label="Adicionar ${it.n}">+</button></div>`).join('');
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderMenu(b.dataset.cat);
}));
itemsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  const [cat, i] = b.dataset.add.split(':');
  bag.count += 1; bag.total += MENU[cat][i].p;
  $('#bag-count').textContent = `Ver sacola · ${bag.count} ${bag.count === 1 ? 'item' : 'itens'}`;
  $('#bag-total').textContent = brl(bag.total);
});
renderMenu('classicos');

/* ---------- Depoimentos ----------
   Mostra só depoimentos reais aprovados no painel (tabela testimonials).
   Enquanto não houver nenhum, exibe cartões-modelo marcados como "Exemplo". */
const EXAMPLES = [
  { texto: 'Os pedidos do WhatsApp passaram a chegar organizados e o cliente já paga no Pix antes de o lanche sair da chapa.', segmento: 'Hamburgueria' },
  { texto: 'Atualizo o cardápio em segundos quando um ingrediente acaba, sem precisar mandar PDF novo para ninguém.', segmento: 'Restaurante' },
  { texto: 'O painel mostra o que mais vende em cada dia da semana e ajudou a montar os combos certos.', segmento: 'Pizzaria' },
  { texto: 'Os clientes pedem pelo QR Code na mesa e o garçom só leva o pedido pronto. O salão ficou muito mais calmo.', segmento: 'Lanchonete' },
];
const slidesEl = $('#slides');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const initials = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '•';

function renderTestimonials(list, isExample) {
  slidesEl.innerHTML = list.map((t) => `
    <figure class="slide${isExample ? ' example' : ''}">
      <div class="tags">${isExample ? '<span class="ex-tag">Exemplo</span>' : ''}<span class="seg-tag">${esc(t.segmento)}</span></div>
      <blockquote>“${esc(t.texto)}”</blockquote>
      <figcaption><i aria-hidden="true">${isExample ? '?' : esc(initials(t.nome))}</i><span>
        <b>${isExample ? 'Nome do cliente' : esc(t.nome)}</b>
        <span>${isExample ? 'Estabelecimento · Cidade' : esc(t.loja) + ' · ' + esc(t.cidade)}</span></span></figcaption>
    </figure>`).join('');
  $('#tst-note').hidden = !isExample;
}
const step = () => (slidesEl.firstElementChild?.offsetWidth || 300) + 20;
$('#prev').addEventListener('click', () => slidesEl.scrollBy({ left: -step(), behavior: 'smooth' }));
$('#next').addEventListener('click', () => {
  const end = slidesEl.scrollLeft + slidesEl.clientWidth >= slidesEl.scrollWidth - 4;
  slidesEl.scrollTo({ left: end ? 0 : slidesEl.scrollLeft + step(), behavior: 'smooth' });
});

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function startHeroQuote(list) { // só com depoimentos reais
  if (!list.length) return;
  let hq = 0;
  const show = () => {
    const t = list[hq % list.length];
    $('#hq-text').textContent = `“${t.texto.length > 110 ? t.texto.slice(0, 107) + '…' : t.texto}”`;
    $('#hq-who').textContent = `${t.nome} · ${t.loja}`;
    $('#hq-avatar').textContent = initials(t.nome);
    hq += 1;
  };
  $('#hero-quote').hidden = false;
  show();
  if (!reduce && list.length > 1) setInterval(show, 5000);
}

async function loadTestimonials() {
  const sb = await getSb();
  if (!sb) return;
  const { data, error } = await sb.from('testimonials').select('nome,loja,cidade,segmento,texto')
    .eq('status', 'aprovado').order('created_at', { ascending: false }).limit(12);
  if (error) { console.warn('Depoimentos indisponíveis:', error.message); return; }
  if (data && data.length) { renderTestimonials(data, false); startHeroQuote(data); }
}
renderTestimonials(EXAMPLES, true);
// Depoimentos reais: busca depois que a página terminou de carregar (sem disputar banda com o topo)
const whenIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1200));
if (document.readyState === 'complete') whenIdle(loadTestimonials);
else addEventListener('load', () => whenIdle(loadTestimonials), { once: true });

async function sendTestimonial(data) {
  const netOk = await netlifySave('depoimento', { nome: data.nome, loja: data.loja, cidade: data.cidade, segmento: data.segmento, texto: data.texto });
  const sb = await getSb();
  if (!sb) return netOk;
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const { error } = await sb.from('testimonials').insert({
    nome: clip(data.nome, 80), loja: clip(data.loja, 120), cidade: clip(data.cidade, 80),
    segmento: clip(data.segmento, 40), texto: clip(data.texto, 400),
  });
  if (error) console.error(error);
  return !error || netOk;
}

/* ---------- Planos: mensal / anual ---------- */
$$('[data-billing]').forEach((b) => b.addEventListener('click', () => {
  const annual = b.dataset.billing === 'anual';
  $$('[data-billing]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $$('.price b').forEach((p) => { p.textContent = annual ? p.dataset.a : p.dataset.m; });
  $$('.price .per').forEach((s) => { s.textContent = annual ? '/mês, cobrado anualmente' : '/mês'; });
}));

/* ---------- FAQ (acordeão acessível) ---------- */
const FAQ = [
  ['Serve para delivery e para atendimento no salão?', 'Sim. O mesmo cardápio atende delivery, retirada e mesas via QR Code, e o plano Completo inclui o app do garçom.'],
  ['Preciso cadastrar um cartão para testar?', 'Não. O período de teste é liberado só com seus dados de contato, e você decide depois se quer continuar.'],
  ['Existe comissão sobre cada venda?', 'Não cobramos por pedido. Você paga a mensalidade do plano; apenas transações online têm a tarifa da operadora de pagamento.'],
  ['Quais formas de pagamento posso aceitar?', 'Pix, cartões de crédito e débito e carteiras digitais online, além de dinheiro e maquininha na entrega.'],
  ['Como funciona o robô de atendimento no WhatsApp?', 'Ele usa a API oficial do WhatsApp (Meta). Quando o cliente manda mensagem, o robô responde na hora com um menu: cardápio, horário, taxa de entrega e pagamento. Também avisa quando o pedido muda de status e chama você quando o cliente pede um atendente. Você acompanha e responde as conversas pelo painel.'],
  ['Posso usar o número de WhatsApp que já tenho?', 'Pela regra da Meta, o número do robô precisa ficar só na API oficial, fora do aplicativo do WhatsApp. Muitos restaurantes usam um chip novo só para o atendimento. A Meta também pede a verificação da empresa (com CNPJ, que pode ser de MEI). A gente te ajuda no passo a passo.'],
  ['Posso cancelar quando quiser?', 'Pode. Não há fidelidade nem multa; o cancelamento é feito pelo próprio painel.'],
];
$('#faq').innerHTML = FAQ.map(([q, a], i) => `
  <div class="faq-item">
    <h3><button aria-expanded="false" aria-controls="faq-${i}" id="faq-q-${i}">${q}<i aria-hidden="true">+</i></button></h3>
    <div class="faq-panel" id="faq-${i}" role="region" aria-labelledby="faq-q-${i}" hidden>${a}</div>
  </div>`).join('');
$('#faq').addEventListener('click', (e) => {
  const b = e.target.closest('button[aria-controls]');
  if (!b) return;
  const open = b.getAttribute('aria-expanded') === 'true';
  b.setAttribute('aria-expanded', String(!open));
  document.getElementById(b.getAttribute('aria-controls')).hidden = open;
});

/* ---------- Voltar ao topo + animações ao rolar ---------- */
const toTop = $('.to-top');
addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 900), { passive: true });
toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));

if ('IntersectionObserver' in window && !reduce) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));
} else {
  $$('.reveal').forEach((el) => el.classList.add('in'));
}

$('#year').textContent = new Date().getFullYear();

/* Planos no celular: o cartão no meio da tela fica colorido; os atalhos levam a cada plano */
(() => {
  const wrap = document.querySelector('.plans');
  if (!wrap) return;
  const cards = [...wrap.querySelectorAll('.plan[data-plan-key]')];
  const tabs = [...document.querySelectorAll('.plan-tabs button')];
  const touch = window.matchMedia('(hover: none)');
  function setOn(card) {
    cards.forEach((c) => c.classList.toggle('is-on', c === card));
    wrap.classList.toggle('has-on', !!card);
    const key = card ? card.dataset.planKey : 'profissional';
    tabs.forEach((t) => t.setAttribute('aria-current', String(t.dataset.to === key)));
  }
  tabs.forEach((t) => t.addEventListener('click', () => {
    const card = document.getElementById('plano-' + t.dataset.to);
    setOn(card);
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));
  cards.forEach((c) => c.addEventListener('click', (e) => { if (touch.matches && !e.target.closest('button,a')) setOn(c); }));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!touch.matches) return;
      entries.forEach((en) => { if (en.isIntersecting) setOn(en.target); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    cards.forEach((c) => io.observe(c));
    // esconde os botões flutuantes enquanto os planos ocupam a tela (só no celular, via CSS)
    new IntersectionObserver(([en]) => document.body.classList.toggle('plans-in-view', en.isIntersecting), { rootMargin: '-20% 0px -20% 0px' }).observe(wrap);
  }
})();
