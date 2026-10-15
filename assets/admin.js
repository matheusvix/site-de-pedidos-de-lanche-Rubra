/* ============================================================
   BoraLanchar! — painel administrativo
   Login real via Supabase Auth; dados protegidos por RLS
   (só e-mails da tabela public.admins leem os leads).
   Sem Supabase configurado (ou com ?demo na URL), o painel
   abre em MODO DEMONSTRAÇÃO, com dados fictícios locais.
   ============================================================ */
const CFG = window.BORA_CONFIG || window.TILIM_CONFIG || window.RUBRA_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);

const STATUS = { novo: 'Novo', em_contato: 'Em contato', convertido: 'Convertido', perdido: 'Perdido' };
const ORIGEM = { cadastro: 'Teste grátis', consultor: 'Especialista' };

const configured = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
const DEMO = window.BORA_DEMO === true || window.TILIM_DEMO === true || new URLSearchParams(location.search).has('demo') || !configured;
const sb = DEMO ? null : window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

// O link do convite/redefinição chega com #...type=invite|recovery
const hashType = new URLSearchParams(location.hash.slice(1)).get('type');
let mustSetPassword = !DEMO && (hashType === 'invite' || hashType === 'recovery');

/* ---------- utilidades ---------- */
const toastEl = $('.toast');
let tt;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(tt);
  tt = setTimeout(() => toastEl.classList.remove('show'), 3200);
}
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  kids.flat().forEach((c) => c != null && n.append(c));
  return n;
}
const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const digits = (s) => (s || '').replace(/\D/g, '');
function waLink(tel) {
  let d = digits(tel);
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}`;
}
function show(view) {
  ['login', 'password', 'message', 'app'].forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
}
function message(title, text, btnLabel = 'Sair') {
  $('#msg-title').textContent = title;
  $('#msg-text').textContent = text;
  $('#msg-btn').textContent = btnLabel;
  show('message');
}

/* ---------- dados de demonstração (fictícios) ---------- */
function demoLeads() {
  const h = 36e5;
  const ago = (hours) => new Date(Date.now() - hours * h).toISOString();
  return [
    { id: 12, created_at: ago(0.4), tipo: 'cadastro', nome: 'Juliana Prates', loja: 'Cantina da Ju', telefone: '(27) 99812-4410', email: 'juliana@exemplo.com', segmento: 'Restaurante', plano: 'Profissional', status: 'novo', notas: null },
    { id: 11, created_at: ago(2), tipo: 'consultor', nome: 'Rafael Moura', loja: 'Brasa Burger', telefone: '(27) 98877-1203', assunto: 'Dúvida sobre planos', mensagem: 'Tenho duas lojas, o plano Completo atende as duas?', status: 'novo', notas: null },
    { id: 10, created_at: ago(5), tipo: 'cadastro', nome: 'Camila Freitas', loja: 'Açaí do Porto', telefone: '(27) 99654-3321', email: 'camila@exemplo.com', segmento: 'Açaí e sorveteria', plano: 'Essencial', status: 'em_contato', notas: 'Ligar depois das 14h.' },
    { id: 9, created_at: ago(20), tipo: 'cadastro', nome: 'Diego Santana', loja: 'Pizzaria Forno Vivo', telefone: '(27) 99701-5588', email: 'diego@exemplo.com', segmento: 'Pizzaria', plano: 'Completo', status: 'convertido', notas: 'Fechou plano Completo anual.' },
    { id: 8, created_at: ago(30), tipo: 'consultor', nome: 'Patrícia Lima', loja: 'Doce Encanto', telefone: '(27) 99234-8890', assunto: 'Quero conhecer o BoraLanchar!', status: 'em_contato', notas: 'Agendada demonstração na sexta.' },
    { id: 7, created_at: ago(52), tipo: 'cadastro', nome: 'Marcos Vieira', loja: 'Sushi Mar', telefone: '(27) 98456-7712', email: 'marcos@exemplo.com', segmento: 'Japonês', plano: 'Profissional', status: 'convertido', notas: null },
    { id: 6, created_at: ago(76), tipo: 'cadastro', nome: 'Fernanda Rocha', loja: 'Lanchonete Ponto 10', telefone: '(27) 99120-6634', email: 'fernanda@exemplo.com', segmento: 'Lanchonete', plano: 'Essencial', status: 'perdido', notas: 'Achou caro neste momento.' },
    { id: 5, created_at: ago(110), tipo: 'cadastro', nome: 'Thiago Nunes', loja: 'Hamburgueria Chapa Quente', telefone: '(27) 99988-0021', email: 'thiago@exemplo.com', segmento: 'Hamburgueria', plano: 'Profissional', status: 'em_contato', notas: null },
    { id: 4, created_at: ago(150), tipo: 'consultor', nome: 'Aline Barbosa', loja: 'Café Grão Fino', telefone: '(27) 99345-1177', assunto: 'Já sou cliente — suporte', mensagem: 'Como cadastro adicionais no cardápio?', status: 'convertido', notas: 'Resolvido por vídeo.' },
    { id: 3, created_at: ago(200), tipo: 'cadastro', nome: 'Bruno Teixeira', loja: 'Restaurante Sabor Caseiro', telefone: '(27) 98712-4456', email: 'bruno@exemplo.com', segmento: 'Restaurante', plano: 'Completo', status: 'novo', notas: null },
  ];
}

let leads = [];
let current = null;

/* ---------- inicialização / rotas ---------- */
async function route() {
  if (DEMO) {
    $('#demo-banner').hidden = false;
    show('login');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('login'); return; }
  if (mustSetPassword) { show('password'); return; }

  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    message('Sem permissão', `A conta ${session.user.email} não é administradora deste painel.`);
    return;
  }
  enterApp(session.user.email);
}

function enterApp(email) {
  $('#who').textContent = email;
  show('app');
  loadLeads();
  loadTst();
  loadClients();
  loadPays();
  loadCob();
}

if (!DEMO) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { mustSetPassword = true; show('password'); }
    if (event === 'SIGNED_OUT') show('login');
  });
}

if (DEMO) {
  $('#demo-hint').hidden = false;
  $('#a-email').value = 'admin@boralanchar.demo';
  $('#a-senha').value = 'demonstracao';
}

/* ---------- login / senha / sair ---------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const email = $('#a-email').value.trim();
  const password = $('#a-senha').value;
  $('#login-err').textContent = '';
  if (!email || !password) { $('#login-err').textContent = 'Preencha e-mail e senha.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 450));
    btn.disabled = false; btn.textContent = 'Entrar';
    enterApp(email);
    return;
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { $('#login-err').textContent = 'E-mail ou senha incorretos.'; return; }
  route();
});

$('#forgot').addEventListener('click', async (e) => {
  e.preventDefault();
  if (DEMO) { toast('Na demonstração não há envio de e-mail.'); return; }
  const email = $('#a-email').value.trim();
  if (!email) { $('#login-err').textContent = 'Digite seu e-mail para receber o link.'; return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  toast('Se o e-mail tiver conta, o link de redefinição foi enviado.');
});

$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#p1').value, p2 = $('#p2').value;
  const err = $('#pass-err');
  err.textContent = '';
  if (p1.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
  if (p1 !== p2) { err.textContent = 'As senhas não conferem.'; return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { err.textContent = 'Não foi possível salvar: ' + error.message; return; }
  mustSetPassword = false;
  history.replaceState(null, '', location.pathname);
  toast('Senha definida!');
  route();
});

async function logout() {
  if (!DEMO) await sb.auth.signOut();
  show('login');
}
$('#logout').addEventListener('click', logout);
$('#msg-btn').addEventListener('click', logout);

/* ---------- dados ---------- */
async function loadLeads() {
  if (DEMO) {
    if (!leads.length) leads = demoLeads();
  } else {
    const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(5000);
    if (error) { toast('Erro ao carregar leads.'); console.error(error); return; }
    leads = data || [];
  }
  renderKpis();
  renderRows();
}
$('#refresh').addEventListener('click', () => { loadLeads(); toast('Lista atualizada.'); });

function renderKpis() {
  $('#k-total').textContent = leads.length;
  ['novo', 'em_contato', 'convertido'].forEach((s) => { $(`#k-${s}`).textContent = leads.filter((l) => l.status === s).length; });
  const week = Date.now() - 7 * 864e5;
  $('#k-7d').textContent = leads.filter((l) => new Date(l.created_at).getTime() >= week).length;
}

