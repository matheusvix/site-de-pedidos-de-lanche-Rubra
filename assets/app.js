/* ============================================================
   Rubra — interações da landing page
   Configuração em assets/config.js
   ============================================================ */
const CONFIG = window.RUBRA_CONFIG || {};
const sb = (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase)
  ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

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
function openModal(id, opts = {}) {
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
  if (opener) { e.preventDefault(); openModal(opener.dataset.open, { plan: opener.dataset.plan }); return; }
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

async function sendLead(type, data) {
  if (!sb) { console.warn('Supabase não configurado em assets/config.js — lead não foi salvo.'); return true; }
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
  return !error;
}

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

    if (kind === 'login') {
      if (!sb) { btn.disabled = false; btn.innerHTML = label; toast('Login indisponível: configure o Supabase em assets/config.js.'); return; }
      const { error } = await sb.auth.signInWithPassword({ email: data.email.trim(), password: data.senha });
      if (error) { btn.disabled = false; btn.innerHTML = label; toast('E-mail ou senha incorretos.'); return; }
      location.href = 'admin.html';
      return;
    }

    if (kind === 'consultor') {
      await sendLead('consultor', data);
      const msg = `Olá! Sou ${data.nome}, do ${data.loja}. Assunto: ${data.assunto}.${data.mensagem ? ' ' + data.mensagem : ''}`;
      window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      successView(form, 'Tudo certo!', 'Abrimos o WhatsApp numa nova aba com sua mensagem pronta.');
      return;
    }

    const ok = await sendLead('cadastro', data);
    if (!ok) { btn.disabled = false; btn.innerHTML = label; toast('Não foi possível enviar agora. Tente de novo.'); return; }
    successView(form, `Bem-vindo, ${data.nome.split(' ')[0]}!`, `Recebemos o cadastro do ${data.loja}. Em instantes você recebe no WhatsApp o acesso ao seu teste do plano ${data.plano}.`);
  });
});

$('[data-action="forgot"]').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('#l-email').value.trim();
  if (!email) { toast('Digite seu e-mail acima para redefinir a senha.'); return; }
  if (sb) {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('admin.html', location.href).href });
  }
  toast(`Se ${email} tiver conta, enviaremos o link de redefinição.`);
});

/* ---------- Cardápio interativo no mockup ---------- */
const MENU = {
  massas: [
    { n: 'Talharim ao sugo', d: 'Molho de tomate da casa', p: 39.9, c: '#F4D9DB' },
    { n: 'Nhoque de batata', d: 'Manteiga e sálvia', p: 42.9, c: '#EFC9CC' },
    { n: 'Lasanha bolonhesa', d: 'Porção individual', p: 45.9, c: '#F7E4E5' },
  ],
  pizzas: [
    { n: 'Margherita', d: 'Tomate, muçarela e manjericão', p: 54.9, c: '#F4D9DB' },
    { n: 'Calabresa', d: 'Calabresa e cebola roxa', p: 52.9, c: '#EFC9CC' },
    { n: 'Quatro queijos', d: 'Muçarela, provolone, gorgonzola', p: 58.9, c: '#F7E4E5' },
  ],
  bebidas: [
    { n: 'Refrigerante lata', d: '350 ml', p: 7.0, c: '#F7E4E5' },
    { n: 'Suco natural', d: 'Laranja ou limão, 500 ml', p: 12.0, c: '#F4D9DB' },
    { n: 'Água com gás', d: '500 ml', p: 5.5, c: '#EFC9CC' },
  ],
};
const bag = { count: 0, total: 0 };
const itemsEl = $('#menu-items');
function renderMenu(cat) {
  itemsEl.innerHTML = MENU[cat].map((it, i) => `
    <div class="item"><span class="thumb" style="background:${it.c}"></span>
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
renderMenu('massas');

/* ---------- Depoimentos (carrossel + destaque no hero) ---------- */
const TESTIMONIALS = [
  { r: '[+00%]', q: '[Depoimento real do cliente, contando o resultado obtido.]', n: '[Nome do cliente]', l: '[Restaurante · Cidade]' },
  { r: '[+00%]', q: '[Depoimento real do cliente, contando o resultado obtido.]', n: '[Nome do cliente]', l: '[Pizzaria · Cidade]' },
  { r: '[-00%]', q: '[Depoimento real do cliente, contando o resultado obtido.]', n: '[Nome do cliente]', l: '[Hamburgueria · Cidade]' },
  { r: '[+00%]', q: '[Depoimento real do cliente, contando o resultado obtido.]', n: '[Nome do cliente]', l: '[Açaiteria · Cidade]' },
  { r: '[+00]', q: '[Depoimento real do cliente, contando o resultado obtido.]', n: '[Nome do cliente]', l: '[Japonês · Cidade]' },
];
const slidesEl = $('#slides');
slidesEl.innerHTML = TESTIMONIALS.map((t) => `
  <figure class="slide"><span class="result">${t.r}</span>
    <blockquote>“${t.q}”</blockquote>
    <figcaption><i aria-hidden="true">${t.n.replace(/\W/g, '').charAt(0) || 'C'}</i><span><b>${t.n}</b><span>${t.l}</span></span></figcaption>
  </figure>`).join('');
const step = () => (slidesEl.firstElementChild?.offsetWidth || 300) + 20;
$('#prev').addEventListener('click', () => slidesEl.scrollBy({ left: -step(), behavior: 'smooth' }));
$('#next').addEventListener('click', () => {
  const end = slidesEl.scrollLeft + slidesEl.clientWidth >= slidesEl.scrollWidth - 4;
  slidesEl.scrollTo({ left: end ? 0 : slidesEl.scrollLeft + step(), behavior: 'smooth' });
});

let hq = 0;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function heroQuote() {
  const t = TESTIMONIALS[hq % TESTIMONIALS.length];
  $('#hq-text').textContent = `“${t.q}”`;
  $('#hq-who').textContent = `${t.n} · ${t.l}`;
  $('#hq-avatar').textContent = String((hq % TESTIMONIALS.length) + 1);
  hq += 1;
}
heroQuote();
if (!reduce) setInterval(heroQuote, 5000);

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
  ['Consigo usar meu próprio número de WhatsApp?', 'Sim. Você conecta o número que já usa no restaurante e mantém o histórico das conversas.'],
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