function filtered() {
  const q = $('#f-q').value.trim().toLowerCase();
  const tipo = $('#f-tipo').value, status = $('#f-status').value, plano = $('#f-plano').value;
  return leads.filter((l) =>
    (!tipo || l.tipo === tipo) &&
    (!status || l.status === status) &&
    (!plano || l.plano === plano) &&
    (!q || [l.nome, l.loja, l.email, l.telefone].some((v) => (v || '').toLowerCase().includes(q)))
  );
}
['#f-q', '#f-tipo', '#f-status', '#f-plano'].forEach((s) => $(s).addEventListener('input', renderRows));

function renderRows() {
  const list = filtered();
  $('#rows').replaceChildren(...list.map((l) => el('tr', {},
    el('td', {}, el('small', { text: fmtDate(l.created_at) })),
    el('td', {}, el('b', { text: l.nome }), el('small', { text: l.telefone || l.email || '—' })),
    el('td', {}, el('b', { text: l.loja }), el('small', { text: l.segmento || '' })),
    el('td', {}, el('span', { class: 'origin', text: ORIGEM[l.tipo] || l.tipo })),
    el('td', { text: l.plano || '—' }),
    el('td', {}, el('span', { class: `st st-${l.status}`, text: STATUS[l.status] || l.status })),
    el('td', {}, el('button', { class: 'btn btn-outline row-btn', type: 'button', text: 'Abrir', onclick: () => openLead(l) })),
  )));
  $('#empty').hidden = list.length > 0;
}

/* ---------- detalhe ---------- */
const dlg = $('#lead-dialog');
const delBtn = $('#ld-delete');
let deleteArmed = false;
function resetDelete() { deleteArmed = false; delBtn.textContent = 'Excluir'; }
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
dlg.addEventListener('close', resetDelete);

function openLead(l) {
  current = l;
  resetDelete();
  $('#ld-title').textContent = l.nome;
  $('#ld-sub').textContent = `${ORIGEM[l.tipo] || l.tipo} · ${fmtDate(l.created_at)}`;
  const rows = [
    ['Estabelecimento', l.loja], ['WhatsApp', l.telefone], ['E-mail', l.email], ['Segmento', l.segmento],
    ['Plano', l.plano], ['Assunto', l.assunto], ['Mensagem', l.mensagem],
  ].filter(([, v]) => v);
  $('#ld-data').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  $('#ld-status').value = l.status;
  $('#ld-notas').value = l.notas || '';
  const wa = waLink(l.telefone);
  const waBtn = $('#ld-wa');
  waBtn.hidden = !wa;
  if (wa) {
    const first = (l.nome || '').trim().split(' ')[0];
    const txt = l.tipo === 'cadastro'
      ? `Olá, ${first}! Aqui é do BoraLanchar! 🍔 Seu teste grátis de 7 dias do plano ${l.plano || 'Profissional'} para o ${l.loja || 'seu estabelecimento'} está liberado. Vamos montar seu cardápio juntos? Me conta quais são os itens mais vendidos e eu já deixo tudo no ar hoje.`
      : `Olá, ${first}! Aqui é do BoraLanchar!. Recebemos seu contato${l.assunto ? ` sobre "${l.assunto}"` : ''}. Como posso te ajudar?`;
    waBtn.href = `${wa}?text=${encodeURIComponent(txt)}`;
    waBtn.textContent = l.tipo === 'cadastro' ? 'Enviar acesso no WhatsApp' : 'Responder no WhatsApp';
  }
  dlg.showModal();
}

$('#ld-save').addEventListener('click', async () => {
  if (!current) return;
  const patch = { status: $('#ld-status').value, notas: $('#ld-notas').value.trim() || null };
  if (!DEMO) {
    const { error } = await sb.from('leads').update(patch).eq('id', current.id);
    if (error) { toast('Erro ao salvar.'); console.error(error); return; }
  }
  Object.assign(current, patch);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead atualizado.');
});

// Exclusão em dois cliques (sem caixa de diálogo do navegador)
delBtn.addEventListener('click', async () => {
  if (!current) return;
  if (!deleteArmed) { deleteArmed = true; delBtn.textContent = 'Clique de novo para excluir'; return; }
  if (!DEMO) {
    const { error } = await sb.from('leads').delete().eq('id', current.id);
    if (error) { toast('Erro ao excluir.'); return; }
  }
  leads = leads.filter((l) => l.id !== current.id);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead excluído.');
});

/* ---------- exportar CSV ---------- */
$('#export').addEventListener('click', () => {
  if (DEMO) { toast('Na demonstração a exportação fica desativada.'); return; }
  const cols = ['created_at', 'tipo', 'nome', 'loja', 'telefone', 'email', 'segmento', 'plano', 'assunto', 'mensagem', 'status', 'notas'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas ao abrir no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(';'), ...filtered().map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `leads-boralanchar-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
});

/* ---------- depoimentos ---------- */
let tst = [];
let tFilter = 'pendente';
function demoTst() {
  const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
  return [
    { id: 3, created_at: ago(1), nome: 'Camila Freitas', loja: 'Açaí do Porto', cidade: 'Vitória', segmento: 'Açaí e sorveteria', texto: '(Demonstração) Depoimento enviado pelo formulário do site aguardando sua aprovação.', status: 'pendente' },
    { id: 2, created_at: ago(9), nome: 'Diego Santana', loja: 'Pizzaria Forno Vivo', cidade: 'Serra', segmento: 'Pizzaria', texto: '(Demonstração) Depoimentos aprovados passam a aparecer no carrossel da página inicial.', status: 'pendente' },
    { id: 1, created_at: ago(40), nome: 'Marcos Vieira', loja: 'Sushi Mar', cidade: 'Vila Velha', segmento: 'Japonês', texto: '(Demonstração) Depoimentos ocultos ficam guardados aqui e saem do site.', status: 'oculto' },
  ];
}
async function loadTst() {
  if (DEMO) { if (!tst.length) tst = demoTst(); }
  else {
    const { data, error } = await sb.from('testimonials').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { toast('Erro ao carregar depoimentos.'); console.error(error); return; }
    tst = data || [];
  }
  renderTst();
}
function renderTst() {
  ['pendente', 'aprovado', 'oculto'].forEach((k) => { $(`#tc-${k}`).textContent = tst.filter((t) => t.status === k).length; });
  const list = tst.filter((t) => t.status === tFilter);
  $('#tst-list').replaceChildren(...list.map((t) => {
    const acts = [];
    if (t.status !== 'aprovado') acts.push(el('button', { class: 'btn btn-primary', type: 'button', text: 'Aprovar', onclick: () => setTst(t, 'aprovado') }));
    if (t.status !== 'oculto') acts.push(el('button', { class: 'btn btn-outline', type: 'button', text: t.status === 'aprovado' ? 'Tirar do site' : 'Ocultar', onclick: () => setTst(t, 'oculto') }));
    const del = el('button', { class: 'btn btn-ghost adm-danger', type: 'button', text: 'Excluir' });
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Clique de novo'; return; }
      if (!DEMO) { const { error } = await sb.from('testimonials').delete().eq('id', t.id); if (error) { toast('Erro ao excluir.'); return; } }
      tst = tst.filter((x) => x.id !== t.id); renderTst(); toast('Depoimento excluído.');
    });
    acts.push(del);
    return el('article', { class: 'tcard' },
      el('div', { class: 'meta' }, el('span', { class: 'origin', text: t.segmento }), el('span', { text: fmtDate(t.created_at) })),
      el('blockquote', { text: `“${t.texto}”` }),
      el('div', { class: 'who' }, el('b', { text: t.nome }), ` · ${t.loja} · ${t.cidade}`),
      el('div', { class: 'acts' }, acts));
  }));
  $('#tst-empty').hidden = list.length > 0;
}
async function setTst(t, status) {
  if (!DEMO) {
    const { error } = await sb.from('testimonials').update({ status }).eq('id', t.id);
    if (error) { toast('Erro ao salvar.'); console.error(error); return; }
  }
  t.status = status; renderTst();
  toast(status === 'aprovado' ? 'Depoimento aprovado — já aparece no site.' : 'Depoimento retirado do site.');
}
document.querySelectorAll('[data-tf]').forEach((b) => b.addEventListener('click', () => {
  tFilter = b.dataset.tf;
  document.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderTst();
}));
$('#refresh').addEventListener('click', () => { loadTst(); });

route();


/* ---------- abas ---------- */
function selectATab(t) {
  document.querySelectorAll('[data-atab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.atab === t)));
  document.querySelectorAll('[data-apanel]').forEach((p) => { p.hidden = p.dataset.apanel !== t; });
  if (t === 'suporte') { renderSupport(); loadSupportLog(); }
  if (t === 'cobranca') renderPays();
  try { sessionStorage.setItem('adm-tab', t); } catch (_) {}
}
document.querySelectorAll('[data-atab]').forEach((b) => b.addEventListener('click', () => selectATab(b.dataset.atab)));

/* ---------- clientes (lojas com conta no sistema) ---------- */
const PRICE = { Essencial: 39.99, Profissional: 59.99, Completo: 79.99 };
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SITE = (CFG.siteUrl || location.origin).replace(/\/$/, '');
let clients = [], cFilter = '';
function demoClients() {
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString();
  return [
    { id: 'a', name: 'Cantina da Ju', slug: 'cantina-da-ju', plan: 'Profissional', status: 'teste', trial_ends_at: d(1.5), created_at: d(-5.5), whatsapp: '27998124410', owner_email: 'ju@cantina.com', owner_name: 'Juliana Prates', orders_30d: 14, revenue_30d: 812.5, products: 22, last_order: d(-0.2) },
    { id: 'b', name: 'Pizzaria Forno Vivo', slug: 'pizzaria-forno-vivo', plan: 'Completo', status: 'ativo', trial_ends_at: d(-20), created_at: d(-27), whatsapp: '27997015588', owner_email: 'diego@fornovivo.com', owner_name: 'Diego Santana', orders_30d: 96, revenue_30d: 6420, products: 41, last_order: d(-0.05) },
    { id: 'c', name: 'Lanchonete Ponto 10', slug: 'lanchonete-ponto-10', plan: 'Essencial', status: 'teste', trial_ends_at: d(-1), created_at: d(-8), whatsapp: '27991206634', owner_email: 'ponto10@gmail.com', owner_name: 'Carlos Lima', orders_30d: 3, revenue_30d: 96, products: 8, last_order: d(-3) },
    { id: 'd', name: 'Açaí do Porto', slug: 'acai-do-porto', plan: 'Essencial', status: 'ativo', trial_ends_at: d(-40), created_at: d(-47), whatsapp: '27996543321', owner_email: 'camila@acaidoporto.com', owner_name: 'Camila Freitas', orders_30d: 58, revenue_30d: 2210, products: 17, last_order: d(-0.4) },
    { id: 'e', name: 'Brasa Burger', slug: 'brasa-burger', plan: 'Profissional', status: 'teste', trial_ends_at: d(6), created_at: d(-1), whatsapp: '27988771203', owner_email: 'rafa@brasaburger.com', owner_name: 'Rafael Moura', orders_30d: 0, revenue_30d: 0, products: 0, last_order: null },
  ];
}
async function loadClients() {
  if (DEMO) { clients = demoClients(); renderClients(); return; }
  const { data, error } = await sb.rpc('admin_clients');
  if (error) { console.error(error); toast('Não foi possível carregar os clientes.'); clients = []; }
  else clients = data || [];
  renderClients();
}
$('#cl-refresh').addEventListener('click', () => { loadClients(); toast('Lista atualizada.'); });
const daysTo = (iso) => (new Date(iso) - Date.now()) / 86400000;
function situation(r) {
  if (r.status === 'ativo') {
    if (r.paid_until && daysTo(r.paid_until) < -3) return { key: 'vencido', label: 'Assinatura vencida', cls: 'st-novo', note: `Venceu em ${new Date(r.paid_until).toLocaleDateString('pt-BR')}` };
    return { key: 'pagante', label: 'Pagante', cls: 'st-convertido', note: `${brl(PRICE[r.plan])}/mês${r.paid_until ? ' · pago até ' + new Date(r.paid_until).toLocaleDateString('pt-BR') : ''}` };
  }
  if (r.status === 'suspenso') return { key: 'pausado', label: 'Pausado', cls: 'st-perdido', note: 'Cardápio sem pedidos' };
  const d = daysTo(r.trial_ends_at);
  if (d <= 0) return { key: 'vencido', label: 'Teste vencido', cls: 'st-novo', note: `Venceu há ${Math.max(1, Math.round(-d))} dia(s)` };
  const left = Math.ceil(d);
  return { key: 'teste', label: 'No teste grátis', cls: left <= 2 ? 'st-em_contato warn' : 'st-em_contato', note: left <= 1 ? 'Acaba hoje/amanhã' : `Faltam ${left} dias` };
}
function clientMatches(r, q) { return !q || [r.name, r.owner_name, r.owner_email, r.whatsapp, r.slug].some((v) => String(v || '').toLowerCase().includes(q)); }
function waClient(r) {
  const s = situation(r); const first = (r.owner_name || '').split(' ')[0] || 'tudo bem';
  const txt = s.key === 'teste' ? `Olá, ${first}! Aqui é do BoraLanchar!. Seu teste grátis da ${r.name} ${s.note.toLowerCase()}. Posso te ajudar a ativar o plano ${r.plan} para não parar de vender?`
    : s.key === 'vencido' ? `Olá, ${first}! Aqui é do BoraLanchar!. O teste grátis da ${r.name} terminou e o cardápio está pausado. Quer ativar o plano ${r.plan} (${brl(PRICE[r.plan])}/mês) para voltar a receber pedidos?`
    : `Olá, ${first}! Aqui é do BoraLanchar!. Tudo certo com a ${r.name}? Precisa de alguma ajuda?`;
  const w = waLink(r.whatsapp); return w ? `${w}${w.includes('?') ? '&' : '?'}text=${encodeURIComponent(txt)}` : null;
}
function renderClients() {
  const tb = $('#cl-rows'); if (!tb) return;
  const sits = clients.map((r) => [r, situation(r)]);
  const count = (k) => sits.filter(([, s]) => s.key === k).length;
  $('#ck-pag').textContent = count('pagante');
  $('#ck-mrr').textContent = `${brl(sits.filter(([, s]) => s.key === 'pagante').reduce((t, [r]) => t + (PRICE[r.plan] || 0), 0))}/mês`;
  $('#ck-teste').textContent = count('teste');
  $('#ck-vence').textContent = sits.filter(([r, s]) => s.key === 'teste' && daysTo(r.trial_ends_at) <= 2).length;
  $('#ck-vencido').textContent = count('vencido');
  $('#ck-paus').textContent = count('pausado');
  $('#cc-todos').textContent = clients.length;
  ['pagante', 'teste', 'vencido', 'pausado'].forEach((k) => { $('#cc-' + k).textContent = count(k); });
  const q = $('#cl-q').value.trim().toLowerCase();
  const list = sits.filter(([r, s]) => (!cFilter || s.key === cFilter) && clientMatches(r, q));
  tb.replaceChildren(...list.map(([r, s]) => {
    const btn = (text, fn, c = 'btn btn-outline row-btn') => el('button', { class: c, type: 'button', text, onclick: fn });
    const acts = el('div', { class: 'cl-acts' });
    if (r.status !== 'ativo') acts.append(btn('Ativar plano', () => { if (confirm(`Confirmar que ${r.name} pagou o plano ${r.plan}?`)) setClient(r, { status: 'ativo' }); }, 'btn btn-primary row-btn'));
    if (r.status === 'teste') acts.append(btn('+7 dias de teste', () => setClient(r, { trial_ends_at: new Date(Math.max(Date.now(), new Date(r.trial_ends_at)) + 7 * 86400000).toISOString() })));
    if (r.status !== 'suspenso') acts.append(btn('Pausar', () => { if (confirm(`Pausar ${r.name}? O cardápio deixa de receber pedidos.`)) setClient(r, { status: 'suspenso' }); }, 'btn btn-ghost row-btn'));
    else acts.append(btn('Voltar ao teste', () => setClient(r, { status: 'teste', trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString() })));
    acts.append(btn('Suporte', () => openSupport(r), 'btn btn-ghost row-btn'));
    const wa = waClient(r); if (wa) acts.append(el('a', { class: 'btn btn-ghost row-btn', href: wa, target: '_blank', rel: 'noopener', text: 'WhatsApp' }));
    const plan = el('select', { class: 'cl-plan', 'aria-label': 'Plano de ' + r.name, onchange: (e) => setClient(r, { plan: e.target.value }) },
      ...['Essencial', 'Profissional', 'Completo'].map((p) => { const o = el('option', { value: p, text: `${p} · ${brl(PRICE[p])}` }); if (p === r.plan) o.selected = true; return o; }));
    const usage = el('td', {}, el('b', { text: `${r.orders_30d || 0} pedidos · ${brl(r.revenue_30d)}` }),
      el('small', { text: `${r.products || 0} produtos · ${r.last_order ? 'último pedido ' + fmtDate(r.last_order) : 'sem pedidos ainda'}` }));
    return el('tr', {},
      el('td', {}, el('b', { text: r.name }), el('a', { href: `${SITE}/l/${r.slug}`, target: '_blank', rel: 'noopener', text: '/l/' + r.slug, class: 'cl-link' }), el('small', { text: 'Cliente desde ' + fmtDate(r.created_at).split(',')[0] })),
      el('td', {}, el('b', { text: r.owner_name || '—' }), el('small', { text: r.owner_email || '' }), el('small', { text: r.whatsapp ? fmtPhone(r.whatsapp) : '' })),
      el('td', {}, plan),
      el('td', {}, el('span', { class: 'st ' + s.cls, text: s.label }), el('small', { class: 'cl-note', text: s.note })),
      usage, el('td', {}, acts));
  }));
  $('#cl-empty').hidden = list.length > 0;
  if (pays.length) renderPays();
  if (!$('[data-apanel="suporte"]').hidden) renderSupport();
}
const fmtPhone = (w) => { const d = digits(w).replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : w; };
$('#cl-q').addEventListener('input', renderClients);
document.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => {
  cFilter = b.dataset.cf; document.querySelectorAll('[data-cf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderClients();
}));
async function setClient(r, patch) {
  if (DEMO) { Object.assign(r, patch); renderClients(); toast('Demonstração: nada foi salvo.'); return; }
  const { data, error } = await sb.from('restaurants').update(patch).eq('id', r.id).select().single();
  if (error) { toast('Não foi possível atualizar.'); return; }
  Object.assign(r, data); renderClients();
  toast(patch.status === 'ativo' ? `${r.name} agora é cliente pagante!` : 'Cliente atualizado.');
}

/* ---------- suporte: entrar no painel da loja ---------- */
function openSupport(r) {
  if (DEMO) { toast('Na demonstração o modo suporte não abre lojas reais.'); return; }
  const w = window.open(`painel.html?suporte=${encodeURIComponent(r.id)}`, '_blank');
  if (w) w.opener = null; else location.href = `painel.html?suporte=${encodeURIComponent(r.id)}`;
  setTimeout(loadSupportLog, 2500);
}
function renderSupport() {
  const q = $('#sup-q').value.trim().toLowerCase();
  const list = clients.filter((r) => clientMatches(r, q)).slice(0, q ? 50 : 12);
  $('#sup-list').replaceChildren(...list.map((r) => {
    const s = situation(r);
    const logo = r.logo_url ? el('img', { src: r.logo_url, alt: '' }) : el('span', { text: (r.name || '?').charAt(0).toUpperCase() });
    const wa = waClient(r);
    return el('article', { class: 'sup-card' },
      el('div', { class: 'sup-logo' }, logo),
      el('div', { class: 'sup-info' }, el('b', { text: r.name }), el('small', { text: [r.owner_name, r.owner_email].filter(Boolean).join(' · ') || '—' }),
        el('span', { class: 'st ' + s.cls, text: s.label })),
      el('div', { class: 'sup-acts' },
        el('button', { class: 'btn btn-primary row-btn', type: 'button', text: 'Entrar no painel da loja', onclick: () => openSupport(r) }),
        el('a', { class: 'btn btn-outline row-btn', href: `${SITE}/l/${r.slug}`, target: '_blank', rel: 'noopener', text: 'Ver cardápio' }),
        ...(wa ? [el('a', { class: 'btn btn-ghost row-btn', href: wa, target: '_blank', rel: 'noopener', text: 'WhatsApp' })] : [])));
  }));
  $('#sup-empty').hidden = list.length > 0;
}
$('#sup-q').addEventListener('input', renderSupport);
async function loadSupportLog() {
  let rows = [];
  if (!DEMO) {
    const { data } = await sb.from('support_log').select('*').order('created_at', { ascending: false }).limit(30);
    rows = data || [];
  }
  const name = (id) => (clients.find((c) => c.id === id) || {}).name || '—';
  $('#sup-log').replaceChildren(...rows.map((l) => el('tr', {}, el('td', { text: fmtDate(l.created_at) }), el('td', { text: name(l.restaurant_id) }), el('td', { text: l.admin_email || '—' }))));
  $('#sup-log-empty').hidden = rows.length > 0;
}

/* ---------- cobrança (assinaturas dos planos) ---------- */
let pays = [];
const MET = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
async function loadPays() {
  if (DEMO) { pays = []; renderPays(); return; }
  const { data } = await sb.from('subscription_payments').select('*').neq('status', 'cancelado').order('created_at', { ascending: false }).limit(300);
  pays = data || []; renderPays();
}
function renderPays() {
  const name = (id) => (clients.find((c) => c.id === id) || {}).name || '—';
  const pend = pays.filter((p) => p.status === 'pendente');
  const pagos = pays.filter((p) => p.status === 'pago');
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  $('#pk-mes').textContent = brl(pagos.filter((p) => new Date(p.paid_at) >= m0).reduce((t, p) => t + Number(p.amount), 0));
  $('#pk-pend').textContent = pend.length; $('#pk-pagos').textContent = pagos.length;
  $('#pend-count').hidden = !pend.length; $('#pend-count').textContent = pend.length;
  $('#pay-rows').replaceChildren(...pays.map((p) => {
    const acts = el('div', { class: 'cl-acts' });
    if (p.status === 'pendente') {
      acts.append(el('button', { class: 'btn btn-primary row-btn', type: 'button', text: 'Confirmar recebimento', onclick: () => confirmPay(p) }));
      acts.append(el('button', { class: 'btn btn-ghost row-btn', type: 'button', text: 'Cancelar', onclick: () => cancelPay(p) }));
    }
    return el('tr', {}, el('td', { text: fmtDate(p.created_at) }), el('td', {}, el('b', { text: name(p.restaurant_id) })), el('td', { text: p.plan }),
      el('td', { text: MET[p.method] || p.method }), el('td', { text: brl(p.amount) }),
      el('td', {}, el('span', { class: 'st ' + (p.status === 'pago' ? 'st-convertido' : 'st-em_contato'), text: p.status === 'pago' ? 'Pago' : 'Aguardando' }),
        el('small', { text: p.status === 'pago' ? 'em ' + fmtDate(p.paid_at) : (p.method === 'pix' ? 'Confira no app do banco' : 'Mercado Pago confirma sozinho') })),
      el('td', {}, acts));
  }));
  $('#pay-empty').hidden = pays.length > 0;
}
async function confirmPay(p) {
  if (!confirm(`Confirmar que recebeu ${brl(p.amount)} do plano ${p.plan}? O plano da loja é ativado por 30 dias.`)) return;
  const { error } = await sb.rpc('admin_confirm_subscription', { p_id: p.id });
  if (error) return toast('Não foi possível confirmar.');
  toast('Pagamento confirmado e plano ativado!'); loadPays(); loadClients();
}
async function cancelPay(p) {
  if (!confirm('Cancelar este pagamento pendente?')) return;
  const { error } = await sb.rpc('admin_cancel_subscription', { p_id: p.id });
  if (error) return toast('Não foi possível cancelar.'); loadPays();
}
$('#pay-refresh').addEventListener('click', () => { loadPays(); loadCob(); toast('Atualizado.'); });

async function loadCob() {
  if (DEMO) return;
  const { data } = await sb.from('platform_settings').select('*').eq('id', 1).maybeSingle();
  const f = $('#cob-form'); const st = data || {};
  f.pix_key_type.value = st.pix_key_type || 'celular'; f.pix_key.value = st.pix_key || ''; f.pix_name.value = st.pix_name || ''; f.pix_city.value = st.pix_city || ''; f.pix_bank.value = st.pix_bank || '';
  renderCmp(!!st.mp_enabled, '');
  if (st.mp_enabled) { const r = await cobFn('account'); if (!r.error) renderCmp(r.connected, r.account); }
}
$('#cob-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const P = window.BoraPix;
  const key = f.pix_key.value.trim() ? P.normalizeKey(f.pix_key_type.value, f.pix_key.value) : null;
  if (f.pix_key.value.trim() && !key) return toast('Chave Pix inválida para o tipo escolhido.');
  if (key && (!f.pix_name.value.trim() || !f.pix_city.value.trim())) return toast('Preencha o nome de quem recebe e a cidade.');
  const patch = { pix_key: key, pix_key_type: key ? f.pix_key_type.value : null, pix_name: key ? P.plain(f.pix_name.value).slice(0, 25) : null,
    pix_city: key ? P.plain(f.pix_city.value).slice(0, 15) : null, pix_bank: f.pix_bank.value.trim().slice(0, 40) || null, updated_at: new Date().toISOString() };
  if (DEMO) return toast('Demonstração: nada foi salvo.');
  const { error } = await sb.from('platform_settings').update(patch).eq('id', 1);
  if (error) return toast('Não foi possível salvar.');
  toast(key ? 'Chave Pix salva! A página de assinatura já aceita Pix.' : 'Chave Pix removida.');
});
function renderCmp(on, acc) {
  $('#cmp-state').textContent = on ? 'Ligado' : 'Desligado'; $('#cmp-state').classList.toggle('on', on);
  $('#cmp-off').hidden = on; $('#cmp-on').hidden = !on; $('#cmp-acc').textContent = acc || '';
}
async function cobFn(action, extra = {}) {
  if (!sb || !sb.functions) return { error: 'indisponível' };
  const { data, error } = await sb.functions.invoke('assinatura', { body: { action, ...extra } });
  if (error) { let msg = 'Não foi possível falar com o servidor.'; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} return { error: msg }; }
  return data || {};
}
$('#cmp-connect').addEventListener('click', async () => {
  const token = $('#cmp-token').value.trim();
  if (!/^APP_USR-/.test(token)) return toast('Cole o Access Token de produção (começa com APP_USR-).');
  const b = $('#cmp-connect'); b.disabled = true; b.textContent = 'Conectando…';
  const r = await cobFn('connect', { token }); b.disabled = false; b.textContent = 'Conectar Mercado Pago';
  if (r.error) return toast(r.error);
  $('#cmp-token').value = ''; renderCmp(true, r.account); toast('Mercado Pago conectado! Cartão e boleto liberados na assinatura.');
});
$('#cmp-disconnect').addEventListener('click', async () => {
  if (!confirm('Desconectar o Mercado Pago? Cartão e boleto deixam de aparecer na assinatura.')) return;
  const r = await cobFn('disconnect'); if (r.error) return toast(r.error); renderCmp(false, '');
});

// volta para a última aba aberta
try { const t = sessionStorage.getItem('adm-tab'); if (t) selectATab(t); } catch (_) {}
